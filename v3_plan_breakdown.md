What This Plan Does to Your Existing Agent — Detailed Breakdown
The One-Sentence Version
Today your agent is a linear pipeline that fixes one prompt at a time, forgets everything between sessions, and can only touch 40% of what your app does. After this plan, it's a hierarchical multi-role system that plans in graphs, executes independent tasks in parallel, remembers your users across sessions, lets them teach it new reusable skills, controls 100% of the app, and never silently fails.
Section 1 — What Your Agent Is Today (The Starting Point)
I'll ground every change against this so you can see exactly what's moving.
Shape. A single while (isLooping) loop in src/agent/agentLoop.ts (~30KB / ~700 lines) calls five personas in strict sequence:
User Prompt
    → Drafter (intent classification, skill pick)
    → Planner (invents an actionPlan[] array — flat, no dependencies)
    → Executor (writes to Redis sandbox; never to Mongo directly)
    → Evaluator (LLM-based QA after execution)
    → Communicator (renders the reply, no streaming)
Memory. conversationHistory capped at 10 turns; sandbox:{userId}:{ticketId} 24h TTL Redis; last 3 resolved tickets read into the Drafter for context. Nothing survives a session.
Tools. 10 of the 28 in the spec (create_form, update_form, delete_form, run_database_query, query_responses, generate_analytics, create_custom_view, update_custom_view, delete_custom_view, get_custom_views).
Safety. Sandbox-first, human-confirm-on-merge, per-user Redis lock, PII key-name redaction. ✅ Solid.
Known defects (from agent_upgrade_v3.md): state drift between Mongo/Redis on crash, lock TTL < worst-case loop time, dead replan path, inflated merge counters, PII leak in trace, no user-abort, all errors collapse to one message, read shortcut leaves no trace, Drafter rules jump 7→20.
Section 2 — What It Becomes After This Plan (The End State)
User Prompt
    → Orchestrator (named class; owns budget, deadline, abort, replan, ACP bus)
        → Planner (DAG output: TaskNode[] + TaskEdge[] — dependencies + conditionals)
        → Critic (pre-flight + post-flight adversarial — was Evaluator)
        → executors/forms.ts, /responses.ts, /views.ts, /generic.ts (parallel, strict tool allow-lists)
        → Communicator (streams tokens via SSE)
    → Memory Service (cross-session recall: recurring fields, skill-usage stats, recent failures)
    → Skills Registry (built-in + user-authored versioned skills)
    → Orchestrator.checkpoint / replay (deterministic replay from any checkpoint)
