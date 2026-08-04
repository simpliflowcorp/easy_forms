# Easy Forms Agent — Troubleshooting Playbook

Diagnostic flow for the most common agent-subsystem failures. Work the
symptom → check → fix ladder top-down.

---

## 1. The ticket shows `LLM_ERROR`

**Checks**
1. `npm run agent:load` / a stubbed eval row — is the LLM path reachable?
2. `.env` has `NVIDIA_API_KEY` (or `GEMINI_API_KEY` + `LLM_PROVIDER=google`).
3. Structured logs around the failing `ticketId`:
   `grep ticketId logs` — the JSON line carries `status` and `error`.

**Diagnosis by error class** (`src/lib/llmClient.ts`):
- `LLMOfflineError` — missing/invalid API key (`"Missing API Key"`,
  `"LLM auth error: 401/403"`), DNS/connection (`ENOTFOUND`,
  `ECONNREFUSED`). Configure `LLM_FALLBACK_PROVIDER`/`LLM_FALLBACK_MODEL` +
  `LLM_FALLBACK_API_KEY` to fail over to a secondary provider.
- `LLMRateLimitError (429)` — provider throttling. `retryLLM` already
  backoff-retries; check `RateLimit` reach && per-day budgets.
- `LLMTimeoutError` — `AbortController` at `LLM_TIMEOUT_MS` (default 30 s).
  Raise `LLM_TIMEOUT_MS` if a persona model is consistently slow.
- `LLMHTTPError (5xx)` — transient; retried for statuses
  `{408,409,425,429,500,502,503,504}`.
- `LLMParseError` — the model returned non-JSON/undecodable JSON where one was
  required; retry or surface to the Communicator.

**Fixes**
- Ensure redaction (`AGENT_REDACT_VALUES`) did not mangle the prompt contract.
- Check `LLM_ALLOW_LEGACY_FALLBACK` is `"1"` (off by default) if the primary
  model cannot produce tool-calls.

## 2. Streaming comm-link goes blank / hangs

The Communicator streams via `callLLMStream`. If the UI shows no deltas:
- The stream may have died mid-SSE. `callLLMStream` fail-opens: any stream
  exception retries once non-streaming and returns `streamed:false`. Watch the
  `llm_stream_fallback` warn line in the logs.
- SSE route (`/api/agent/execute`) only closes on `[DONE]` — a silently hung
  stream looks identical to a slow resume. The client should treat missing
  `{type:"turn"}` heartbeats + `AgentVisualizer`'s heartbeat rail as a liveness
  signal (see `AGENT-OVERVIEW.md` Loop gap #7).
- Confirm the WS/SSE proxy isn't buffering (dev `npm run dev:ws`).

## 3. Lock / concurrency problems

- `AgentBusyError` (HTTP 409 or `{type:"busy"}`) — another loop holds
  `agent_lock:{userId}:{ticketId}` (legacy) or `agent_lock:{userId}:{executionId}`
  (v3). Wait for the 60 s TTL or confirm the stale lock released.
- Concurrent executions for the SAME user are allowed in v3 (per-execution
  keys). If two executions collide, verify `orchestrator/lock.ts` keying.

## 4. Merge rejected

- `"Merge rejected: approval session expired or no pending actions."` — the
  sandbox (`sandbox:{userId}:{ticketId}`) hit the 24 h TTL. Re-run the prompt.
- `$setOnInsert` / `expectedUpdatedAt` optimistic-concurrency conflict — the
  underlying document changed between draft and merge. Ask the user to confirm
  again (double-confirm is a safe no-op).

## 5. Responses document appears mutated (invariant breach)

**This must never happen.** `allowedOperations` on the Response model is
read-only (`find/findOne/countDocuments/aggregate`). If a `Response` was
written:
1. Stop and preserve the ticket + merge logs.
2. Verify which tool wrote it — cross-check the audit trail
   (`OrchestratorAuditModel`/`AgentAuditEvent`) and the sandbox merge
   transaction.
3. Confirm no code path calls a mutating method on the Response model.
4. Add a negative-prompt row (eval) reproducing the attempt.

## 6. Semantic cache not hitting

- `SEMANTIC_CACHE_ENABLED` must be `1`/`true`/`yes`.
- Redis up? `docker start easyforms-redis`; `KV_URL` correct in dev.
- Query normalization is scope-aware; different `scope` = different keys.
- Graceful: cache misses run the resolver. No error surfaces on a broken cache.

## 7. App Insights shows no data

- `APPLICATIONINSIGHTS_CONNECTION_STRING` must be set in the deployed env.
- The adapter is lazy — first log call triggers `useAzureMonitor()`. If you
  see zero traces, confirm the SDK initialised (no stderr) and that logs flow
  to stdout (they always do).
- Deployment needs a restart after adding the env var.

## 8. Eval problems

| Symptom | Check |
|---|---|
| `agent:eval` fails in CI | Run `npm run agent:eval` locally — stub suite is deterministic; a failure means a code+tools contract break. Inspect `tests/agent/eval/reports/` |
| `agent:eval:live` fails in CI | Needs `MONGODB_URI` + `NVIDIA_API_KEY` + Redis. Locally verify with `NODE_ENV=test`. Pass non-agent PRs with `-- --skip` |
| Live eval writes no report | `tests/agent/eval/reports/` can't be written or `--skip` ran; check the `*-skip.json` marker |
| Stub row skipped | `deferToIntegration: true` — the expected tool isn't registered yet (peer bundle lands at the integration gate) |
| Load test fails `auth bypass` | A negative intent wasn't denied. Review role allow-lists (`policy/permissions.ts`) and intent fixture `tools` |
| Load test fails `p99` | Real orchestrator + slow LLM: P99 must be < 30 s. Check budgets/locks causing serialisation |

## 9. Skills UI / API problems

- 401 on any `/api/agent/skills/*` — session invalid; re-auth.
- 404 on PUT/DELETE builtin — built-ins are read-only by design.
- 400 on POST — shape failed `validateSkillDefinition` (`name`, `tools[]`,
  `maxIterations`, `negativeTests[]`).
- Version not bumping — `updateSkill` bumps `patch`-ed skills; verify the
  `PUT` body carries `{ patch: {...} }` or the definition fields directly.
- Skill doesn't resolve — user skills lookup by `name` in `skillRouter`;
  confirm `AgentSkillModel` has a row for `(userId, name)` and it is not
  soft-deleted (`deprecatedAt` null filter).

## 10. Cost/usage looks wrong

- `usageSummary(userId)` reads `AgentUsage` rows; no rows → returns `null`.
- Per-provider grouping uses `inferProviderFromModel` (best-effort substring
  matching). Unknown models group under `other` at
  `PROVIDER_DEFAULTS.other` = generic $0.10/1M.
- Rows with missing `usage` (providers that ignore
  `stream_options.include_usage`) have no cost row — you'll see token totals
  without matching cost. That's expected, not a bug.