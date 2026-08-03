# EASY FORMS WORKSPACE & GRAPH DIRECTIVES

Autonomous engineering agent operating in **Easy Forms** (Next.js 16 / React 19 / TS form builder + multi-persona AI agent subsystem). Adhere to the workspace safety rules and token-efficient graph traversal rules below.

---

## 1. MANDATORY LOCAL DOCS (gitignored — may be absent in fresh clones)

Before reading/editing source, review these files when present (`.agents/` and `.notes/` are in `.gitignore`; only `AGENTS.md`/`GEMINI.md` are committed):
1. `.agents/Agent.md` — Operating Manual, Identity, Safety Invariants, Workflow.
2. `.agents/design.md` — Easy Forms Design Principles & Architecture.
3. `.agents/rules.md` — Hard Rules and Build Commands.
4. `docs/agent/AGENT-OVERVIEW.md` — agent subsystem canonical overview.
If `.agents/*` is missing, this file's invariants + commands below are the fallback source of truth.

### Hard Invariants (binding)
* **Form submission responses are strictly read-only** — `allowedOperations` (`find`, `findOne`, `countDocuments`, `aggregate`) only. NEVER write/mutate/delete `Response` documents.
* **Sandbox Isolation First:** agent mutations queue drafts in Redis (`sandboxRedisStore`) and merge to production only on user **Confirm & Merge** (Mongo transaction, `$setOnInsert` idempotency on `(user, agentIdempotencyKey)` + `expectedUpdatedAt` optimistic concurrency). Executor NEVER writes production Mongo directly.
* **Human Approval:** destructive ops (`rm -rf`, DB drops, form/custom-view deletes, force pushes) require explicit user consent.
* **Strict JSON Outputs:** personas and agent API steps exchange structured JSON; preserve parsing contracts (`safeJSON` in `src/agent/helper/jsonParse.ts`).
* **Loop budget:** Executor↔Evaluator capped at 3 iterations; Evaluator owns `AWAITING_USER_APPROVAL` (Communicator renders only).

---

## 2. STACK & COMMANDS (verified against repo config — trust these over README)

