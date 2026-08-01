# Implementation Log

Started: 2026-08-01

## Part A - Hardening (P0-P3)

### P0-1: Remove committed API key from llmHealthMonitor.ts
- **Status**: Done
- **Files**: src/lib/llmHealthMonitor.ts, .env.example
- **Changes**: 
  - Removed hardcoded NVIDIA API key fallback (already using process.env.NVIDIA_API_KEY)
  - Updated getCachedHealthStatus() to return "unknown" by default instead of "online"
  - Fail closed when missing (status: "unknown")
  - Updated .env.example with NVIDIA_API_KEY=
  - Verified grep for nvapi- returns nothing

### P0-2: Fix Form/CustomView form_id intersect guard in run_database_query
- **Status**: Done
- **Files**: src/lib/agentTools.ts
- **Changes**: 
  - Added `resolveFormIdFilter()` helper that handles both ObjectId and hashed formId formats
  - For Response collection: filters by `form_id` (MongoDB _id)
  - For Form collection: filters by `_id` OR `formId` 
  - For CustomView collection: filters by `formId` (hashed string)
  - Properly resolves cross-references between ObjectId and hashed formId
  - Deleted duplicated `Form.find(...).select("_id")` calls

### P0-3: Remove global agent:simulated_offline honoring path
- **Status**: Done
- **Files**: src/agent/agentLoop.ts, src/app/api/agent/simulate-offline/route.ts, src/agent/Agent.md
- **Changes**: 
  - Deleted global-key read block in agentLoop.ts (lines 349-354)
  - Deleted global `else` branch in simulate-offline/route.ts
  - Require `ticketId` in body → 400 `{ error: "ticketId required" }` if absent
  - Updated Agent.md "Simulated offline" section to drop global-key back-compat sentence

### P1-R2: Delete production-write branches from executeAgentTool
- **Status**: Done
- **Files**: src/lib/agentTools.ts
- **Changes**: 
  - Removed create_form, update_form, delete_form cases
  - Added upfront check that throws clear error for mutation tools
  - Verified no callers use these mutation tools via executeAgentTool

### P1-E1: Reconcile Evaluator retry target with documented behavior
- **Status**: Done
- **Files**: src/agent/personas/evaluator.ts, src/agent/Agent.md
- **Changes**: 
  - Changed deterministic-precheck retry from PLANNER to EXECUTOR_SANDBOX
  - Changed LLM-QA shouldRetry from PLANNER to EXECUTOR_SANDBOX
  - Updated Agent.md Evaluator bullet to document the contract

### P1-M1: Capture sandbox snapshot before merge transaction
- **Status**: Done
- **Files**: src/agent/sandbox/sandboxMerge.ts
- **Changes**: 
  - Read sandbox snapshot once before `session.withTransaction`
  - Pass `snapshot` to `mergeFormsAndIntents` and `mergeViews`
  - Removed in-function `get` calls

### P1-R1: Surface merge optimistic-concurrency/no-op failures to user
- **Status**: Done
- **Files**: src/agent/sandbox/sandboxMerge.ts, src/agent/agentLoop.ts, src/agent/sandbox/sandboxStore.ts
- **Changes**: 
  - Updated MergeStats interface with updatesMissed and deletesMissed
  - Track missed updates/deletes in mergeFormsAndIntents with audit events (outcome: "concurrency_miss")
  - Return richer stats from mergeSandboxToProduction
  - agentLoop shows warning when missedCount > 0

### P2-D1: Validate LLM JSON output with per-persona schemas (zod)
- **Status**: Done
- **Files**: src/agent/helper/validate.ts (new), src/agent/personas/drafter.ts, src/agent/personas/evaluator.ts
- **Changes**: 
  - Created validate.ts with DrafterOutputSchema and EvaluatorOutputSchema using zod
  - Added parsePersona function that combines balanced JSON extraction with schema validation
  - Updated drafter.ts to use parsePersona with DrafterOutputSchema
  - Updated evaluator.ts to use parsePersona with EvaluatorOutputSchema
  - Validation failures route to existing clarifying question fallback

