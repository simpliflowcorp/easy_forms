# agent_upgrade_v3.md — Plan to Reach the v3 Spec

> Companion to `plans/agent_spec.md`. Each item is **defect-first**: the
> observed problem (with file:line), the fix, files touched, verification,
> risk, and effort. Ordered by priority. Items prefixed `[DEFECT]` fix
> existing broken behavior; `[GAP]` adds missing capability; `[SAFE]`
> hardens an invariant.
>
> All work MUST preserve `.agents/rules.md` (MUST run `npm run lint` +
> `npx tsc --noEmit` before done; `npm run agent:eval` after touching
> `src/agent/**`, `src/lib/llmClient.ts`, or `src/lib/agentTools.ts`) and
> `design.md` A4 (a new agent tool MUST update `tools.ts`,
> `policy/permissions.ts`, `agentTools.ts`, `guidelines.md`, `skills.md`
> together).

---

## P0 — Defects that break the loop today (do these first, ~1 week)

### D0.1 `[DEFECT]` Mongo↔Redis state drift

**Observed.** `agentLoop.ts:182-229` — `shouldPersistToMongo` only writes
Mongo on `DRAFTER / AWAITING_USER_APPROVAL / LLM_ERROR / REJECTED / RESOLVED`
transitions, while Redis is written on *every* transition. A crash between
a skipped Mongo write and the next `agentRedis.saveState` leaves the
resumed-from-Mongo state stale. AGENT-OVERVIEW §1.2 #2 calls this out
explicitly.

**Fix.** Remove the conditional. Write Mongo on every transition; use
`compressTraceForMongo` (already implemented) so the cost is bounded. Redis
becomes purely a hot resume cache that can be rebuilt from Mongo. Matches
the comment "Mongo is authoritative; Redis is a rebuildable hot cache."

**Files.** `src/agent/agentLoop.ts`, `src/models/agentTicketModel.ts`
(verify the TTL partial-filter expression still excludes `AWAITING_USER_APPROVAL`).

**Verify.** Simulate a crash between PLANNER and EXECUTOR by killing the
process under a debugger; resume from Mongo; assert the persona is the one
that was last persisted (PLANNER, not DRAFTER). Add a stubbed unit-eval row
that asserts atomicity.

**Risk.** Higher Mongo write volume. Mitigation: the compressed trace is
already payload-stripped, so a transition row is ~3 KB. Audit read load on
`AgentTicketModel` if needed.

**Effort.** 1 day.

---

### D0.2 `[DEFECT]` Lock TTL shorter than the worst-case loop

**Observed.** `agentLoop.ts:691-703` — the per-user Redis lock has a 60 s TTL
but a 4-persona × 3-retry × 30 s LLM timeout loop can run for ~6 minutes.
When the lock expires mid-run, `lock.stale()` only logs a warning and the
loop continues — it can write stale state from a parallel run.

**Fix.** (a) Add `LOOP_DEADLINE_MS` (default 90 000), checked at the top of
every `while` iteration in the loop — on expiry, route to `handleFailure`
with a typed `LoopTimeoutError` so the lock releases cleanly. (b) Raise
`LOCK_TTL_MS` to `max(LOOP_DEADLINE_MS, 60 000) + 5 000`. (c) Add a
`lock.renew()` heartbeat every 15 s while the loop is alive (or rely on the
deadline + TTL buffer, the simpler choice).

**Files.** `src/agent/agentLoop.ts`, `src/agent/sandbox/agentLock.ts`
(re-extend TTL via `EXPIRE` if heartbeat chosen).

**Verify.** Add a chaos test: stub an LLM that sleeps 40 s per call, run
the loop, assert it returns `LoopTimeoutError` around the 90 s mark, lock
is released, Mongo ticket status is `LLM_ERROR`.

**Risk.** A 90 s budget may be too tight for the Llama-3.1-8b cold-start
on NIM. Mitigation: env-tunable; start at 120 000.