- **Stack:** Next.js 16 App Router (`reactStrictMode: false` intentional), React 19, **TypeScript 5.9.3** strict (`NodeNext`, `@/*` → `./src/*`), Mongoose 9, Redis (`ioredis`; dev uses `KV_URL`), NextAuth v4, Zod 4, Zustand, SCSS modules. Package manager: **npm** only.
- **Dev:** `npm run dev` auto-boots a Docker Redis container (`easyforms-redis`, port 6379) — Docker required. `npm run dev:ws` runs web + WebSocket server together.
- **`npm run lint` = `eslint .` (flat config, ESLint 10).** Next 16 removed `next lint`. The flat config lints **only `.js/.mjs/.cjs/.jsx`** — TS/TSX linting is delegated to the typecheck. Don't expect lint to catch TS issues.
- **Typecheck:** `npx tsc --noEmit` (CI's `agent-typecheck` job). Run both `npm run lint` and `npx tsc --noEmit` before declaring a change done.
- **Agent verification:**
  - `npm run agent:eval` — golden-prompt eval (`tests/agent/eval/golden-prompts.jsonl`), needs **MongoDB + Redis + `NVIDIA_API_KEY`** (`NODE_ENV=test`, `LLM_ALLOW_LEGACY_FALLBACK="0"` per `.github/workflows/agent-eval.yml`). Requires `connectDB()`; expects `.env`-provided vars.
  - `npm run agent:eval:stub` — fully mocked eval (in-memory stores, no DB/Redis/network); runs with `node --experimental-strip-types`. Use for fast offline verification of `src/agent/**` changes.
  - `npm run agent:migrate` — ticket migration (`scripts/migrate-agent-tickets.ts`, eslint-ignored).
  - `npm run worker` (background worker, ts-node) and `npm run ws:server` (WebSocket).
- **Env (`src/dbConfig/dbConfig.ts` + `src/lib/redis.ts` are authoritative):** `MONGODB_URI` (NOT `DATABASE_URL` as README claims), `TOKEN_SECRET`, `NVIDIA_API_KEY`, `KV_URL` (Redis), `WS_PORT` (3001), `NEXT_PUBLIC_*`. `.env`/`.env.local` are gitignored. ts-node scripts load `.env` via `dotenv/config`.

---

## 3. GRAPH-FIRST TOKEN MINIMIZATION

Do NOT raw-grep the whole repo or re-read entire unreferenced files. The codebase graph index lives at `.code-review-graph/graph.db` (gitignored, may be stale/absent — rebuild if missing).
- It is a **SQLite** DB (no CLI/MCP tool is installed; query it directly). Tables: `nodes` (kind: File/Class/Function/Type/Test; `file_path`, `line_start`, `line_end`), `edges` (CALLS/IMPORTS_FROM/INHERITS/REFERENCES), `flows`, `communities`, `risk_index` (`risk_score`, `caller_count`).
- `sqlite3` CLI is NOT installed; use Node's built-in sqlite:
  `node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('.code-review-graph/graph.db');console.log(d.prepare('select ... from nodes where file_path like ?').all('...'))"`

### Execution Protocol
1. **QUERY GRAPH FIRST** — trace AST deps/imports for the affected symbols.
2. **COMPUTE BLAST RADIUS** — output the specific files + line ranges to touch *before* opening files.
3. **TARGETED READS** — load only those files/lines.
4. **VERIFICATION** — `npm run lint` + `npx tsc --noEmit`, plus `npm run agent:eval` (or `agent:eval:stub`) when touching `src/agent/**`, `src/lib/llmClient.ts`, or `src/lib/agentTools.ts`.

---

## 4. ARCHITECTURE & QUIRKS

- **Two surfaces:** web app (`src/app/**` route groups `(client)/(mainpath)` authed, `(client)/(publicPath)` public, `api/**` REST) and the agent loop (`src/agent/**`: `agentLoop.ts`, `personas/` Drafter→Planner→Executor→Evaluator→Communicator, `sandbox/`, `policy/permissions.ts` + `permissions.json`, `prompts.ts`, `tools.ts`, `types.ts`).
- **API routes are thin:** business logic goes in `src/service/**` / `src/models/**` (Mongoose models default-export PascalCase, one per file). NEVER call Mongoose from a React component.
- **Security:** form lookups MUST intersect the owning user's form IDs — never trust a submitted `form_id` bare. NEVER build regex from user input (ReDoS; was intentionally removed). PII redacted before LLM calls (`src/agent/helper/redact.ts`); don't weaken it.
- **Agent tools:** adding a tool requires updating `tools.ts` + `permissions.json`/`policy/permissions.ts` + `src/lib/agentTools.ts` + `guidelines.md` + `skills.md` together.
- **LLM:** NVIDIA API (`NVIDIA_API_KEY`; `LLM_MODEL` default `gemini-2.0-flash` on the NVIDIA path). Legacy Llama fallback gated behind `LLM_ALLOW_LEGACY_FALLBACK=1` (off by default; CI sets `"0"`). Typed LLM errors (`LLMOfflineError`/`LLMRateLimitError`/`LLMTimeoutError`/`LLMHTTPError`) — never collapse into generic `Error`.
- **No unit-test framework:** verification is lint + tsc + agent eval. Tests live in `tests/agent/eval/`, `tests/chaos/`, `tests/load/`.
- **Repo quirks:** root scratch files (`test-llm*.ts|js`, `debug-llm.ts`, `test-db*.js`) are tracked but eslint-ignored; `src/agent/legacy/**` is lint-ignored. Branch of record is `dev`; CI targets `main`/`develop`. Never commit `.env*`, `*.pem`, `*.tsbuildinfo`, `next-env.d.ts` (all gitignored).
