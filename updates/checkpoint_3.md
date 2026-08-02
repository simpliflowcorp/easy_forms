# Checkpoint 3 — 2026-08-02 (R2.1 — `retryLLM` returns `usage`)

Short-form checkpoint. Comprehensive grounding in `checkpoint_1.md`; R6.3-attempt record
in `checkpoint_2.md`. This file logs the R2.1 deliverable + verification state immediately
before the commit.

## What was built — R2.1: `retryLLM` / `callOnce` returns `usage`

**Spec**: per-call LLM cost accounting — `retryLLM`/`callLLM` return
`{ content, raw?, tool_calls?, usage?: LLMUsage }` so a downstream persistence layer (R2.2)
can write per-call `AgentUsage` rows + accumulate `state.tokenUsage` on the `AgentState`.

**Implementation** (1 file — `src/lib/llmClient.ts`):

1. **New types** — `LLMUsage { promptTokens, completionTokens, totalTokens, model }` and
   `LLMResult { role?, content, tool_calls?, usage? }`. Additive to existing callers — they
   read `.content` and `.tool_calls` and that's preserved.

2. **`parseUsage(rawUsage, model)` helper** normalises three families into one shape:
   - NVIDIA NIM / OpenAI-compat: `{ prompt_tokens, completion_tokens, total_tokens }`.
   - Raw Gemini SDK: `{ promptTokenCount, candidatesTokenCount, totalTokenCount }`
     (defensive — not the route we use today, but supported to keep the helper robust for
     a future provider switch).
   - Anthropic-style: `{ input_tokens, output_tokens }` with `totalTokens` computed.
   - Returns `null` when every field is 0/missing (some Gemini response shapes omit
     usage entirely when bypassed for non-billable reasons). Callers leave `usage`
     undefined in that case — downstream budget math treats "missing" as "no row
     recorded", NOT "zero cost" (which would muddy budget math).

3. **`callOnce` payload** adds `stream_options: { include_usage: true }` when streaming.
   NVIDIA NIM and Gemini-OpenAI-compat both honour this. Silent no-op for any provider
   that doesn't (the `parsedUsage` stays null and the result lacks `usage`).

4. **Non-streaming return path** (`callOnce` ~line 211): the existing line
   `return data.choices[0].message;` was a bug — it threw away `data.usage`. Now returns
   `{ ...data.choices[0].message, usage: parseUsage(data.usage, payload.model) }`.
   Fix-paired with R2.1: a latent silent loss of usage data.

5. **Streaming path** (~line 227): keeps `parsedUsage: LLMUsage | null` across the read loop;
   parses `data.usage` on every chunk (the final chunk is the authoritative one — we
   overwrite, not accumulate, since `usage` is cumulative-for-whole-response, not a per-chunk
   delta). Attaches to `result.usage` at the end.

6. **`retryLLM` + `callLLM` return types** tightened from `Promise<any>` to
   `Promise<LLMResult>`. Type-only; runtime unchanged.

**Backwards compat**: zero caller breakage — `evaluator.ts:93`, `communicator.ts:65`,
`planner.ts:165-166`, `drafter.ts:51` all do `?.content` (and `rawResponse?.tool_calls`),
all preserved by the additive change. Confirmed by `tsc --noEmit` exit 0.

## Verification

| Gate | Result |
|------|--------|
| `npm run typecheck` (`tsc --noEmit`) | ✅ exit 0 |
| `npm run lint` (`eslint .`) | ✅ exit 0 |
| `npm run lint` against intentional `debugger;` probe | ✅ fires `no-debugger` rule (lint actually runs) |

## Files changed (this session, about-to-commit)

- `src/lib/llmClient.ts` — R2.1 (above). 102 insertions, 3 deletions.

## What R2.1 explicitly does NOT do (deferred)

- **R2.2** — `AgentUsage` Mongo model + `AgentState.tokenUsage` aggregate + persist-on-transition.
  R2.1 makes the data available; R2.2 records it. Without R2.2, today the per-call `usage`
  enters the trace (via `state.llmRawOutput` already carries the LLM roundtrip) but no row
  is written anywhere durable. R2.2 is the natural next item.
- **R2.3** — `LLMBudgetExceededError` + per-ticket budget enforcement. Depends on R2.2.
- **R2.4** — admin dashboard route. Depends on R2.2.
- **`costUsd`**: deliberately not computed here. Per-model pricing tables update at
  deployment time, not in the request hot path — better stored in a fixed config table
  and applied at R2.2 row-write time.

## Cumulative state — verification sweep

Items closed across all sessions:

- Part A items: P0-1, P0-2, P0-3, P1-R1, P1-R2, P1-E1, P1-M1,
  P2-D1, P2-D2, P2-D3, P2-4, P2-5, P2-6, P2-7, P3-M2, P3-M3, P3-M4, P3-M5.
- Cleanup trio: OPEN-1, OPEN-2, OPEN-3, P-Cleanup #1, #2, #3.
- Pre-existing TSC errors (2).
- Refactor: R0.1, R0.3, R2.1.
- Refactor partial landings still PARTIAL: R0.2 (WS server — client migration + health-stream
  deletion pending), R3 (llm-client streaming land; client-side WS+reconnect migration pending).
- Refactor deferred-to-tooling: R6.3 (ts-node+TS7 blocker; draft in git history; restore after
  TS 6 downgrade).
- Refactor OPEN (no start): R1, R2.2-R2.4, R4, R5, R6 (other sub-items), R7, R8, R-Executor-Tools,
  R9, R10.

Out-of-band: rotate the historically-committed NVIDIA key (still pending regardless of repo
cleanliness — codebase has been clean since the cleanup-trio commit `5b5ef60`).

## Suggested sequencer — next up

Per `implementation_plan.md`'s sequencer: **R2.2 — `AgentUsage` model + `AgentState.tokenUsage`**.
Gated on R2.1 (just landed). Pure additive Mongo model + a small persistence shim wired into
`agentLoop.ts:persistStateToRedis` such that each persona transition's `state.tokenUsage` is
updated and per-call `AgentUsage` rows are written alongside the existing `AgentTicket` update.
No new infrastructure required; `tsc --noEmit` is the only hard validation gate until R6.3 unblocks.
