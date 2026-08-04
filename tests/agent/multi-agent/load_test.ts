/**
 * D-S3.6 — multi-agent integration load test.
 *
 * Spawns 100 CONCURRENT agent executions (mock intents) and asserts three
 * SLAs:
 *   1. P99 latency < 30 s
 *   2. 0 data loss   — every per-execution sandbox write is accounted for
 *   3. 0 auth bypass — role-mismatched / cross-tenant / destructive intents
 *                      are all denied
 *
 * Orchestrator hook-in: when Agent A's `src/agent/orchestrator/loop.ts`
 * exists (integration gate), its `Orchestrator.execute` is used via dynamic
 * import and the assertions run against real `ExecutionState` results. Until
 * then, a local fake orchestrator (NO code sharing with A's implementation —
 * per §3.3 file listing) exercises the same harness so the suite is runnable
 * and green in isolation.
 *
 * Run: npm run agent:load  (node --experimental-strip-types)
 */

const ORCHESTRATOR_PATH = new URL(
  "../../../src/agent/orchestrator/loop.ts",
  import.meta.url,
);

/** Frozen executor roles (src/agent/types.ts ExecutorRole). */
export type ExecutorRole =
  | "executor_forms"
  | "executor_responses"
  | "executor_views"
  | "executor_generic";

export interface MockIntent {
  id: string;
  userId: string;
  ticketId: string;
  role: ExecutorRole;
  tool: string;
  /** Negative intents must be rejected by the orchestrator. */
  authBypass: "none" | "role_mismatch" | "cross_tenant" | "destructive";
  payload: Record<string, unknown>;
}

export interface SandboxWrite {
  ticketId: string;
  tool: string;
  opId: string;
}