**Effort.** 1 day.

---

### D0.3 `[DEFECT]` Replan is unreachable; 2nd identical retry wastes the budget

**Observed.** `agentLoop.ts:609-618` — on `shouldRetry`, the Evaluator routes
back to `EXECUTOR_SANDBOX` with the *same* `actionPlan`. The Planner's
`feedbackPreamble` (`planner.ts:124-128`) supports the replan path but is
unreachable from the normal retry flow. A structurally-wrong plan (e.g.
the LLM picked `update_form` when the user wanted `create_form`) cannot
recover — the 3 iterations are wasted on identical Executor runs.

**Fix.** Promote the Orchestrator (spec §2.2, §4.1) so that:
- 1st failed retry → EXECUTOR_SANDBOX (transient retry, as today)
- 2nd failed retry → PLANNER_MIXER with `evaluatorFeedback` (replan)
- 3rd → COMMUNICATOR asks the user.

Per-skill `maxIterations` lives in the skills registry (spec §6.1
`maxIterations`). For read skills the budget is 1.

**Files.** `src/agent/agentLoop.ts`, `src/agent/personas/evaluator.ts`
(signal replan via a new `decision` enum, not just `shouldRetry`).

**Verify.** Add a golden prompt with a deliberately bad first plan
(stubbed Executor returns `error` on `update_form`); assert the second
retry goes through the Planner (not Executor) and the third surfaces a
user question.

**Risk.** A non-deterministic Planner can regenerate worse params. Cache
the prior plan so the Planner sees both the failed plan and the feedback
side-by-side (already the case in `feedbackPreamble`).

**Effort.** 2 days.

---

### D0.4 `[DEFECT]` `mergeSandboxToProduction` returns inflated `mergedForms`

**Observed.** `sandboxMerge.ts:380-385` — the returned `mergedForms` is
computed as `stats.mergedForms + stats.updatesApplied + stats.deletesApplied`.
The agentLoop reply text at `agentLoop.ts:336-339` then prints
"Forms created: X" where **X** includes update counts + delete counts. The
user is told "Forms created: 2" when they actually updated 1 and deleted 1.

This was wrapped up to mean "merged changes" but the label is wrong.

**Fix.** Return the raw `{ mergedForms, mergedViews, updatesApplied,
updatesMissed, deletesApplied, deletesMissed }` cleanly and change the
reply text in `agentLoop.ts` to render all six counters separately, with
missed-count warning already in the existing branch.

**Files.** `src/agent/sandbox/sandboxMerge.ts:356-385`,
`src/agent/sandbox/sandboxMerge.ts:337` (standalone path has the same
bug), `src/agent/agentLoop.ts:336-339`.

**Verify.** Unit-test the merge stats: create with 1 draft, update with 1,
delete with 1 in the same sandbox; assert the reply says
"Forms created: 1, updated: 1, deleted: 1" — not "Forms created: 3".

**Risk.** Low; reply-text only.

**Effort.** 0.5 day.

---

### D0.5 `[DEFECT]` Simulated-offline is not hoisted out of branch logic

**Observed.** `agentLoop.ts:576-580` reads `simOfflineKey` once at the top
of `while`, but the comment `// during Planner` at `agentLoop.ts:588-590`
re-checks it only inside the PLANNER branch. The caught `Error` resets
`state.activePersona` to something the outer `catch(error)` will surface
as an LLM_ERROR, but other branches silently proceed.

**Fix.** Hoist a single `isSimulatedOffline` check to the top of `while`
and `throw` immediately, before the persona `if/else` dispatch. Drop the
duplicate in the Planner branch.

**Files.** `src/agent/agentLoop.ts:575-590`.

**Verify.** Existing simulate-offline test should now trip uniformly across
personas; add a stubbed eval row that asserts the throw happens in
EXECUTOR_SANDBOX.

**Risk.** None.

**Effort.** 0.25 day.

---

### D0.6 `[DEFECT]` `llmRawOutput` is stored un-redacted in trace