Tools: 28 (full CRUD — everything an authenticated user can do).
Memory: Tiered — Redis (working) + Mongo (persistent) + vector search (semantic). Cross-session.
Safety: Same invariants, enforced stronger (per-tool-call budget, conditional edges, adversarial critic).
Defects: Every P0 resolved.
Section 3 — The Detailed Breakdown of Every Change
I'll go change-by-change. For each I'll answer what, why we need it, and why we decided that (the decision rationale).
3.1 — Fix the Mongo↔Redis State Drift (Stage 1, Agent A, defect D0.1)
What. Today agentLoop.ts:182-229 has a shouldPersistToMongo conditional that writes Mongo on only 5 of the 7 persona transitions; Redis writes on every transition. A crash between a skipped Mongo write and the next Redis save leaves the resumed state stale — the user re-opens the ticket and sees the wrong persona running.
After: Mongo writes on every transition (using the existing compressTraceForMongo so each row is ~3KB). Redis becomes purely a hot resume cache that can be rebuilt from Mongo.
Why we need it. Resume-after-crash correctness. Today if your laptop dies between the Planner and Executor, you resume from Mongo and the agent re-runs the Drafter. That's a 30-second wasted LLM call and a confused reply. Worse: it can subtly diverge from what was planned.
Why we decided that. The upgrade plan's "Mongo is authoritative; Redis is a rebuildable hot cache" comment was already in the code — the conditional just never matched the comment. The fix is to make it match. We considered adding a write-ahead-log; rejected as over-engineering for a single-server deploy.
3.2 — Add a Loop Deadline + Raise the Lock TTL (Stage 1, Agent A, defect D0.2)
What. Today the per-user Redis lock is 60 seconds, but a 4-persona × 3-retry × 30s LLM-timeout loop can run ~6 minutes. When the lock expires mid-run, lock.stale() only logs a warning and the loop continues — it can write stale state from a parallel run.
After:
- New LOOP_DEADLINE_MS env (default 120000) checked at the top of every while iteration; on expiry throws the new typed LoopTimeoutError.
- LOCK_TTL_MS auto-set to max(LOOP_DEADLINE_MS, 60000) + 5000.
Why we need it. Without a wall-clock budget, a stuck LLM call can hold a user hostage for minutes. The user can't even start a new conversation in another tab because the per-user lock is held.
Why we decided that. Spec §4.2 explicitly calls out the missing deadline as a defect. We considered a heartbeat-renewal approach (lock.renew() every 15s) — rejected because the deadline-plus-TTL-buffer is simpler and the spec calls it "the simpler choice". The 120s default is env-tunable so you can raise it for slow providers.
3.3 — Make Replan Actually Reachable (Stage 1, Agent A, defect D0.3)
What. Today on shouldRetry, the Evaluator routes back to EXECUTOR_SANDBOX with the same actionPlan. The Planner's feedbackPreamble (planner.ts:124-128) was written to support a replan path but is unreachable from the normal retry flow.
After:
- 1st retry → EXECUTOR_SANDBOX (transient retry — same as today)
- 2nd retry → PLANNER_MIXER with evaluatorFeedback (replan with the failed plan cached alongside)
- 3rd → COMMUNICATOR asks the user
The Evaluator returns decision: "retry" | "replan" | "ask_user" | "complete" instead of just shouldRetry.
Why we need it. Today a structurally-wrong plan (e.g., LLM picked update_form when the user wanted create_form) cannot recover. We waste all 3 retry iterations on identical Executor runs of the same bad plan.
Why we decided that. Two retries of the same thing is the maximum useful transient retry; after that you need a different plan, not the same plan harder. The 3rd-to-user escalation caps the budget — the user is told "I couldn't figure this out, here's what I tried, what should I do?" instead of silently exhausting retries with a generic failure.
3.4 — Add a User-Abort Signal (Stage 1, Agent A, defect D0.7)
What. Today the user can cancel a running loop only by closing the SSE stream — and even then the server-side loop keeps running until it releases the lock.
After:
- New agent:abort:{ticketId} Redis flag, polled at the top of every while iteration.
- New AgentCancelledError typed error class.
- New POST /api/agent/abort route.
- On detection: handleFailure(new AgentCancelledError(...)), set Mongo ticket status: "CANCELLED", release the lock, emit {type:"cancelled"} SSE event before [DONE].
Why we need it. Without this, a user who starts a 4-form build and realizes they typed the wrong name is stuck watching the agent plan the wrong thing for 90 seconds. They can refresh, but the server is still burning LLM tokens on the wrong ticket.
Why we decided that. Spec §4.2 calls this out explicitly. The poll-at-top-of-loop approach costs one Redis GET per iteration (~0.2ms) — negligible. We considered Redis pubsub for instant cancel; rejected because the loop-iteration poll is already fast enough for a 90s-loop and is simpler.
3.5 — Typed Error Replies (Stage 1, Agent A, defect D0.9)
What. Today handleFailure collapses LLMRateLimitError / LLMTimeoutError / LLMHTTPError into one generic "AI processing interrupted" message.
After: each typed error maps to a user-readable recovery message:
- timeout → "the AI is taking longer than expected"
- rate-limit → "too many requests, please slow down"
- HTTP 5xx → "the AI provider had a transient issue, retry shortly"
A new ticket.errorKind field (added by Agent C to agentTicketModel.ts) lets the admin dashboard break down failures by type.
Why we need it. The user can't tell whether to wait, slow down, or report a bug. The admin dashboard can't tell which provider is flaky. We're flying blind on error classification.
Why we decided that. Typed errors already exist in llmClient.ts — handleFailure just stopped branching on them. The fix is branch-on-existing-types, not introduce-new-types. We keep LLM_ERROR as the Mongo status (backward compat with the existing UI) and add errorKind as the diagnostic sub-field.
3.6 — PII Redaction in Trace (Stage 1, Agent D, defect D0.6)
What. Today addTrace stores llmRawOutput as-is, up to 4KB. If a user's prompt mentions me@example.com and the LLM echoes it, PII lands in Redis, Mongo, AND the SSE stream.
After: new redactTracePayload(obj) recursive tree-walker in redact.ts runs before the truncation check in addTrace. For llmRawOutput specifically (a string), apply value-based regex redaction (email, phone, SSN, credit-card patterns) → [REDACTED:email]. For all other keys, keep the existing key-name-based behavior.
Why we need it. PII leak is a real security/compliance exposure, especially if a user pastes their customer's email or phone into a prompt asking the agent to "build a form for this customer."
Why we decided that. The key-name-only redaction redactPII does today misses User Email Address or any string in a free-text key. But applying value-based redaction to everything would false-positive on legit form content ("Email" is a field label, after all). So we scope value-based redaction strictly to the llmRawOutput channel — the one place the LLM's full output gets logged. The split mirrors the spec §7 "PII redaction in trace" line item exactly.
3.7 — Trace Step for Read-Only Shortcuts (Stage 1, Agent A, defect D0.10)
What. Today drafter.ts:216-242 calls executeAgentTool directly on READ_ONLY_SKILLS, skipping the Planner and Executor — fast, but leaves no ExecutionTraceStep and no AgentUsage row. "List my forms" leaves no persistent trail.
After: push a minimal trace step { persona: "DRAFTER", message: "Read query: <toolName>", result, ts: Date.now() } into state.executionTrace after the read.
Why we need it. Observability hole. You can't answer "did the agent just read this user's forms an hour ago?" because there's no record. For compliance and debugging, every agent action should leave a trace.
Why we decided that. The full Planner → Executor → Evaluator pipeline for a read query would cost 2 extra LLM calls (~60-70% token waste per the spec). The shortcut stays; we just add the breadcrumb. The spec calls this out explicitly: "Document that the read shortcut deliberately skips Planner/Executor/Evaluator."
3.8 — Drafter Prompt Rule Renumbering (Stage 1, defects D0.8)
What. Today prompts.ts:20-27 has rules numbered 1..7 then 20..20 (missing 8-19). The versioned JSON at prompts/v1/drafter.json was supposed to be canonical but isn't being used.
After:
- prompts/v1/drafter.json renumbered contiguously 1..N (Agent B owns the JSON).
- prompts.ts demoted to a fallback-only path that logs a warning when used (Agent A owns the .ts).
Why we need it. A prompt-edit scar this visible threatens every reviewer's trust. If rules 8-19 were important, they're gone; if they weren't, the prompt is misleading. Today nobody can tell.
Why we decided that. Risk: renumbering alone changes the prompt and may move eval results. So the plan says: run npm run agent:eval before and after, investigate drift before merging. Renumbering is a one-shot cleanup, not a re-design.
3.9 — Merge Counters Split (Stage 1, Agent B, defect D0.4)
What. Today sandboxMerge.ts:380-385 returns mergedForms = mergedForms + updatesApplied + deletesApplied. The Communicator then prints "Forms created: X" where X includes updates + deletes. "Forms created: 2" when the user actually updated 1 and deleted 1.
After: return the raw { mergedForms, mergedViews, updatesApplied, updatesMissed, deletesApplied, deletesMissed } dict via the new MergeStats type in src/agent/sandbox/types.ts. The Communicator (Agent A's) renders all six counters separately.
Why we need it. The current reply is a user-faced lie. Users make merge decisions based on what the agent told them it did.
Why we decided that. Risk: just reply-text. Fix: a returned type + renderer update. The "missed" counters already have a warning branch; we expose it cleanly instead of folding it into a misleading total.
3.10 — 18 New Tools Across 6 Bundles (Stage 2, Agent B)
What. Today the catalog has 10 of the 28 tools in spec §3.1. Stage 2 adds the missing 18 in dependency-ordered bundles:
Bundle	Tools	Maps to existing API
B1 element ops	add_form_element, update_form_element, remove_form_element, reorder_form_elements	sub-ops of update_form
B2 form lifecycle	set_form_status, update_form_metadata_settings	toggle form.status, ip/UA/geo/referrer flags
B3 user/account	update_user_profile, update_user_preferences, update_notification_settings	PATCH /api/settings/{profile,preferences,notification}
B4 notifications	list_notifications, mark_notification_read, clear_notification	GET/PATCH/DELETE /api/notifications/[userId]
B5 reads	dashboard_stats, list_agent_audit_events, list_agent_tickets	GET /api/dashboard, new read routes
B6 exports	export_form (csv/json/pdf)	GET /api/export/{csv,json,pdf} returns a signed short-lived URL (not inline payload)
Each tool ships with: a Zod 4 schema in tools.ts, an impl in agentTools.ts or executor.ts, a permission scope mapping in permissions.ts + permissions.json, a guidelines.md entry, a built-in skill reference in registry.json, and one golden + one negative prompt.
Why we need it. Spec §1 says the agent must do "everything an authenticated user can do." Today it controls ~40% of the surface. A user who asks "pause my feedback form" / "mark my last notification as read" / "update my profile country" hears "I can't do that" — they then leave the chat to do it themselves, defeating the agent.
Why we decided that. Bundle order matters because of sandbox-merge dependency:
- B1 (element ops) reuses the existing Form merge path — cheapest first.
- B2 (form lifecycle) needs a new MergeableKind for $set form.status / form.metadataSettings — extends the merge engine.
- B3 (user/account) extends merge AGAIN to User.updateOne({_id:userId}, {$set: ...}) with the USER_SAFE_FIELDS allowlist (["name", "country", "language", "theme", "dateFormat", "timeFormat", "notificationSettings"]) — no password, email, isGoogleAuth, isAdmin, verify* fields, because letting the agent touch those would let a user soft-lock their own account via the chat.
- B4 (notifications) is the explicit exemption from sandbox (per spec §3.1): "mark read" is reversible, so direct-write-with-audit is fine. Documented so future devs don't take it as license to skip the sandbox elsewhere.
- B5 (reads) needs new Mongo aggregations (Agent C's dashboardModel.ts), so Agent B's agentTools.ts calls a frozen contract function — keeps all Mongo query logic in one team's ownership.
- B6 (exports) returns a signed URL not inline bytes — the spec's reasoning is "could blow the SSE stream budget." Decision: 5-min HMAC-signed URL via crypto.createHmac.
The USER_SAFE_FIELDS allowlist is the one decision worth flagging — we whitelist rather than blacklist, because the failure mode of "agent set my isAdmin to true" is catastrophic and irreversible.
3.11 — Skills Registry: Replace Free-Text Skills with First-Class Versioned Artifacts (Stage 2, Agent B)
What. Today skills are free text in src/agent/skills.md (6 of them). The Planner re-invents the tool list per LLM call — non-deterministic and impossible to evaluate. Adding a skill requires a code change.
After:
- src/agent/skills/registry.json ships 6 built-in skills as JSON objects:
{
  "skillId": "build_form",
  "version": "1.0.0",
  "permissionScope": "form_management",
  "tools": [{ "tool": "create_form", "paramsFrom": "requirements" }],
  "maxIterations": 2,
  "negativeTests": [{ "assert": "actionPlan[0].params.elements.length >= 1" }],
  "dryRunShape": { "_id": "string", "formId": "string" }
}
- A new SkillRouter persona (Agent A) resolves a Drafter-emitted skill name to a SkillDefinition. Multi-skill tickets ("build a form AND set up a custom view") become first-class — the Skill Router concatenates templates.
- The Planner refactors from "invent the tool list" to "fill params into the matched template" — a much smaller LLM call (~50% token cut).
Why we need it. Non-determinism is the #1 reason agent evals flake. Today you can't say "did this prompt do the same thing last Tuesday?" — the Planner invents a different plan every time. With the registry, the plan template is fixed; only the params vary. And it unlocks Stage 3's Skill Author persona (user-taught skills) — impossible if skills are hardcoded.
Why we decided that. The shape came straight from spec §6.1. The maxIterations field per skill is the fix for the shared-budget defect (a 1-tool read and a 4-tool multi-skill build sharing the same 3-iteration budget). The negativeTests[] field is what lets the Evaluator run deterministic bit-checks before the LLM-based QA — the LLM-only evaluator today is what produces false-positive isComplete.
3.12 — Per-Skill maxIterations Budget Override (Stage 2, Agent A)
What. Today MAX_ITERATIONS=3 is loop-wide. A query_responses read (1 tool, no retry needed) and a multi-skill build (4 tools, needs 3-4 retries) share the same budget.
After: each skill in registry.json declares maxIterations. The Orchestrator (still agentLoop.ts in Stage 2; promoted to a class in Stage 3) reads it at ticket start and overrides the default. Read skills set 1; build skills 2-3; multi-skill 4.
Why we need it. Today a 1-tool read either wastes 2 unused retry slots, OR a multi-skill build runs out of budget at iteration 3 with no fallback. There's no way to express "this is harder, give it more room."
Why we decided that. Per-skill config beats per-loop config because it scales with skill complexity automatically — new skills bring their own budgets; the loop defaults stay sensible. The override is just a constant lookup at ticket start; no architectural change.
3.13 — Memory Service: Cross-Session Recall (Stage 2, Agent C)
What. Today the cross-session surface is the last 3 resolved tickets. The Drafter can't tell "you always add an Email field to your contact forms" because the 4th-most-recent ticket is already gone.
After: a new MemoryService with concrete Mongo models:
Model	Holds
AgentMemoryModel	userId, key, value, confidence, lastUsedAt — recurring form fields, recurring filters, recurring naming patterns
AgentSkillUsageModel	userId, skill, count, successRate, avgIterations, lastUsedAt
AgentFailureModel	userId, promptHash, lastError, count, lastAt
API: getMemory, setMemory (upsert + confidence bump, max 0.9), recordSkillUse, recordFailure, recentFailures, summarize.
The Drafter reads memory at ticket start (getMemory(userId, "recurring_fields"), recentFailures(userId, 7d)). The Evaluator writes back after a successful merge. Memory writes are Zod-validated and PI-redacted before persistence.
Why we need it. The agent today is an amnesiac. It can't learn "this user always uses NPS 0-10 + comments" — every contact form starts from scratch. Spec §5 calls this out as the #1 cross-session continuity gap.
Why we decided that. Confidence-scored upserts (single observation = 0.3, recurring rises to 0.9) — chosen over binary "remembered/not" because a single observation is weak evidence; five observations is strong. PII redaction on writes is non-negotiable because memory is the highest-value PII leak surface (it accumulates). The user-revocable "forget everything about X" tool is the spec's safety valve — required for GDPR-style erasure.
3.14 — Memory Compaction (Stage 2, Agent C)
What. Tickets resumed many times accumulate unbounded sandbox.queryResults and executionTrace.
After: summarize(ticketId) replaces each completed-iteration's raw result with a one-line digest the Evaluator reads on retries (instead of re-parsing the raw payload). LRU cap on sandbox.queryResults (default 8) — older evicted to Mongo AgentTicket.executionTrace. Proactive sandbox-TTL warning: on resume, if agentRedis.client.ttl(sandboxKey) < 2h, the Communicator adds "This draft expires in Xh — click Merge soon."
Why we need it. Sandbox bloat is real for long-running tickets. Today a ticket resumed 20 times has 20 iterations' worth of query results in Redis. The Evaluator re-parses all of them every retry — costs grow quadratically.
Why we decided that. LRU + digest is the standard OS memory-management pattern applied to LLM context. The 2h TTL warning gives the user time to merge without losing work — the 24h hard-throw at merge time today produces a ticket the user has to start over.
3.15 — Communicator Token Streaming (Stage 3, Agent A + D)
What. Today the Communicator calls callLLM non-streaming and waits for the full reply before sending anything to the SSE stream. The user stares at a spinner for 8 seconds while the LLM generates the entire reply.
After: callLLMStream(opts, onChunk) exposed from llmClient.ts (Agent D). The Communicator (Agent A) calls it with stream: true. Each token delta is routed as {type:"token", persona, delta} into the SSE stream. Drafter/Planner/Critic stay non-stream — their JSON contracts need the full body.
Critical detail: under any streaming exception, silently fall back to non-streaming messages.create (the inspiration_breakdown.md §2 pattern — "a streaming hiccup never breaks a turn").
Why we need it. 8s spinner is bad UX; users think the agent is frozen. Streaming makes the perceived latency feel ~3x lower.
Why we decided that. The split — Communicator streams, others don't — is because the four non-Communicator personas output JSON the loop parses with safeJSON. Streaming JSON parse is a real engineering project (agentLoop.ts:272-301 already has a non-streaming thoughtProcess extractor; making it streaming is doable but not worth the risk for non-user-facing calls). Communicator output goes straight to the user as text; streaming is safe.
3.16 — The Big One: Loop Refactor into Hierarchical Multi-Agent (Stage 3, Agent A)
What. Today agentLoop.ts is a linear while loop dispatching five personas in sequence. The inline machinery (budget check, deadline check, abort poll, replan escalation, trace addTrace, SSE emit) lives inline in the while body.
After: the inline machinery is promoted into named classes:
- src/agent/orchestrator/loop.ts → Orchestrator class. Owns the budget, deadline, abort, replan gates. Emits typed SSE/WS events at every transition ({type:"persona", persona}, {type:"trace", step}, {type:"token", persona, delta}, {type:"busy"}, {type:"complete", state}, {type:"error"}). The only role allowed to call other roles — so budgets can't be silently bypassed.
- src/agent/critic/index.ts → Critic role (the existing Evaluator, grown). Pre-flight: schema-validate the plan, scan for tool-hallucination (any tool not in ALLOWED_TOOLS), scan for cross-tenant form-id. Post-flight: deterministic bit-checks from the skill's negativeTests[] + LLM-based adversarial red-team. Returns CriticVerdict.
- src/agent/executors/{forms,responses,views,generic}.ts → the monolithic Executor persona is decomposed into domain executors. Each owns a strict subset of the tool catalog:
- executor_forms → create_form, update_form, delete_form, read_form, bulk_create_forms (when enabled)
- executor_responses → query_responses, generate_analytics, run_database_query, export_responses (all read-only!)
- executor_views → create_custom_view, update_custom_view, delete_custom_view, get_custom_views
- executor_generic → run_database_query (admin), bulk operations
Tool allow-list enforced via getAllowedTools(role) in permissions.ts (Agent B).
- src/agent/personas/planner.ts (extended) → DAG Planner. Emits ExecutionPlan with TaskNode[] + TaskEdge[] (dependencies AND conditionals). Conditional edges use code-evaluated predicates — result.count > 100 style — not LLM-evaluated prose, per inspiration_breakdown.md §2: "Routing on the model's wording would hand control flow to the model AND make the branch impossible to test."
- src/agent/orchestrator/lock.ts → per-execution lock agent_lock:{userId}:{executionId} — independent of the existing agent_lock:{userId}, so concurrent multi-intent tickets per user work in parallel.
- src/agent/orchestrator/budget.ts → per-tool-call budget tracker. Throws BudgetExceededError mid-execution; orchestrator checkpoints state and returns status: "partial" (not a hard fail).
- src/agent/orchestrator/audit.ts → every LLM call logged with {input, output, reasoning, ts} for "why did the agent do X?" debugging.
- src/agent/orchestrator/replay.ts → replayFromCheckpoint(executionId, checkpointId) reconstructs sandbox + memory state and re-runs the plan from that point. Counterfactual replay supported.
- src/agent/orchestrator/legacyShim.ts → runAgentLoop(userId, prompt, ...) wraps Orchestrator.execute(), converts legacy AgentState ↔ ExecutionState. The existing route at /api/agent/execute signature stays identical. Reads AGENT_V3_ENABLED; if true, new tickets route through the shim; otherwise the linear path runs unchanged. The shim is temporary — deleted once in-flight tickets drain.
Why we need it. Three concrete reasons:
1. Multi-intent prompts are dead today. "Analyze last week's feedback, extract complaints, build a new satisfaction survey with conditional follow-ups" — today the Drafter forces a single skill enum, dropping the secondary intent. The DAG planner emits 4 tasks; the Orchestrator runs the first 3 in parallel; the 4th depends on the 3rd's output.
2. Linear execution wastes wall-clock. "Build 2 forms and link via a custom view" — the 2 form-builds are independent; today they run sequentially through one Executor persona. Parallel executors cut wall-clock by ~40%.
3. The Evaluator today is post-hoc only. A hallucinated delete_form tool call is caught only after the sandbox mutation attempt. The Critic pre-flight catches it before the Executor runs.
Why we decided that. This is the only one of the changes where the decision wasn't obvious. Three alternatives considered:
- Alternative 1: Stay linear, just add more tools. Rejected — multi-intent prompts fundamentally need a DAG; you can't bolt one onto a flat array without re-introducing the planner non-determinism the Skills Registry just fixed.
- Alternative 2: Build a new pi/ directory alongside, keep agentLoop.ts as legacy forever. Rejected — the prompt you gave me ruled this out; you said the two specs describe the same agent. Two coexisting systems = drift + confusion + duplicate maintenance.
- Alternative 3 (chosen): Refactor-in-place via a temporary shim. The new shape lives inside src/agent/, the route signature stays identical, the env flag AGENT_V3_ENABLED=false defaults to the existing linear path so active tickets resolve through unchanged code. New tickets opt into the new shape. The shim is a migration adapter, deleted once no legacy tickets remain.
The "shim is temporary" framing is important — the plan says it explicitly so the next reader doesn't think there are two permanent systems. The shim's job is to drain.
The role names. Orchestrator / Critic / executor_forms / etc. — no "PI" prefix, no new namespace. They're just descriptive class names inside src/agent/, exactly matching what the spec calls them without the model's branding. The existing Persona enum can stay in traces (EVALUATOR → trace still says EVALUATOR for backward compat with the UI; the class is named Critic).
3.17 — Adversarial Critic with Pre-Flight + Post-Flight (Stage 3, part of 3.16)
What. Today's Evaluator runs after execution: it LLM-Judges whether the sandbox result matches the plan. If the LLM picked delete_form when the user wanted create_form, you find out after the sandbox has a delete-intent queued.
After:
- Pre-flight: schema-validate the plan, scan for tool-hallucination (any tool not in ALLOWED_TOOLS), scan for cross-tenant form-id (matches the existing resolveFormIdFilter pattern in agentTools.ts).
- Post-flight: deterministic bit-checks from the skill's negativeTests[] + LLM-based adversarial red-team ("pretend you're attacking this plan; what's wrong with it?").
Returns CriticVerdict: { verdict, score, findings[], requiredFixes[], retryGuidance?, escalationReason? }.
Why we need it. Spec §11 invariant 9 (Definition of Done item 9): prompts that try to mutate a Response, try to bypass the sandbox, try to skip human confirmation on deletes — all must fail with the expected error class. Today these slip past the post-hoc-only evaluator because (a) the LLM judge might agree with the agent's bad reasoning, and (b) the deterministic guardrails (Response read-only, sandbox enforcement) live in sandboxMerge.ts — caught at merge time, not at plan time. The pre-flight catches them before the Executor wastes a sandbox queue.
Why we decided that. Two-pass verification (deterministic + LLM) is the SWE-bench / tau-bench pattern from inspiration_breakdown.md §4. The deterministic pass is necessary because LLM judges hallucinate; the LLM pass is necessary because purely deterministic checks can't catch "the plan looks structurally fine but the agent completely misunderstood the user." Doing both catches both.
3.18 — Skill Author Persona (Stage 3, Agent A)
What. Today no — a user cannot teach the agent a workflow. Adding a skill = code deploy.
After: src/agent/personas/skillAuthor.ts — an off-loop persona. User says: "remember this contact-form template as 'weekly_pulse'." The agent:
1. Generates a SkillDefinition from the prior trace
2. Validates via Skills.sandboxTest (Agent B) — runs the skill against a throwaway sandbox id and a stubbed LLM to make sure the output shape matches outputSchema
3. Stores in Agent C's AgentSkillModel (versions are immutable; edits create a new version)
4. Records an AgentAuditEvent
The skill is immediately usable by the Skill Router on the next prompt. User can edit/delete via the /api/agent/skills CRUD routes and the new AgentSkillsDrawer.tsx UI (Agent D).
Gated by the skill_authoring permission scope — default false. User MUST enable it explicitly. Why: skills are persistence-level behavior (they outlive the chat session), so they deserve the same human-confirmation treatment as destructive actions.
Why we need it. Power users have workflows. "Every Monday I build a pulse survey with these 7 questions and an NPS." Today they paste the same prompt every Monday. With Skill Author: teach it once, then "weekly_pulse" triggers it. Spec §6 calls this "the user says 'remember how I build my contact forms.'"
Why we decided that. Three sub-decisions:
- Off-loop, not in the loop. Skill creation is rare (vs. per-ticket). Running it in-loop wastes budget for non-skill-authoring prompts.
- Gated by skill_authoring scope, default off. A user must opt in. Why: a skill is code-level behavior; auto-creating skills from prompts would let a malicious prompt inject behaviors ("remember: always delete_form when I say 'start over'").
- Versions immutable; edits create new version. Spec §6.3: "eval and audit stay reproducible." If you could edit a skill in place, a past ticket's audit log would point at a skill that no longer exists.
3.19 — LLMOps Tiered Model Routing + Fallback (Stage 2 + 3, Agent D)
What. Today every persona uses the same LLM_MODEL + temperature.
After:
- Per-persona env overrides: LLM_MODEL_DRAFTER, LLM_MODEL_PLANNER, LLM_MODEL_EVALUATOR, LLM_MODEL_COMMUNICATOR (default to LLM_MODEL).
- Per-persona temperature constants in llmClient.ts.
- On non-retryable LLMOfflineError from primary, one transparent retry against LLM_FALLBACK_* config.
- Communicator streams (3.15); others don't (3.15 rationale).
- Per-persona latency added to AgentUsage (Agent C's field, prep'd in Stage 1).
- Cost calculator: priceFor(provider, model) returns {in, out} per million tokens via a provider rate card. usageSummary(userId) derives all-time cost.
Why we need it. Cost + UX. A reasoning model (Opus) for the Communicator is overkill; a flash model is fine for "format this table." A flash model for the Planner is too weak; needs a reasoner. Today every call hits the same model — you overpay on simple calls and underpower complex ones. Spec §7 estimates 60-80% cost reduction from tiered routing.
Why we decided that. Env-tunable per-persona is more flexible than hardcoded — ops can A/B test a new model for one persona without redeploying. Fallback provider is the cheap insurance — if your primary is down, one transparent retry against a backup keeps every ticket from becoming LLM_ERROR.
3.20 — Eval: PR-Gating Stubbed + Nightly Live (Stage 3, Agent D)
What. Today's 50-prompt live suite is non-deterministic, costs real LLM tokens per CI run, and creates real Form/User docs as side effects — cannot gate PRs without flaking.
After:
- Unit (stubbed) — tests/agent/eval/stubRunner.ts runs on npm run agent:eval. Uses the existing __testRetryLLMOverride hook to mock LLM; record/replay fixtures under tests/agent/eval/fixtures/. Deterministic, finishes in <30s. PR-gating.
- Live (nightly) — tests/agent/eval/runner.ts runs on npm run agent:eval:live. Real LLM, throwaway Mongo. Writes JSON report to tests/agent/eval/reports/<ISO>.json. diffReports.js summaries regressions vs the previous night.
- Negative prompts — at least 10: try-mutate-Response, cross-tenant-form-id, delete-when-destructive-disabled, abort-signal, loop-deadline, set-isAdmin, read-other-user-notifications, raw-CSV-in-chat, skill-with-bad-requiredTools, update_user_profile-touching-auth-field.
- Branch coverage — each golden prompt tagged with branches: string[]; runner emits % branches hit so untested branches surface.
Why we need it. Without PR-gating, regressions land in prod and get found by users. Without nightly-live, LLM-provider drift (a model upgrade behaving differently) goes unnoticed until a user complains.
Why we decided that. Stubbed-for-PR + live-for-nightly is the standard eval-platform pattern (tau-bench / SWE-bench both do this). Fixtures over full LLM calls for the PR gate because flakes don't gate. Negative prompts are the spec §11 DoD item 9 enforcement mechanism — they encode the invariants that the implementation must not violate.
3.21 — Deterministic Replay from Checkpoints (Stage 3, Agent A + C)
What. Today you cannot reproduce a failed ticket — the sandbox might have expired, the LLM is non-deterministic.
After:
- src/agent/orchestrator/audit.ts writes an OrchestratorAuditModel row for every LLM call with {input, output, reasoning, ts}.
- OrchestratorCheckpointModel snapshots taskStateSnapshot, sandboxSnapshotSha256, memoryPointers after every successful task.
- replayFromCheckpoint(executionId, checkpointId) reconstructs the sandbox + memory state, re-runs the plan from that point with the same LLM inputs (captured from the audit log).
- Counterfactual replay: "what if tool X returned Y?" — modify the captured result at the checkpoint, re-execute downstream.
Why we need it. "Why did the agent do X?" is the #1 production-debugging question. Today we have truncated executionTrace entries; we can't reproduce. Replay makes the agent debuggable like a normal program.
Why we decided that. Replay is the SWE-bench pattern (inspiration_breakdown.md §4). The cost is one Mongo row per LLM call (bounded by the audit log) + one checkpoint per task — small. The benefit is huge for incident response and Skill Synthesis (Stage 3.6's "propose skill from patterns" needs successful traces to mine).
3.22 — Per-Execution Lock for Parallel Multi-Intent Tickets (Stage 3, Agent A)
What. Today agent_lock:{userId} serializes everything for a user. Two browser tabs = "I'm already running a ticket for you, try again later."
After: agent_lock:{userId}:{executionId} — independent of the existing per-user lock. Two executions for the same user can run in parallel as long as they target different resources. The per-user lock stays for legacy single-intent tickets (backward compat).
Why we need it. User opens the agent in tab A and asks "build my NPS form." While that's running, they switch to tab B and ask "what's my dashboard stats" — today tab B is locked out. With per-execution lock, both run.
Why we decided that. Per-resource locking (agent_lock:{userId}:{targetResourceId}) was the spec §2.3 proposal but the failure modes of fine-grained locks (deadlocks, lock-starvation) outweigh the benefit. Per-execution is the middle ground: same user, different tickets, parallel OK; same ticket, re-resume is still locked.
3.23 — Structured Logging + App Insights (Stage 3, Agent D)
What. Today agentLoop.ts:83 does console.log("LLM Raw Output:", rawContent). Production debugging means grepping stdout.
After: src/lib/logger.ts is built in Stage 1 as a thin pino adapter. Stage 3 ships the full version with named child loggers (logInfo.child({userId, ticketId, persona})) and an App Insights adapter wired via the appinsights-instrumentation skill. Every console.* in the agent tree is replaced.
Why we need it. Correlating a ticket failure to a specific LLM call requires grepping stdout today. With structured logs you can query tickets where persona=EVALUATOR and status=error and model=gemini-pro — that's the difference between 5 minutes and 5 hours.
Why we decided that. Pino + App Insights via the existing skill — no new "second logger" introduced (the codebase doesn't have one yet). Choreographed swap: Agent D ships the logger first as an isolated commit; Agent A does the mechanical console.* → logX swap in its owned files.
3.24 — Selective Cherry-Pick Merge (Stage 2, Agent D + Agent A + Agent B)
What. Today the merge modal asks the user to "Confirm & Merge" — all or nothing. If the agent's plan produced 3 changes and the user only wanted 2, they have to reject everything and try again.
After: AgentConfirmationModal.tsx (Agent D's) gets per-action checkboxes. The user can approve just 2 of 3 sandbox actions. The frontend POSTs the array of selected actionIds. agentLoop.ts (Agent A) reads mergeApprovedActionIds; passes to sandboxMerge.ts (Agent B) which filters by id and applies only the selected subset.
Why we need it. Today's all-or-nothing merge creates a "the agent slightly misread me, now I have to start over" UX failure. Selective merge lets the user pick the wins and discard the rest.
Why we decided that. The coordinated change is across 3 agents (D's UI → A's loop → B's merge). The contract sheet (MergeRequest = { ticketId, userId, mergeApprovedActionIds: string[] }) is frozen before the stage so they all code against the same shape. Agent A's edit is a one-line passthrough (sends the array); B's is the filter-by-id; D's is the checkboxes. No two agents edit the same file.
3.25 — Sandbox Preview Modal (Stage 2, Agent D)
What. Today the user sees a JSON-ish diff in the confirmation modal and has to imagine what the form will look like merged.
After: src/components/ActionBar/SandboxPreviewModal.tsx mounts the actual FormRenderer against the sandboxed Redis schema. Test validations, fill dummy data, preview responsive layouts before merging.
Why we need it. "What will this form look like when merged?" is the question the user is actually asking when they decide to merge. Today's diff doesn't answer it.
Why we decided that. Direct from agy_implementation_plan.md Phase 2. The form is already in Redis (just sandboxed); rendering it is a pure read; small lift, big UX win.
Section 4 — Why Four Parallel Agents, and Why These Four?
The split isn't arbitrary — it's organized by what changes when:
Agent	Owns the part of the system that...	Why it has to be one team
A — Loop & Orchestration	...schedules and dispatches other parts	All scheduling state lives in agentLoop.ts. If two agents edit it, you get merge conflicts on every retry-loop change. One team owns the spine.
B — Tools, Sandbox & Policy	...executes mutations safely	Every new tool touches tools.ts, agentTools.ts, permissions.ts, sandboxMerge.ts together (the design.md A4 mandate). Splitting these across teams breaks the invariant that they ship together.
C — Memory & Models	...persists data	Mongo schemas and indexes drift catastrophically under split ownership — Agent A writes a field that Agent C's schema doesn't have. One team owns every Mongo file.
D — LLMOps, Eval, UI & Docs	...talks to the LLM provider and the user	LLM calls and eval assertions need to evolve together — an assertion shape change in the eval runner breaks the LLM mock fixtures. One team owns both.
The four roles are constant across all stages — predictability of ownership is the precondition for safe parallelism. Within a stage, every file appears in exactly one agent's column of the matrix; agents are forbidden from touching others' files.
Section 5 — Why Three Stages, Not One Big Stage or Five Small Ones?
- One stage would mean 18 new tools + a loop refactor + 30 eval fixtures all at once — too much surface to land safely behind one integration commit.
- Five stages would be over-gated — Stages 4 and 5 would land on a stable base, with low marginal value.
- Three stages mirror the natural dependency order: fix broken foundations → build capability → refactor the loop to use them. The merge-engine changes in Stage 2 cannot ship until the merge stats defect in Stage 1 is fixed; the loop refactor in Stage 3 cannot ship until the contract sheet in Stage 1 and the tool catalog in Stage 2 are stable.
Section 6 — Cost of Doing Nothing
Worth surfacing: if you don't do this plan, the specific failures you'll keep seeing are:
1. Users complain: "I asked to pause my form, the agent said it can't" — the 18 missing tools.
2. Resume after a crash shows the wrong persona running — state drift (D0.1).
3. A user paces the loop with bad prompts; you can't cancel without restarting the server — no abort (D0.7).
4. Agent takes 6 minutes with no timeout — no deadline (D0.2).
5. Same prompt behaves differently every run — non-deterministic Planner (no Skills Registry).
6. The agent forgets everything between sessions — no Memory Service.
7. "Why did the agent do this?" — un-reproducible (no replay, no audit rationale).
8. LLM-provider outage = global outage (no fallback).
The plan is staged so that even if you stop after Stage 1, you've fixed defects 1-4 in the list above — every P0 is resolved. Stage 2 alone (skip 3) gets you the full CRUD surface + memory + skills. Stage 3 is the architectural refactor — only worth it if the multi-intent and parallelism gains matter for your user base.
Want me to go deeper on any specific change, or walk the file changes for any single task end-to-end?