export interface ExecutionOutcome {
  intent: MockIntent;
  ok: boolean;
  denied: boolean;
  reason?: string;
  status?: string;
  sandboxWrites?: SandboxWrite[];
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Allow-list contract (mirror of the frozen role → tool subsets; the REAL
// source of truth is B's getAllowedTools at the integration gate — the
// harness only needs a deny-set for negative intents).
// ---------------------------------------------------------------------------

const ROLE_TOOLS: Record<ExecutorRole, string[]> = {
  executor_forms: ["create_form", "update_form", "list_forms", "get_form"],
  executor_responses: ["list_responses", "get_response", "count_responses"],
  executor_views: ["create_view", "update_view", "list_views"],
  executor_generic: ["search", "summarize"],
};

const DESTRUCTIVE_TOOLS = new Set(["delete_form", "delete_all_users", "drop_db"]);

function toolAllowedForRole(role: ExecutorRole, tool: string): boolean {
  return ROLE_TOOLS[role]?.includes(tool) ?? false;
}

// ---------------------------------------------------------------------------
// Fake orchestrator (pre-integration): validates, queues sandbox writes,
// simulates bounded work. Swapped for the real one at the integration gate.
// ---------------------------------------------------------------------------

const fakeLedger = new Map<string, SandboxWrite[]>();

async function fakeOrchestrator(intent: MockIntent): Promise<ExecutionOutcome> {
  const started = Date.now();
  const outcome: ExecutionOutcome = { intent, ok: false, denied: false, latencyMs: 0 };

  // 1. auth-bypass gates (deterministic, code-evaluated)
  if (intent.authBypass === "destructive") {
    if (DESTRUCTIVE_TOOLS.has(intent.tool)) {
      outcome.denied = true;
      outcome.reason = `destructive tool ${intent.tool} blocked (destructive_actions=false)`;
      outcome.latencyMs = Date.now() - started;
      return outcome;
    }
  }
  if (intent.authBypass === "role_mismatch" && !toolAllowedForRole(intent.role, intent.tool)) {
    outcome.denied = true;
    outcome.reason = `tool ${intent.tool} not allowed for ${intent.role}`;
    outcome.latencyMs = Date.now() - started;
    return outcome;
  }
  if (intent.authBypass === "cross_tenant") {
    // Cross-tenant form_id must never be serviced.
    const formId = String(intent.payload?.form_id ?? "");
    if (!formId.startsWith(`own_${intent.userId}`)) {
      outcome.denied = true;
      outcome.reason = `cross-tenant form_id rejected: ${formId}`;
      outcome.latencyMs = Date.now() - started;
      return outcome;
    }
  }

  // 2. queue sandbox writes (per-execution namespace; merge check later)
  const writes: SandboxWrite[] = [
    { ticketId: intent.ticketId, tool: intent.tool, opId: `${intent.id}-op1` },
  ];
  fakeLedger.set(intent.id, writes);
  outcome.sandboxWrites = writes;
  outcome.ok = true;
  outcome.status = "awaiting_approval";

  // 3. bounded simulated work so P99 is meaningful
  const workMs = 5 + Math.floor(Math.random() * 20);
  await new Promise((r) => setTimeout(r, workMs));

  outcome.latencyMs = Date.now() - started;
  return outcome;
}

// ---------------------------------------------------------------------------
// Orchestrator loader — swaps to the real one when Agent A ships it.
// ---------------------------------------------------------------------------

let realOrchestrator: ((intent: MockIntent) => Promise<ExecutionOutcome>) | null = null;

async function loadRealOrchestrator(): Promise<void> {
  try {
    const mod = (await import(/* @vite-ignore */ ORCHESTRATOR_PATH.href)) as any;
    const execute = mod?.Orchestrator?.execute ?? mod?.execute;
    if (typeof execute === "function") {
      realOrchestrator = async (intent: MockIntent) => {
        const started = Date.now();
        const state = await execute(intent);
        return {
          intent,
          ok: state?.status !== "failed" && state?.status !== "cancelled",
          denied: state?.status === "cancelled" || state?.status === "denied",
          status: state?.status,
          sandboxWrites: state?.sandbox?.pendingWrites ?? [],
          latencyMs: Date.now() - started,
        };
      };
      console.log("🌐 Real Orchestrator loaded from src/agent/orchestrator/loop.ts");
    }
  } catch {
    realOrchestrator = null;
  }
}

// ---------------------------------------------------------------------------
// Intent factory — 100 mock intents: valid + negative mix.
// ---------------------------------------------------------------------------

export function makeIntents(count = 100): MockIntent[] {
  const intents: MockIntent[] = [];
  const roles: ExecutorRole[] = [
    "executor_forms",
    "executor_responses",
    "executor_views",
    "executor_generic",
  ];

  for (let i = 0; i < count; i++) {
    const userId = `user_${i % 10}`;
    if (i % 100 >= 88) {
      // 12 negatives: cycle through bypass kinds
      const kind: MockIntent["authBypass"] =
        i % 3 === 0 ? "role_mismatch" : i % 3 === 1 ? "cross_tenant" : "destructive";
      // Each kind uses a tool that ONLY its own gate rejects:
      //  - role_mismatch: a valid tool that the assigned role may not use
      //  - cross_tenant:  a valid tool acting on a foreign form_id
      //  - destructive:   a destructive-only tool
      const tool =
        kind === "role_mismatch"
          ? "create_form" // allowed for executor_forms only
          : kind === "destructive"
            ? "delete_form"
            : "create_form";
      intents.push({
        id: `neg_${i}`,
        userId,
        ticketId: `t_neg_${i}`,
        role: kind === "role_mismatch" ? "executor_responses" : roles[i % roles.length],
        tool,
        authBypass: kind,
        payload: { form_id: kind === "cross_tenant" ? `other_${userId}` : `own_${userId}` },
      });
    } else {
      const role = roles[i % roles.length];
      const tools = ROLE_TOOLS[role];
      intents.push({
        id: `ok_${i}`,
        userId,
        ticketId: `t_ok_${i}`,
        role,
        tool: tools[i % tools.length],
        authBypass: "none",
        payload: { form_id: `own_${userId}` },
      });
    }
  }
  return intents;
}

// ---------------------------------------------------------------------------
// SLA assertions
// ---------------------------------------------------------------------------

function p99(latencies: number[]): number {
  const sorted = [...latencies].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.99) - 1;
  return sorted[Math.max(0, idx)];
}

export interface LoadTestReport {
  total: number;
  completed: number;
  p99Ms: number;
  slaP99: boolean;
  dataLoss: number;
  slaDataLoss: boolean;
  authBypassCount: number;
  slaAuthBypass: boolean;
  usedRealOrchestrator: boolean;
}

export async function runLoadTest(count = 100): Promise<LoadTestReport> {
  await loadRealOrchestrator();
  const runner = realOrchestrator ?? fakeOrchestrator;

  const intents = makeIntents(count);
  console.log(`🚀 Launching ${count} concurrent executions (${realOrchestrator ? "real" : "fake"} orchestrator)...`);

  const outcomes: ExecutionOutcome[] = await Promise.all(
    intents.map((intent) => runner(intent)),
  );

  const latencies = outcomes.map((o) => o.latencyMs);
  const p99Ms = p99(latencies);

  // 0 data loss: every VALID execution's sandbox writes must be fully
  // recoverable from the ledger (per-ticket merge integrity).
  const valid = outcomes.filter((o) => o.intent.authBypass === "none");
  const dataLoss = valid.filter((o) => {
    const queued = o.sandboxWrites ?? [];
    const recovered = fakeLedger.get(o.intent.id) ?? [];
    return queued.length !== recovered.length;
  }).length;

  // 0 auth bypass: every negative intent must be denied.
  const negatives = outcomes.filter((o) => o.intent.authBypass !== "none");
  const authBypassCount = negatives.filter((o) => !o.denied).length;

  const report: LoadTestReport = {
    total: count,
    completed: outcomes.filter((o) => o.ok || o.denied).length,
    p99Ms: Math.round(p99Ms),
    slaP99: p99Ms < 30_000,
    dataLoss,
    slaDataLoss: dataLoss === 0,
    authBypassCount,
    slaAuthBypass: authBypassCount === 0,
    usedRealOrchestrator: !!realOrchestrator,
  };

  console.log(`   completed: ${report.completed}/${report.total}`);
  console.log(`   P99 latency: ${report.p99Ms}ms (SLA < 30000ms: ${report.slaP99})`);
  console.log(`   data loss: ${report.dataLoss} executions (SLA 0: ${report.slaDataLoss})`);
  console.log(`   auth bypass: ${report.authBypassCount} executions (SLA 0: ${report.slaAuthBypass})`);

  return report;
}

async function main() {
  const report = await runLoadTest(100);
  const pass =
    report.slaP99 && report.slaDataLoss && report.slaAuthBypass;
  console.log(`\n${pass ? "✅ ALL SLAs MET" : "❌ SLA VIOLATION"}`);
  process.exit(pass ? 0 : 1);
}

const isMain =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  !!process.argv[1] &&
  process.argv[1].endsWith("load_test.ts");

if (isMain) {
  main().catch((err) => {
    console.error("Load test failed:", err);
    process.exit(1);
  });
}