### P2-D2: Make Redis↔Mongo persistence order consistent and Mongo-authoritative
- **Status**: Done
- **Files**: src/agent/agentLoop.ts
- **Changes**: 
  - Updated persistStateToRedis to write Mongo first, then Redis
  - Added comment "Mongo is authoritative; Redis is a resume cache" to both markResolved and persistStateToRedis
  - If Mongo fails, Redis is never updated and throw propagates

### P2-D3: Persist sandbox/trace to Mongo only at key transitions
- **Status**: Done
- **Files**: src/agent/agentLoop.ts, src/models/agentTicketModel.ts
- **Changes**: 
  - Added `shouldPersistToMongo()` helper to throttle Mongo writes to key transitions
  - Added `compressTraceForMongo()` to store compressed trace (no payload)
  - Redis gets every transition; Mongo only at DRAFTER, AWAITING_USER_APPROVAL, LLM_ERROR, REJECTED, RESOLVED
  - Added TTL index on AgentTicketModel.createdAt (30 days) with partial filter for transient tickets

### P2-4: Add per-user rate limit on /api/agent/execute
- **Status**: Done
- **Files**: src/app/api/agent/execute/route.ts
- **Changes**: 
  - Added Redis token bucket rate limiting (per-minute and per-day)
  - Env vars: AGENT_RATE_LIMIT_PER_MIN (default 10), AGENT_RATE_LIMIT_PER_DAY (default 200)
  - mergeApproved requests don't count against the limit
  - Returns 429 before opening SSE stream

### P2-5: Broaden PII redaction to response-body fields
- **Status**: Done
- **Files**: src/agent/helper/redact.ts (new), src/agent/personas/evaluator.ts, src/agent/personas/communicator.ts
- **Changes**: 
  - Created shared redact.ts with expanded PII keys (email, phone, ssn, password, address, etc.)
  - Optional value-based redaction via AGENT_REDACT_VALUES=1
  - Updated evaluator.ts and communicator.ts to use shared helper
  - Removed duplicate local redactPII functions

### P2-6: Wire LLMOfflineError handling into Communicator
- **Status**: Done
- **Files**: src/agent/personas/communicator.ts, src/agent/agentLoop.ts
- **Changes**: 
  - Added LLMOfflineError import and handling in communicator.ts
  - On LLMOfflineError: set ticket.status = "LLM_ERROR", return offline reply, clear isComplete
  - On other errors: set ticket.status = "LLM_ERROR", clear isComplete
  - Updated agentLoop.ts to check for LLM_ERROR status and call persistStateToRedis instead of markResolved

### P2-7: Add secret-scan CI gate
- **Status**: Done
- **Files**: .github/workflows/secret-scan.yml, .gitleaks.toml
- **Changes**: 
  - Created Gitleaks workflow for PR/push
  - Added custom rules for NVIDIA, OpenAI, Anthropic, and generic API keys
  - Added explicit grep check for nvapi- pattern

### P3-M2: Replace state! non-null assertions with the activeState alias
- **Status**: Done
- **Files**: src/agent/agentLoop.ts
- **Changes**: 
  - Replaced all 45 `state!` occurrences with `state`
  - Fixed shouldPersistToMongo to check ticket.status instead of activePersona
  - tsc --noEmit passes for agentLoop.ts

### P3-M3: Fix sandboxStore façade signature drift
- **Status**: Done
- **Files**: src/agent/sandbox/sandboxStore.ts (deleted), src/agent/personas/executor.ts, src/agent/agentLoop.ts, src/agent/sandbox/sandboxMerge.ts
- **Changes**: 
  - Deleted sandboxStore façade entirely (Option A)
  - Updated executor.ts to use sandboxRedisStore.saveDraftForm directly
  - Updated agentLoop.ts to import mergeSandboxToProduction from sandboxMerge directly
  - Updated comments referencing sandboxStore

### P3-M5: Make getAuthUserId failure observable
- **Status**: Done
- **Files**: src/app/api/agent/execute/route.ts
- **Changes**: 
  - Added console.warn for JWT verification failures with error name/message
  - Added console.warn when both JWT and session auth fail
  - No behavior change, just observability

### Summary - Part A Complete
All Part A tasks (P0-P3) have been implemented:

**P0 - Ship-stoppers:**
- [x] P0-1: Removed committed API key from llmHealthMonitor.ts, updated .env.example
- [x] P0-2: Fixed Form/CustomView form_id intersect guard in run_database_query
- [x] P0-3: Removed global agent:simulated_offline honoring path

**P1 - Correctness:**
- [x] P1-R1: Surface merge optimistic-concurrency/no-op failures to user
- [x] P1-R2: Deleted production-write branches from executeAgentTool
- [x] P1-E1: Reconciled Evaluator retry target with documented behavior
- [x] P1-M1: Capture sandbox snapshot before merge transaction

**P2 - Robustness & Data Integrity:**
- [x] P2-D1: Validate LLM JSON output with per-persona schemas (zod)
- [x] P2-D2: Make Redis↔Mongo persistence order consistent and Mongo-authoritative
- [x] P2-D3: Persist sandbox/trace to Mongo only at key transitions + TTL index
- [x] P2-4: Add per-user rate limit on /api/agent/execute
- [x] P2-5: Broaden PII redaction to response-body fields
- [x] P2-6: Wire LLMOfflineError handling into Communicator
- [x] P2-7: Add secret-scan CI gate (Gitleaks)

**P3 - Maintainability & DX:**
- [x] P3-M2: Replace state! non-null assertions with activeState alias
- [x] P3-M3: Fix sandboxStore façade signature drift (deleted façade)
- [x] P3-M4: Standardize merge-stats return typing (done as part of P1-R1)
- [x] P3-M5: Make getAuthUserId failure observable

All changes are independently shippable and have verification criteria defined in the implementation plan.

### P0-3: Remove global agent:simulated_offline honoring path
- **Status**: Pending
- **Files**: src/agent/agentLoop.ts, src/app/api/agent/simulate-offline/route.ts

### P1-R1: Surface merge optimistic-concurrency/no-op failures to user
- **Status**: Pending
- **Files**: src/agent/sandbox/sandboxMerge.ts, src/agent/agentLoop.ts

### P1-R2: Delete production-write branches from executeAgentTool
- **Status**: Pending
- **Files**: src/lib/agentTools.ts

### P1-E1: Reconcile Evaluator retry target with documented behavior
- **Status**: Pending
- **Files**: src/agent/personas/evaluator.ts, src/agent/Agent.md

### P1-M1: Capture sandbox snapshot before merge transaction
- **Status**: Pending
- **Files**: src/agent/sandbox/sandboxMerge.ts

### P2-D1: Validate LLM JSON output with per-persona schemas (zod)
- **Status**: Pending
- **Files**: src/agent/personas/drafter.ts, src/agent/personas/evaluator.ts, src/agent/helper/jsonParse.ts

### P2-D2: Make Redis↔Mongo persistence order consistent and Mongo-authoritative
- **Status**: Pending
- **Files**: src/agent/agentLoop.ts

### P2-D3: Persist sandbox/trace to Mongo only at key transitions
- **Status**: Pending
- **Files**: src/agent/agentLoop.ts

### P2-4: Add per-user rate limit on /api/agent/execute
- **Status**: Pending
- **Files**: src/app/api/agent/execute/route.ts

### P2-5: Broaden PII redaction to response-body fields
- **Status**: Pending
- **Files**: src/agent/helper/redact.ts (new), src/agent/personas/evaluator.ts, src/agent/personas/communicator.ts

### P2-6: Wire LLMOfflineError handling into Communicator
- **Status**: Pending
- **Files**: src/agent/personas/communicator.ts

### P2-7: Add secret-scan CI gate
- **Status**: Pending
- **Files**: .github/workflows/secret-scan.yml (new)

### P3-M2: Replace state! non-null assertions with activeState alias
- **Status**: Pending
- **Files**: src/agent/agentLoop.ts

### P3-M3: Fix sandboxStore façade signature drift
- **Status**: Pending
- **Files**: src/agent/sandbox/sandboxStore.ts

### P3-M4: Standardize merge-stats return typing
- **Status**: Pending
- **Files**: src/agent/sandbox/sandboxStore.ts, src/agent/sandbox/sandboxMerge.ts, src/agent/agentLoop.ts

### P3-M5: Make getAuthUserId failure observable
- **Status**: Pending
- **Files**: src/app/api/agent/execute/route.ts