**Observed.** `agentLoop.ts:88-106` (`addTrace`) stores payloads as-is up
to the 4 KB cap; the Drafter/Evaluator payload frequently contains
`{ ..., llmRawOutput: rawContent }` (`drafter.ts:526-535`). Only tool
`params`/`result` go through `redactPII` in Executor/Evaluator/Communicator.
If a user's prompt mentions an email/phone and the LLM echoes it, PII lands
in Redis + Mongo + the SSE stream.

**Fix.** Run `redactPII(payload)` before the truncation check in `addTrace`.
For `llmRawOutput` specifically, treat the whole string as a PII-bearing
string and apply value-redaction (`AGENT_REDACT_VALUES=1` semantics, but
gated to the trace only, not the live LLM context).

**Files.** `src/agent/agentLoop.ts:88-106`, `src/agent/helper/redact.ts`
(add a `redactTracePayload(obj)` that walks the payload tree).

**Verify.** Send a prompt containing `me@example.com`, inspect the Mongo
`executionTrace` doc, assert the email is `***`-masked.

**Risk.** Possible false-positives redacting legit form content. Mitigation:
keep key-based redaction as the primary mode; only apply value-based
redaction to `llmRawOutput` and to the SSE stream.

**Effort.** 0.5 day.

---

### D0.7 `[DEFECT]` No user-abort signal

**Observed.** There is no way for the user to cancel a running loop except
closing the SSE stream — and even then the server-side loop continues
until it releases the lock (potentially minutes).

**Fix.** Add `agent:abort:{ticketId}` Redis flag polled at the top of every
`while` iteration in the Orchestrator. The agent UI POSTs the flag; the
loop picks it up, calls `handleFailure(new AgentCancelledError())`, the
catch releases the lock, marks the ticket `LLM_ERROR` (or a new `CANCELLED`
status if we extend the enum + ttl index), and the SSE stream emits
`{type:"cancelled"}` before `[DONE]`.

**Files.** `src/agent/agentLoop.ts`, `src/agent/types.ts`
(`AgentCancelledError`), `src/models/agentTicketModel.ts` (extend `status`
enum + the TTL partial-filter), new `POST /api/agent/abort` route.

**Verify.** Start a 4-persona loop; abort mid-Executor; assert the lock is
released within 1 s and the SSE event fires.

**Risk.** Mutation side-effects from the Executor that already queued into
the sandbox stay there; the user can re-resume and either merge or clear.
Document this in the Communicator reply.

**Effort.** 1 day.

---

### D0.8 `[DEFECT]` Drafter prompt rule numbering jumps 7 → 20

**Observed.** `prompts.ts:20-27`. Rules 8–19 are missing entirely — a
classic prompt-edit scar. The LLM still parses, but humans reviewing the
prompt cannot tell whether rules 8–19 are deleted, merged into the others,
or were never numbered. This block should also have been replaced by the
versioned loader reading `src/agent/prompts/v1/drafter.json` (loader exists
at `prompts/loader.ts:79`); the versioned JSON is the canonical source now.

**Fix.** Renumber the rules in `prompts/v1/drafter.json` contiguously from 1
(making `prompts.ts` purely a legacy fallback). Audit every rule against
`design.md` B9 quality gate (every rule true/false testable, has a *why*).

**Files.** `src/agent/prompts/v1/drafter.json`, `src/agent/prompts.ts`
(deprecate or delete since loader is canonical — but the in-repo `Agent.md`
also references those texts, so keep for spec documentation).

**Verify.** Diff the loaded prompt byte-by-byte against a curated canonical
string; run the agent:eval suite.

**Risk.** Renumbering alone changes the prompt and may move eval results.
Run eval before + after; if results drift, investigate before merging.

**Effort.** 0.5 day.

---

### D0.9 `[DEFECT]` Communicator double-branches on `LLMOfflineError` only

