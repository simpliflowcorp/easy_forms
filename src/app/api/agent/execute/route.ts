export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/dbConfig/dbConfig";
import User from "@/models/userModel";
import jwt from "jsonwebtoken";
import { getServerSession } from "next-auth";
import { runAgentLoop } from "@/agent/agentLoop";

async function getAuthUserId(req: NextRequest): Promise<string | null> {
  await connectDB();
  let token = req.cookies.get("token")?.value;
  let email: string | undefined;

  if (token) {
    try {
      let decoded: any = jwt.verify(token, process.env.TOKEN_SECRET!);
      if (decoded?._id) return decoded._id.toString();
      email = decoded?.email;
    } catch (err) {}
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

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthUserId(req);
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized. Please log in to perform AI agent actions." },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { prompt, mergeApproved, resumeTicketId } = body;

    // Run the multi-persona agent loop (Drafter -> Planner -> Executor -> Evaluator)
    const agentState = await runAgentLoop(userId, prompt || "", Boolean(mergeApproved), resumeTicketId);

    return NextResponse.json(agentState);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
