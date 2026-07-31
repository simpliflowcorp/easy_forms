/**
 * Collision-resistant ID generator for agent artifacts.
 *
 * Replaces `Date.now() + Math.random()` patterns in the personas/loop which
 * are not collision-proof under concurrency. Uses crypto.randomUUID when
 * available (Node 19+, Next runtime) and falls back to a timing-safe RNG mix.
 */
import { randomUUID } from "crypto";

const alnum = "abcdefghijklmnopqrstuvwxyz0123456789";

function fallbackId(prefix: string): string {
  const ts = Date.now().toString(36);
  let rnd = "";
  for (let i = 0; i < 12; i++) {
    rnd += alnum[Math.floor(Math.random() * alnum.length)];
  }
  return `${prefix}_${ts}_${rnd}`;
}

export function newActionId(): string {
  try {
    return `act_${randomUUID()}`;
  } catch {
    return fallbackId("act");
  }
}

export function newTicketId(): string {
  try {
    return `tkt_${randomUUID()}`;
  } catch {
    return fallbackId("tkt");
  }
}

export function newTraceId(): string {
  try {
    return `trc_${randomUUID()}`;
  } catch {
    return fallbackId("trc");
  }
}

export function newIdempotencyKey(): string {
  try {
    return `idem_${randomUUID()}`;
  } catch {
    return fallbackId("idem");
  }
}