**Observed.** `agentLoop.ts:674-676` — the inner `catch (error)` calls
`handleFailure(error, state)` which itself checks `err instanceof
LLMBudgetExceededError` and otherwise treats every error as a generic
server error. Typed errors `LLMRateLimitError` / `LLMTimeoutError` /
`LLMHTTPError` collapse into the same generic "AI processing interrupted"
reply — the user cannot distinguish a timeout from a 5xx.

**Fix.** Branch `handleFailure` on every typed error to produce a
user-readable recovery message keyed to the error type (timeout → "the AI
is taking longer than expected"; rate-limit → "too many requests, slow
down"; HTTP 5xx → "the AI provider had a transient issue, retry shortly").
Keep `LLM_ERROR` as the Mongo status but set a new `ticket.errorKind`
field so the dashboard can break failures down.

**Files.** `src/agent/agentLoop.ts:232-266`, `src/models/agentTicketModel.ts`
(add `errorKind` field + index), `src/agent/types.ts`.

**Verify.** Stubbed eval row per error kind asserting the right reply text.

**Risk.** None.

**Effort.** 0.5 day.

---

### D0.10 `[DEFECT]` Read-only shortcut bypasses sandbox caching of read results

**Observed.** `drafter.ts:216-242` — when `READ_ONLY_SKILLS.has(skill)`, the
Drafter calls `executeAgentTool` directly *outside* of any sandbox/trace
context. The read shortcut means no `ExecutionTraceStep` is recorded for
the read, no `AgentUsage` row (no `captureLLMUsage`), and the Communicator
formats the result deterministically without an LLM call (so no token usage
at all — but no trace either). A user query like "list my forms" leaves no
persistent trail.

**Fix.** Add a minimal trace step (and an `AgentAuditEvent` row) in the
read-only shortcut, even though there is no LLM call. Document that the
read shortcut deliberately skips Planner/Executor/Evaluator per the spec.

**Files.** `src/agent/personas/drafter.ts`, `src/agent/agentLoop.ts`
(the trace is attached in `agentLoop`, not `drafter.ts`, so thread a hook).

**Verify.** Send "list my active forms", inspect the Mongo trace, assert
a step exists with persona `DRAFTER` + message `Read query: ...`.

**Risk.** Low.

**Effort.** 0.5 day.

---

## P1 — Capability gaps for end-to-end control (~3 weeks)

### C1.1 `[GAP]` Extend the tool catalog to the full CRUD surface

**Why.** Spec §3.1 lists 28 tools; today there are 10. The missing ones
include element-level ops, form status toggle, form metadata settings,
dashboard stats, notifications, user profile/preferences, notification
settings, exports, and audit reads.

**Approach.** Add tools in dependency-ordered bundles (each bundle ships
`tools.ts` + `agentTools.ts` or `executor.ts` + `policy/permissions.ts` +
`permissions.json` + `skills.md` + `guidelines.md` together, per `design.md`
A4):

| Bundle | Tools | Sandbox? | Est effort |
|---|---|:---:|---|
| **B1 element ops** | `add_form_element`, `update_form_element`, `remove_form_element`, `reorder_form_elements` | ✓ | 2 d |
| **B2 form lifecycle** | `set_form_status`, `update_form_metadata_settings` | ✓ | 1 d |
| **B3 user/account** | `update_user_profile`, `update_user_preferences`, `update_notification_settings` | ✓ | 1 d |
| **B4 notifications** | `list_notifications`, `mark_notification_read`, `clear_notification` | direct (reversible) | 1 d |
| **B5 reads** | `dashboard_stats`, `list_agent_audit_events`, `list_agent_tickets` | — | 1 d |
| **B6 exports** | `export_form` (csv/json/pdf) → returns signed URL | — | 2 d |

**Verify.** One golden prompt per new tool (positive + negative where
destructive). All mutations ship through `sandboxMerge.ts`; B2/B3 require
extending the merge function — `mergeSandboxToProduction` currently only
handles Form drafts/updates/deletes + CustomView drafts. Profile/prefs
updates should queue as `User.updateOne({_id: userId}, {$set: ...})` under
the transaction.

**Risk.**触及 user profile = user can soft-lock their own account by
flipping prefs through the agent; mitigate by never letting the agent
touch auth-related fields (`password`, `email`, `isGoogleAuth`,
`isAdmin`, the `verify*` fields). Add a `USER_SAFE_FIELDS` allowlist in
the merge step.

**Effort.** ~8 days for B1–B6.

---

### C1.2 `[GAP]` Skills Registry — versioned skills instead of per-call planning

**Why.** Spec §6 — today the Planner invents the tool list per LLM call
(planner.ts:118-196), non-deterministic and impossible to evaluate. Make
skills first-class artifacts so a user can ALSO author/edit/delete them.

**Approach.**
1. Introduce `src/agent/skills/registry.json` (built-ins) +
   `src/models/AgentSkillModel` (user skills).
2. Add `src/agent/personas/skillRouter.ts` — resolves a Drafter skill name
   to a skill record; falls back to built-ins; rejects unknown names with
   `{allowed:false, reason:"No skill template for X"}`.
3. Refactor `planner.ts` into `planner.ts` (Mixer) — fills params into the
   matched skill template instead of inventing one.
4. Multi-skill tickets: the Drafter can return `skills: [...]` (array);
   the Skill Router emits an action plan per skill and concatenates.
5. Skill Author persona: off-loop; gated by `skill_authoring` scope
   (default `false`); creates / updates / deletes user skills.

**Verify.**
- Eval: a golden prompt that asks for build + custom-view in one ticket;
  assert the plan has both `create_form` and `create_custom_view` steps.
- Eval: "remember my contact-form template" should create a skill in
  `AgentSkillModel`; the next "build a contact form" should use it.

**Risk.** Skills in the registry must be Zod-validated; a user-authored
skill with bad params would silently fail. Add an offline skill
validator (`npm run agent:validate-skills`).

**Effort.** 5 days.

---

### C1.3 `[GAP]` Memory Service — long-term per-user memory

**Why.** Spec §5. Today the 3-recent-tickets window is the only cross-
ticket continuity. The Drafter cannot recall "you always add an Email
field" beyond the last 3 prompts.

**Approach.** New Mongo models in `src/agent/memory/`:
- `AgentMemoryModel` (`userId`, `key`, `value: Mixed`, `confidence`,
  `lastUsedAt`, `createdAt`, `updatedAt`) — recurring form fields,
  recurring filters, recurring naming patterns.
- `AgentSkillUsageModel` (`userId`, `skill`, `count`, `successRate`,
  `avgIterations`, `lastUsedAt`).
- `AgentFailureModel` (`userId`, `promptHash`, `lastError`, `count`,
  `lastAt`, TTL 30 d).

Service API: `getMemory`, `setMemory` (upsert + confidence bump),
`recordSkillUse`, `recordFailure`, `recentFailures`, `summarize`.

Drafter reads memory at ticket start (`getMemory(userId,
"recurring_fields")`, `recentFailures(userId, 7d)`). Evaluator writes back
after a successful merge. Memory writes are Zod-validated + `redactPII`-
filtered + user-revocable (a "forget everything about X" tool).

**Verify.** A 3-prompt sequence: build a contact form → build another
contact form (assert Drafter pre-fills Email) → "forget my contact template"
→ build a contact form (assert Email is NOT pre-filled).

**Risk.** Memory is a PII leak surface — every write MUST redact. Add a
daily cron that audits memory docs for unredacted patterns and quarantines
them.

**Effort.** 4 days.

---

## P2 — LLMOps + Eval hardening (~2 weeks)

### L2.1 `[GAP]` Per-persona model + temperature + streaming

**Why.** Spec §7. Drafter/Evaluator want JSON + low temp; Planner needs
function-calling; Communicator wants warmth + streaming. Today all use
the same `LLM_MODEL` + temperature and no streaming in Communicator.

**Approach.**
- Env overrides `LLM_MODEL_{DRAFTER,PLANNER,EVALUATOR,COMMUNICATOR}` in
  `llmClient.ts`; default to `LLM_MODEL`.
- Per-persona temperature constants in the persona files.
- Communicator: set `stream:true` and route the chunks into the SSE
  stream as `{type:"token", persona, delta}`. Keep non-stream for
  Drafter/Planner/Evaluator (their JSON contracts need the full body).

**Files.** `src/lib/llmClient.ts`, `src/agent/prompts/loader.ts` (attach
per-persona model + temperature to the prompt file JSON),
`src/agent/personas/communicator.ts`, `src/app/api/agent/execute/route.ts`
(token event handler already there at `route.ts:141-145`).

**Verify.** Live golden prompt for Communicator: assert SSE stream emits
at least one `stream_chunk` event before `[DONE]`.

**Risk.** Streaming with the `thoughtProcess` extraction at
`llmClient.ts:272-301` is non-trivial; refactor to a general JSON streaming
parser.

**Effort.** 2 days.

---

### L2.2 `[GAP]` Secondary provider fallback

**Why.** Spec §7. If NVIDIA NIM is down for real, every ticket is
`LLM_ERROR`. Today there is no model-level failover.

**Approach.** On a non-retryable `LLMOfflineError` from the primary
provider, transparently retry once against a configured secondary
(`LLM_FALLBACK_PROVIDER`, `LLM_FALLBACK_MODEL`, `LLM_FALLBACK_API_KEY`).
Reset the secondary call's usage into `AgentUsage` with the fallback
model for cost attribution.

**Files.** `src/lib/llmClient.ts` (add `callOnceWithFallback`).

**Verify.** Stub test: primary throws `LLMOfflineError`, fallback returns
OK; assert the result + that usage is attributed to the fallback model.

**Risk.** Two providers doubles the secret surface. Wire fallback keys in
the same `.env` shape; never log.

**Effort.** 1 day.

---

### L2.3 `[GAP]` Health monitor branches on provider

**Why.** Spec §7. `llmHealthMonitor.ts` pings the NVIDIA `/models` endpoint
even when `LLM_PROVIDER=google`. Non-NVIDIA deployments report "unknown"
forever.

**Fix.** Branch the probe URL on `LLM_PROVIDER`:
- nvidia → `https://integrate.api.nvidia.com/v1/models`
- google → `https://generativelanguage.googleapis.com/v1beta/models`

**Files.** `src/lib/llmHealthMonitor.ts`.

**Verify.** Set `LLM_PROVIDER=google` in a test environment; assert the
probe hits the Google endpoint.

**Effort.** 0.25 day.

---

### L2.4 `[GAP]` Structured logging + App Insights

**Why.** Spec §7. Production observability — correlating a ticket failure
to a specific LLM call — requires grepping stdout today (`agentLoop.ts:83`
`console.log("LLM Raw Output:", rawContent)`).

**Approach.** Introduce `pino` (no new "second logger" — there isn't one
today, so this is founding the role). Logger context:
`{userId, ticketId, persona, attempt, ms, status, model}`. Stub a thin
adapter so we can also ship to Azure App Insights (`appinsights-
instrumentation` skill is available) without coupling the agent to Azure.

**Files.** new `src/lib/logger.ts`, `src/agent/agentLoop.ts` (replace
console.*), `src/agent/personas/*.ts`.

**Verify.** Send a prompt; capture one pino line per persona with the full
context pair present.

**Effort.** 1 day.

---

### E2.5 `[GAP]` Split eval into stubbed unit (PR-gating) + live nightly

**Why.** Spec §8. The current 50-prompt live suite is non-deterministic,
costs real LLM tokens per CI run, and creates real `Form`/`User` docs as
side effects (cannot gate PRs on it without flaking).

**Approach.**
- **Unit suite.** `tests/agent/eval/stubRunner.ts` already exists (per
  `FINAL_CHECKPOINT_v3.md`); wire it into CI with `LLM` mocked via the
  existing `__testRetryLLMOverride` hook in `llmClient.ts:376-388`.
  Record/replay fixtures under `tests/agent/eval/fixtures/`.
- **Live suite.** Run the existing `runner.ts` nightly against a
  throwaway Mongo; gate it behind `npm run agent:eval:live` manual flag.
- **Cleanup.** Per-prompt `finally`: `sandboxRedisStore.resetStore` +
  `AgentTicketModel.updateOne({ticketId}, {status:"RESOLVED"})` in both
  runners.

**Verify.** PR-branch CI runs the stub suite; nightly job runs the live
suite and writes a JSON report diff vs the previous night.

**Effort.** 3 days.

---

### E2.6 `[GAP]` Negative golden prompts + structural assertions

**Why.** Spec §8. The current suite only checks `toolsMatch` +
`iterationsOk` + `completed` + `noError`. A false-positive `isComplete`
passes. A prompt can pass while producing a garbage form.

**Approach.**
- Add `expectedParams`, `expectedSandboxShape`, `expectedReplyContains`
  fields to `golden-prompts.jsonl` and assert them in `runGoldenPrompt`.
- Add a `negativePrompts.jsonl` for inputs that should NOT be accepted as
  complete: cross-tenant form-id (`form_id` of another user's form),
  attempt to mutate a `Response`, attempt to delete a form when
  `destructive_actions=false`, an abort signal that should fire, etc.
- On failure, dump the full `executionTrace` into the report JSON so a
  failed PR includes a copy-paste-able trace.

**Files.** `tests/agent/eval/golden-prompts.jsonl`,
`tests/agent/eval/negative-prompts.jsonl`, `tests/agent/eval/runner.ts`,
`tests/agent/eval/stubRunner.ts`.

**Verify.** Negative prompt `try to delete responses on form X` should
fail with the "responses are read-only" guardrail; assert reply contains
the expected deny message and `isComplete=false`.

**Effort.** 2 days.

---

### E2.7 `[GAP]` Eval report history + branch coverage

**Why.** Spec §8. No persisted report file, no trend, no notion of which
persona-branches the golden set actually exercises.

**Approach.**
- Persist JSON report to `tests/agent/eval/reports/<ISO>.json` after each
  live run; tiny `diffReports.js` to summarize pass-rate, regression, and
  new failures vs the previous run.
- Tag every golden prompt with `branches: string[]` (e.g.
  `["drafter.vague", "drafter.followup", "evaluator.retry"]`); the runner
  emits a `% branches hit` summary so untested branches become visible.

**Effort.** 1.5 days.

---

## P3 — Loop & UX improvements (~2 weeks)

### P3.1 `[GAP]` Per-skill `maxIterations`

**Why.** Spec §4.2. A 1-tool read and a 4-tool multi-skill build share
the same 3-iteration budget today.

**Approach.** Store `maxIterations` in the Skills Registry (spec §6.1);
the Orchestrator reads it and overrides the default at ticket start.

**Effort.** 0.5 day (after C1.2).

---

### P3.2 `[GAP]` Sandbox TTL warning

**Why.** Spec §5.3 + AGENT-OVERVIEW §1.2 #7. The 24h sandbox TTL produces a
hard throw at merge time with no earlier warning.

**Approach.** On every resume, in `agentLoop.ts` resume path, run
`agentRedis.client.ttl(sandboxKey)` and, if `< 2h` (env `SANDBOX_TTL_WARN_MS`,
default 7 200 000), the Communicator adds
"This draft expires in Xh — click Merge soon." to its reply.

**Files.** `src/agent/agentLoop.ts:359-445` (resume path).

**Effort.** 0.5 day.

---

### P3.3 `[GAP]` Typed SSE heartbeat events

**Why.** Spec §4.3 + AGENT-OVERVIEW §2.2 #7. `onUpdate` is fired on every
`addTrace`, but there's no distinct "loop is still alive" event — a long
resume is hard to distinguish from a hung stream client-side.

**Approach.** Emit `{type:"turn", persona, ts}` every loop iteration and
`{type:"complete", state}` before `[DONE]`. The agent's AgentVisualizer
already consumes `data: <state>`; add event handlers for `turn` /
`complete`.

**Files.** `src/app/api/agent/execute/route.ts`, `src/components/AgentVisualizer.tsx`.

**Effort.** 1 day.

---

### P3.4 `[GAP]` Skill-authoring UX surface

**Why.** Spec §6.2. With skills first-class, the UI needs a way for a user
to discover, edit, and delete their own skills.

**Approach.** A new `AgentSkillsDrawer.tsx` reachable from the agent
sidebar showing the user's skills + built-in overrides; each row exposes
"Test", "Edit", "Delete". The Skill Author persona backs each action.

**Effort.** 2 days.

---

## P4 — Long-term / multi-week

### P4.1 `[GAP]` Workspace multi-tenancy agent memory

**Why.** Today `userId` is the only scoping key. The Memory Service keys
the same way, but Easy Forms will eventually support team workspaces;
memory should be `(workspaceId, userId)`-scoped per skill-usage and
per recurring-field memory.

**Effort.** 1 week (depends on a workspace model landing first).

---

### P4.2 `[GAP]` Webhook/integration tools

**Why.** Spec §3.1 "webhooks/integrations" is scoped out of MVP with a
read-first placeholder. The Google Sheet link (in `userModel.ts:71` —
`GoogleSheetAccessToken`) is the first integration target.

**Approach.** Add scope `integrations` (default false in
`permissions.json`), with `link_google_sheet`, `sync_to_sheet`,
`unlink_google_sheet` tools. Mutations go through the sandbox; OAuth flow
is handled out-of-band, agent just stores the resulting access token via
`update_user_integration`.

**Effort.** 2 weeks.

---

### P4.3 `[SAFE]` Audit-everything mode

**Why.** Once the tool catalog grows, the `AgentAuditEvent` row count
grows with it. A per-workspace "audit everything" setting could let the
user opt in to writing every tool call (read + write) to Mongo for
compliance.

**Effort.** 2 days.

---

## Sequencing summary

| Phase | Items | Window | Exit criteria |
|---|---|---|---|
| **P0** defects | D0.1 – D0.10 | 1 week | loop never drifts, never runs past deadline, replan reachable, no PII in trace, cancellable, typed-error reply, trace for reads, Drafter rules contiguous |
| **P1** capability | C1.1 – C1.3 | 3 weeks | 28-tool catalog (or first 4 bundles), skills registry + authoring, memory service |
| **P2** LLMOps + Eval | L2.1–L2.4, E2.5–E2.7 | 2 weeks | stubbed unit eval PR-gating; nightly live eval; per-persona model; secondary provider; pino logger; negative golden prompts; report history + branch coverage |
| **P3** Loop + UX | P3.1–P3.4 | 2 weeks | per-skill budgets, TTL warning, SSE heartbeats, skill drawer UI |
| **P4** long-term | P4.1–P4.3 | 4+ weeks | workspace memory, integrations, audit-all mode |

## Definition of done for v3 upgrades

The upgrade is complete when:
1. All P0 items have shipped and have a stubbed unit-eval row each.
2. At least P1 bundles B1–B3 of C1.1 ship (rest can land in P1B).
3. P2 unit eval is PR-gating in CI; live eval is nightly.
4. Spec §11 "Definition of done" items 1–9 pass.
5. `.agents/Agent.md`, `.agents/design.md`, `.agents/rules.md`, and
   `docs/agent/AGENT-OVERVIEW.md` are updated to reflect the shipped state
   (no doc-rot: every P0/P1/P2 item MUST land a doc patch in the same PR
   it lands code).
