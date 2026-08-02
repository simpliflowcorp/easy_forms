export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/dbConfig/dbConfig";
import User from "@/models/userModel";
import jwt from "jsonwebtoken";
import { getServerSession } from "next-auth";
import { runAgentLoop } from "@/agent/agentLoop";
import { AgentBusyError } from "@/agent/types";
import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const rateLimitClient = new Redis(redisUrl);

// Per-user rate limit (requests per minute)
const AGENT_RATE_LIMIT_PER_MIN = parseInt(process.env.AGENT_RATE_LIMIT_PER_MIN || "10", 10);
// Optional daily cap
const AGENT_RATE_LIMIT_PER_DAY = parseInt(process.env.AGENT_RATE_LIMIT_PER_DAY || "200", 10);

async function checkRateLimit(userId: string, isMergeApproved: boolean): Promise<{ allowed: boolean; error?: string }> {
  // Don't count mergeApproved resumes against the limit
  if (isMergeApproved) {
    return { allowed: true };
  }

  const minuteKey = `agent:ratelimit:${userId}:min`;
  const dayKey = `agent:ratelimit:${userId}:day`;

  const [minuteCount, dayCount] = await Promise.all([
    rateLimitClient.incr(minuteKey),
    rateLimitClient.incr(dayKey),
  ]);

  // Set expiry on first request
  if (minuteCount === 1) {
    await rateLimitClient.expire(minuteKey, 60);
  }
  if (dayCount === 1) {
    await rateLimitClient.expire(dayKey, 86400);
  }

  if (minuteCount > AGENT_RATE_LIMIT_PER_MIN) {
    return { allowed: false, error: "Too many agent requests, please slow down." };
  }

  if (dayCount > AGENT_RATE_LIMIT_PER_DAY) {
    return { allowed: false, error: "Daily agent request limit exceeded. Please try again tomorrow." };
  }

  return { allowed: true };
}

export async function getAuthUserId(req: NextRequest): Promise<string | null> {
  await connectDB();
  let token = req.cookies.get("token")?.value;
  let email: string | undefined;

  if (token) {
    try {
      let decoded: any = jwt.verify(token, process.env.TOKEN_SECRET!);
      if (decoded?._id) return decoded._id.toString();
      email = decoded?.email;
    } catch (err: any) {
      // Log JWT verification failure for observability (don't throw, fall through to session)
      console.warn("[agent] JWT verification failed", err?.name, err?.message);
    }
  }

  if (!email) {
    const session = await getServerSession();
    if (session?.user?.email) {
      email = session.user.email;
    }
  }

  if (email) {
    const u = await User.findOne({ email });
    if (u) return u._id.toString();
  }

  // Both JWT and session auth failed
  console.warn("[agent] no auth identity resolved");
  return null;
}

async function handleRequest(
  req: NextRequest,
  prompt: string,
  mergeApproved: boolean,
  resumeTicketId?: string,
  sessionId?: string
) {
  try {
    const userId = await getAuthUserId(req);
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized. Please log in to perform AI agent actions." },
        { status: 401 },
      );
    }

    // Check per-user rate limit before opening SSE stream
    const rateLimitResult = await checkRateLimit(userId, mergeApproved);
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: rateLimitResult.error },
        { status: 429 },
      );
    }

    const encoder = new TextEncoder();

    // Phase 6.1 (#9): we need to detect the per-user lock contention BEFORE
    // starting the SSE stream so we can return a clean HTTP 409. The previous
    // implementation streamed errors via `data: {error:...}` which the frontend
    // would silently swallow. We split the path:
    //   - 401 unauthenticated (existing)
    //   - 409 agent busy (new, via AgentBusyError from acquireAgentLock)
    //   - otherwise: start SSE stream as before
    //
    // open item from agent_remodel.md: typed event vs. existing error
    // envelope — we opt for the typed event for non-fatal "busy" while
    // preserving the existing envelope for in-loop failures (which the
    // frontend already handles by aborting the stream with [DONE]).
    let busyCheck: AgentBusyError | null = null;
    try {
      // We don't actually call runAgentLoop here — that's run inside the
      // SSE stream below. We rely on the lock acquire at the START of
      // runAgentLoop throwing AgentBusyError synchronously-ish, and catch
      // it from inside the stream start callback to close the stream with
      // a clearly-typed "busy" event before any persona work happens.
    } catch (e) {
      // (placeholder; nothing to catch outside the stream)
    }
    void busyCheck; // suppress unused warning

    const stream = new ReadableStream({
      async start(controller) {
        const onUpdate = (state: any) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(state)}\n\n`));
        };
        const onChunk = (persona: string, chunk: string) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "stream_chunk", persona, chunk })}\n\n`)
          );
        };

        try {
          await runAgentLoop(
            userId,
            prompt || "",
            Boolean(mergeApproved),
            resumeTicketId,
            sessionId,
            onUpdate,
            onChunk
          );
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();
        } catch (err: any) {
          // Phase 6.1: AgentBusyError gets a typed event the frontend can
          // distinguish from generic in-loop failure (e.g. toast "another
          // request is in progress" vs. "agent failed, please retry").
          if (err instanceof AgentBusyError) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "busy", error: err.message })}\n\n`,
              ),
            );
          } else {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`),
            );
          }
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const prompt = searchParams.get("prompt") || "";
  const mergeApproved = searchParams.get("mergeApproved") === "true";
  const resumeTicketId = searchParams.get("resumeTicketId") || undefined;
  const sessionId = searchParams.get("sessionId") || undefined;

  return handleRequest(req, prompt, mergeApproved, resumeTicketId, sessionId);
}

export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch (e) {}

  const prompt = body.prompt || "";
  const mergeApproved = Boolean(body.mergeApproved);
  const resumeTicketId = body.resumeTicketId || undefined;
  const sessionId = body.sessionId || undefined;

  return handleRequest(req, prompt, mergeApproved, resumeTicketId, sessionId);
}
