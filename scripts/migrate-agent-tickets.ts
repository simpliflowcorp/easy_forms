/**
 * One-time migration: coerce legacy AgentTicket.sandbox objects to the new
 * canonical SandboxStoreState shape introduced during the agent remodel.
 *
 * Old shape (variants seen in the wild):
 *   { forms, customViews, queryResults }   // updates/deletes arrays missing
 *   undefined / null / {}                    // entirely missing
 *
 * New shape (src/agent/types.ts):
 *   { forms, customViews, queryResults, updates: [], deletes: [] }
 *
 * Behavior:
 *   - Default: dry-run. Prints counts and the IDs that would be touched.
 *   - Pass `--apply` to commit the writes.
 *   - Tickets whose sandbox is missing `updates`/`deletes` get them added.
 *   - Tickets with `status === "PROCESSING"` that have a malformed sandbox
 *     (non-object, or with extra-but-not-canonical fields) are marked
 *     `LLM_ERROR` with a `reply` directing the user to re-run.
 *
 * Run:
 *   npm run agent:migrate --               # dry-run
 *   npm run agent:migrate -- --apply       # commit
 */
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const APPLY = process.argv.includes("--apply");

const AgentTicketSchema = new mongoose.Schema(
  {
    ticketId: { type: String, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    prompt: { type: String, required: true },
    stage: { type: String, required: true },
    title: { type: String, required: true },
    status: {
      type: String,
      enum: ["OPEN", "PROCESSING", "RESOLVED", "REJECTED", "LLM_ERROR"],
      required: true,
    },
    activePersona: { type: String, required: true },
    iterationCount: { type: Number, default: 1 },
    maxIterations: { type: Number, default: 3 },
    requirements: { type: mongoose.Schema.Types.Mixed, default: {} },
    actionPlan: { type: mongoose.Schema.Types.Mixed, default: [] },
    sandbox: { type: mongoose.Schema.Types.Mixed, default: {} },
    executionTrace: { type: mongoose.Schema.Types.Mixed, default: [] },
    reply: { type: String, default: "" },
    isComplete: { type: Boolean, default: false },
    isQuestion: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const AgentTicket =
  mongoose.models?.AgentTicket || mongoose.model("AgentTicket", AgentTicketSchema);

function isObject(v: any): v is Record<string, any> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function coerceSandbox(raw: any): { ok: true; sandbox: any } | { ok: false } {
  if (!isObject(raw)) return { ok: false };
  return {
    ok: true,
    sandbox: {
      forms: isObject(raw.forms) ? raw.forms : {},
      customViews: isObject(raw.customViews) ? raw.customViews : {},
      queryResults: isObject(raw.queryResults) ? raw.queryResults : {},
      updates: Array.isArray(raw.updates) ? raw.updates : [],
      deletes: Array.isArray(raw.deletes) ? raw.deletes : [],
    },
  };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI not set");
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log(`Connected to MongoDB. Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);

  const cursor = AgentTicket.find({}).cursor();
  let scanned = 0;
  let needsUpdate = 0;
  let errorTickets: string[] = [];

  for await (const ticket of cursor) {
    scanned++;
    const result = coerceSandbox(ticket.sandbox);
    if (!result.ok) {
      // Malformed/missing sandbox: if still PROCESSING, mark LLM_ERROR so the
      // user is prompted to re-run instead of silently losing draft state.
      if (ticket.status === "PROCESSING") {
        errorTickets.push(ticket.ticketId);
        needsUpdate++;
        if (APPLY) {
          await AgentTicket.updateOne(
            { _id: ticket._id },
            {
              $set: {
                sandbox: {
                  forms: {},
                  customViews: {},
                  queryResults: {},
                  updates: [],
                  deletes: [],
                },
                status: "LLM_ERROR",
                reply: "Ticket needs re-run after agent upgrade.",
              },
            },
          );
        }
      }
      continue;
    }

    // Check whether anything actually differs (we don't want to overwrite
    // tickets whose sandbox is already canonical).
    const cur = ticket.sandbox || {};
    const differs =
      !isObject(cur.forms) ||
      !isObject(cur.customViews) ||
      !isObject(cur.queryResults) ||
      !Array.isArray(cur.updates) ||
      !Array.isArray(cur.deletes);

    if (!differs) continue;

    needsUpdate++;
    if (APPLY) {
      await AgentTicket.updateOne(
        { _id: ticket._id },
        { $set: { sandbox: result.sandbox } },
      );
    }
  }

  console.log("");
  console.log("== Migration summary ==");
  console.log(`  Scanned:       ${scanned}`);
  console.log(`  Need update:   ${needsUpdate}`);
  console.log(`  Error tickets: ${errorTickets.length}`);
  if (errorTickets.length > 0) {
    console.log("  (will be marked LLM_ERROR:)");
    for (const id of errorTickets.slice(0, 20)) console.log(`    - ${id}`);
    if (errorTickets.length > 20) console.log(`    ... +${errorTickets.length - 20} more`);
  }
  if (!APPLY && needsUpdate > 0) {
    console.log("");
    console.log("Dry-run only. Re-run with --apply to commit.");
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("Migration failed:", err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
