import { connectDB } from "@/dbConfig/dbConfig";
import AgentTicket from "@/models/agentTicketModel";

export const LRU_CAP = 8;
export const TTL_WARNING_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Applies an LRU (Least Recently Used) cap of 8 to an array of items.
 * Keeps the latest `cap` items (or sorts by `lastUsedAt`/`updatedAt`/`timestamp` if present).
 */
export function applyLRUCap<T extends Record<string, any>>(
  items: T[],
  cap: number = LRU_CAP
): T[] {
  if (!Array.isArray(items)) return [];
  if (items.length <= cap) return items;

  const hasTimestamp = items.some(
    (item) => item?.lastUsedAt || item?.updatedAt || item?.timestamp || item?.lastAt
  );

  if (hasTimestamp) {
    const sorted = [...items].sort((a, b) => {
      const timeA = new Date(
        a.lastUsedAt || a.updatedAt || a.timestamp || a.lastAt || 0
      ).getTime();
      const timeB = new Date(
        b.lastUsedAt || b.updatedAt || b.timestamp || b.lastAt || 0
      ).getTime();
      return timeB - timeA;
    });
    return sorted.slice(0, cap);
  }

  // Fallback: take last `cap` items if no timestamps available
  return items.slice(items.length - cap);
}

/**
 * Checks if a date/timestamp is within 2 hours of expiry.
 * Returns a warning string if remaining time is < 2 hours and > 0, otherwise null.
 */
export function checkTTLWarning(
  expiryDate?: Date | string | number | null
): string | null {
  if (!expiryDate) return null;
  const expiryTime = new Date(expiryDate).getTime();
  if (isNaN(expiryTime)) return null;

  const now = Date.now();
  const remainingMs = expiryTime - now;

  if (remainingMs > 0 && remainingMs < TTL_WARNING_MS) {
    const minutesLeft = Math.ceil(remainingMs / 60000);
    return `TTL Warning: Resource expires in ${minutesLeft} minutes (< 2 hours remaining)`;
  }
  return null;
}

/**
 * Summarizes raw results for a given ticket and replaces raw trace/sandbox details with digest.
 * LRU cap of 8 is enforced on execution trace.
 * Includes TTL warning if ticket expiry is < 2h.
 */
export async function summarize(ticketId: string): Promise<string> {
  await connectDB();
  const ticket = await AgentTicket.findOne({ ticketId });
  if (!ticket) {
    return `Ticket not found: ${ticketId}`;
  }

  const rawTraceCount = Array.isArray(ticket.executionTrace)
    ? ticket.executionTrace.length
    : 0;

  const ttlWarning = checkTTLWarning((ticket as any).createdAt ? new Date(new Date((ticket as any).createdAt).getTime() + 30 * 24 * 3600 * 1000) : null);

  const digestParts = [
    `Ticket ID: ${ticket.ticketId}`,
    `Prompt: ${ticket.prompt}`,
    `Stage: ${ticket.stage}`,
    `Status: ${ticket.status}`,
    `Persona: ${ticket.activePersona}`,
    `Iterations: ${ticket.iterationCount}/${ticket.maxIterations}`,
    `Trace Entries: ${rawTraceCount}`,
  ];

  if (ttlWarning) {
    digestParts.push(ttlWarning);
  }

  const digest = digestParts.join(" | ");

  // Compact sandbox raw query results
  if (ticket.sandbox && typeof ticket.sandbox === "object") {
    ticket.sandbox = {
      ...ticket.sandbox,
      queryResults: undefined,
      rawOutputs: undefined,
      digest,
      compactedAt: new Date(),
    };
  }

  // Apply LRU cap = 8 to execution traces if present
  if (Array.isArray(ticket.executionTrace)) {
    const cappedTrace = applyLRUCap(ticket.executionTrace, LRU_CAP);
    ticket.executionTrace = [
      ...cappedTrace,
      { summarized: true, digest, timestamp: new Date() },
    ];
  }

  await ticket.save();
  return digest;
}
