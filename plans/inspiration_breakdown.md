# Waku-Agent: A Complete Breakdown

This is **`waku-agent` v0.1.1** by Sean Chen — a deliberately *readable* AI agent harness. Its entire pitch is in the metadata: *"a minimal, transparent, local-first Waku: harness + loop + memory + eval, in code you can read in an afternoon."* The project lives at `venv/lib/python3.12/site-packages/waku/`. The `.waku/` in your cwd is just its runtime state directory (currently empty/fresh).

Let me walk through every system you asked about, with the **why** behind each decision.

---

## 1. The Mental Model (the whiteboard)

The whole codebase mirrors a whiteboard sketch with named boxes. You can see the developer thinking in these terms:

- **The orange box** = the loop (observe → reason → act → repeat) with hard exit conditions
- **The diamond** = the "only sometimes" gates (consolidation, the release gate)
- **Ephemeral Agent Run** = the inner box, rebuilt per turn and thrown away
- **LLM-Ops** = tracing + the arena + the release diamond

Each file's docstring explicitly references which box it is. That's an intentional design choice: naming things after the architecture diagram keeps the code and the lesson inseparable.

---

## 2. How They Execute Loops

**File: `waku/loop/agent.py`** — this is literally the whole framework in ~90 lines.

The loop is a single `while not done` with one rephrased truth of every agentic framework:

```
while not done:
    response = llm(messages, tools)     # reason
    if response asks for tools:
        results = run(tool_calls)        # act
        messages += results             # observe (feed back as working memory)
    else:
        done                            # reply to the human
```

**Two recursion/exit guardrails (the "orange box exit conditions"):**
1. **Natural end of turn** — `if not tool_uses: return result` (guardrail 1). The model stopped asking for tools → it's talking to the human.
2. **Hard iteration cap** — `max_iterations` (default 10). If it runs out, it returns a graceful "I hit my iteration limit" message instead of spinning forever (guardrail 2).

Key decisions explained in comments:
- **Streaming falls back gracefully**: `stream=True` emits text deltas to the observer, but *any* streaming exception silently drops to a single non-streaming `messages.create`. A streaming hiccup never breaks a turn.
- **Messages are mutated in place** — after the call, `messages` *is* the working memory of the turn (assistant thoughts, tool calls, tool results), which is *exactly* what gets traced. No separate data structure to keep in sync.
- **Tool execution is one-at-a-time and observed** — each `tools.execute(...)` returns a string the model will observe, and emits a `"tool"` event to the observer for live display/tracing.

### Beyond the single loop: the Graph (`waku/graph/engine.py`)

The loop is right when the path *can't be drawn in advance* (read diff → run tests → discover rebase needed → decide next). The **graph** is right when the shape is *known* (a morning digest: scan github ∥ scan web ∥ scan calendar ∥ scan memory → synthesize).

The graph engine runs in **waves**:
- `state` = one plain dict (the blackboard). Nodes read it, return keys to merge.
- **Parallel nodes must write DISJOINT keys** — a collision raises `GraphStateCollision` instead of silently losing a write. (The gather workflow even documents a `SCAN_KEYS` convention so you can verify disjointness by eye.)
- **Routers are code, never models.** A router is `RouteFn(state) -> label`. The gather router (`needs_action`) routes on *counts the scans wrote* (open PRs, events), never on the model's prose — because routing on prose hands control flow to the model AND makes it untestable.
- **Guards generalize the loop's two guardrails**: per-node `max_visits` (bounded cycles) + global `max_steps=25` (never spin). Node exceptions are *recorded and surfaced*, never raised out — same "surface, don't crash" rule as `ToolRegistry.execute`.
- **Waves trade pipelining for legibility**: execution order is deterministic, so traces read the same twice and evals pin the path.

### The triage graph (`graph/workflows/triage.py`)

The retrieval gate asked *one narrow question* with a small model. Triage generalizes that from "one gate" to "a structure": two things happen **at the same time** — classify the message (small model) and load today's calendar (local file read, no network, so it's free to parallelize) — then a code router picks the path:

```
START ── classify ──────┐
     └── check_calendar ┴─► route:  quick → quick_reply (small model) → END
                                    full  → full_agent (THE loop)       → END
```

Crucially: **every seam fails open.** A broken classifier → `"full"`. A broken graph engine → `respond()` falls back to the plain loop. The flag can *only ever add speed, never lose a reply* — explicitly stated in the docstring as "same fail-open rule as the retrieval gate."

### The gather graph (`graph/workflows/gather.py`)

This one carries **two load-bearing rules**, both documented at the top:
1. **"It proposes, it never acts."** There's no `agent_node`, no `run_loop`, no `ToolRegistry`. The one model call is a bare `messages.create` with *no `tools` parameter* — so the model is *unable* to send/merge/create anything, not merely "instructed not to." The only write is a markdown file in the outbox for a human. A test enforces this by reading the file's source.
2. **Every branch catches its own failure.** A node that raises fires no edges → `synthesize`'s deps never complete → empty outbox, *which is the worst failure mode for a morning routine* (silent). So each scan wraps in `_safe(...)` returning honest "unavailable (…)" text instead of raising. They chose the explicit wrapper over the engine's `on_error` jumps *deliberately*, because `on_error` would work here only "by accident of this topology" and break silently if someone reshaped the graph.

Triage's `full_agent` node calls `self._run_full_turn` — *the exact same method* the flag-off default runs. **"Loop-as-a-node can never drift from loop-as-default."** They extracted it verbatim so the graph's full path and the plain path are provably the same code.

---

## 3. How They Plan & Build Memory Context

Memory is organized as **four pillars** (`waku/memory/__init__.py`), mirroring cognitive science:

| Pillar | Store | What it holds |
|---|---|---|
| **Procedural** | `SKILL.md` files | *How to act* (workflows, persona) |
| **Semantic** | `facts` table + FTS5 | *What is durably true* ("Alex prefers mornings") |
| **Episodic** | `episodes` table + FTS5 | *What happened, when* ("2026-07-10: planned demo w/ Alex") |
| **Raw log** | `chat_log` table | The literal conversation (consolidation source) |

Plus **SOUL.md** = the editable persona file (procedural memory "at its simplest" — change the file, change who Waku is).

### Working memory assembly (`runtime/session.py` → `build_system`)

Per turn, the **ephemeral run** builds the system prompt as:
```
SOUL.md (who Waku is)
+ current date/time WITH timezone (resolve "in 30 min" yourself)
+ self-identification ("your model: …, inside Waku")
+ gated retrieval IF the gate says yes (what Waku remembers)
+ matching skill instructions (procedural)
```

Everything here is rebuilt per run and thrown away. What persists lives in `waku/memory`.

### The Retrieval Gate (`memory/retrieval_gate.py`) — "the hero moment #1"

This is the **#1 audience question** the developer explicitly answers: *"why hit the memory store every turn?"* Because default-on retrieval is (a) **slow** — an extra search before every reply — and (b) **worse**: irrelevant memories bias the answer ("over-interpretation").

So before any store is touched, a **cheap small model** answers one question: *does THIS message need the user's memory?*
- "what's 2+2" → `retrieve: false`
- "when am I meeting Alex?" → `true`, plus it emits the search query

Cost: ~a few hundred tokens of a cheap model. **Fails open:** if the gate errors, retrieve anyway — "a stale memory beats a lost one." The `max_tokens=600` is set generously because **reasoning models** (Kimi K3, etc.) spend a thinking block *before* the JSON; 100 tokens was truncating the answer away. (The developer *watched kimi-k3 hit exactly that* and tuned it.)

### Consolidation (`memory/consolidation.py`) — the "diamond"

*"Only consolidate after N new chats."* Running a summarizer after every message is wasteful and noisy; batching N exchanges gives the summarizer enough context to extract facts worth keeping. So `consolidate_if_due` reads `chat_log WHERE consolidated = 0`, and if `len(rows) < every_n * 2` (each exchange = 2 rows), it **does nothing**. Otherwise the small model returns JSON `{facts, episode}` and writes to both stores, then marks those rows consolidated. **Never loses the log** — on any exception, rows stay unconsolidated for next time.

### Procedural trigger (`memory/procedural/loader.py`)

Implements Anthropic's official **Agent Skills** format (YAML frontmatter `name`/`description`, no custom `triggers:` field — the description *is* the trigger). **Progressive disclosure**, three tiers:
1. Frontmatter of every skill scanned (cheap).
2. A skill's BODY loaded into the prompt **only when it matches** the message.
3. Files a skill references read **only if the model asks**.

The trigger is **transparent**: keyword overlap between the message and `name + description` (regex `[a-z0-9]{3,}` words). "No embeddings, no magic — you can compute the score in your head." Re-scans automatically when any `SKILL.md` mtime changes (mismatched `_scan_sig()` → `refresh()`), so a skill created mid-session is live next turn.

### State DB (`db.py`)

**One SQLite file** (`state.db`), FTS5 full-text search on `facts` and `episodes` via triggers (auto-synced inserts/updates/deletes). Schema migration is **additive and idempotent** — `PRAGMA table_info` + `ALTER TABLE ADD COLUMN` with checks, because SQLite has no `ADD COLUMN IF NOT EXISTS`. `PRAGMA busy_timeout=3000` avoids "database is locked" when the dashboard reads during a chat write. Plus a `MEMORY.md` human-readable mirror regenerated every turn — *"your memory is a file you can open"* is literally true.

---

## 4. How They Evaluate Results

There are **two scoring axes, deliberately separate** (`ops/arena.py` docstring):

### Completion — deterministic (`ops/scoring.py`)
A "case" is one line of `evals/dataset.jsonl`: input prompt + `expect_tool` / `expect_in_args` / `expect_min_tool_calls` / `setup_fact`. The contract is judge-free: **did the expected tool fire with the expected args, and enough of the loop actually run?** This is the local mirror of a tau-bench/SWE-bench style *outcome check* (did end-state match), "not a vibe." `check_case` returns `(passed, why)` where `why` is short enough to *show under a race column or speak aloud*. Both the CLI shootout and the live arena use this same function — *"the terminal number and the on-screen number can never drift apart."*

### Quality — LLM referee (`ops/judge.py`)
Open-ended "how good was the answer" can't be a checklist, so an LLM grades against a rubric, MT-Bench/Chatbot-Arena style: **0–10 + one-line reason.**

The crucial **fairness rule**: the referee must be a model that *isn't racing* — otherwise it grades itself, which is "neither fair nor credible." Default judge is `gpt-5.6-sol` — a strong reasoner that's a *poor contestant* here (can't call tools on the chat endpoint) but a *fine judge* (grading is pure text, no tools).

The judge is **given ground truth**: the list of tool names that *actually fired* this turn, so a truthful "I saved that" (with `save_note` in the list) isn't mistaken for hallucination. *"Only 'hallucinating' counts against it when it claims an action with no matching tool call."*

### The Arena — live racing (`ops/arena.py`)

One message goes to **N models at once**; each contestant runs the *real* loop (gate, tools, memory) in its **own throwaway temp home**, so a race can create events and save notes **without ever touching your real `.waku/`**. *"That isolation is the whole reason this is safe to demo."*

After every column finishes, the referee runs as **one gentle pass** (`max_workers=2`) — *not* concurrently with the race. The docstring explains why: grading the moment every column finishes used to "429 and leave some models ungraded." Now a controlled trickle prevents rate-limiting. There's even a `compare_regrade` button to re-run the judge on models it skipped.

### Coding eval (`ops/coding_eval.py`) — execution-as-verdict

A coding case hands a real job to **pi** (a sub-agent), but pointed at the contestant's model, then **scores by RUNNING the produced code** — the `verify` command's exit code is the verdict, SWE-bench style. *"Waku stays the orchestrator; pi stays the contractor."* Notably, they **don't gate on pi's own exit code** — a nonzero exit can still have written working code; `verify` is "the only judge that matters." A watchdog `threading.Timer(timeout, proc.kill)` guards a hung pi.

### The Release Gate — the diamond (`ops/release_gate.py`)

```
make gate  (python -m waku.ops.release_gate)
```
- **Deterministic evals must pass 100%** — they're unit tests; one failure blocks with exit 1.
- **Judge evals** run only when a key is present, and report scores; below threshold = gate closed.
- Persists the verdict to `eval_report.json` and appends to history `eval_runs.jsonl`.
- "Exit code 0 = ship."

### The Tracer — evals/ops evidence (`ops/tracing.py`)

**Two outputs from the same events:**
1. **JSONL always on** — every turn appends to `.waku/traces/<date>.jsonl`. "A trace is just what happened, in order — open the file and read your agent's mind. Zero dependencies."
2. **OpenTelemetry spans** when `OTEL_EXPORTER_OTLP_ENDPOINT` is set — same events, span tree for Phoenix/Langfuse.

The Tracer **doubles as a loop Observer** (`tracer.event` goes anywhere an observer goes). There's a beautiful **encoding trap** it handles: an older Windows release might have created the daily file in GBK; it refuses to corrupt a mixed-encoding JSONL — validates once, raises a helpful `TraceEncodingError`, and *"never guesses or rewrites user data."*

`end_turn()` force-flushes OTel — *"the trace should survive even a killed process."*

---

## 5. How They Manage Tokens, Optimization & Calculation

### Token budgeting decisions (each is a documented decision)
- **`max_tokens=8192`** (raised from a default of 2048 in `config.py`). The comment is the lesson: reasoning models (kimi-k3, gpt-5.x, gemini-*-pro) spend output tokens *thinking before the answer*, so a low cap makes them hit `stop_reason=max_tokens` mid-thought and return an **empty reply**. *"I watched kimi-k3 do exactly that at 2048."* 8192 leaves room to think AND answer; it's a *ceiling, not a target*, so efficient models still cost the same.
- **Gate/summarizer `max_tokens=600`** — generous on purpose, again for reasoning models' pre-JSON thinking block. Truncation here = no JSON = silent failure.
- **Judge `max_tokens=300`** — grading is short text.
- **`history_turns=12`** — **working memory is a sliding window** (like context RAM). Only the last 12 turns enter the prompt. Without this cap, a long always-on Telegram thread resends its *entire history* every turn until it explodes. Older turns aren't lost — they're in `state.db`, distilled into facts by consolidation, pulled back by the gate when relevant. The window is implemented as `self.session.history[-window:]` where `window = history_turns * 2` (2 rows per exchange).

### Token accounting — the permanent ledger (`ops/tracing.py` → `_record_usage`)
Every LLM call appends one line to `.waku/usage.jsonl`:
```json
{"ts": ..., "provider": ..., "model": ..., "kind": "loop", "in": N, "out": M}
```
**This is the single most important design decision in the whole cost system: it stores tokens, NOT dollars.** "Prices change; tokens don't." So cost is **derived at read time** from current tables — meaning *fixing a wrong rate silently corrects every past race and every historical spend chart*. The ledger is **never wiped** (unlike traces, which can be reset for a clean demo). *"Tokens are the ground truth; dollar cost is derived from them."*

### Pricing — three-tier lookup (`ops/pricing.py`)
In order, `price_for(provider, model)` checks:
1. `_price_cache` — exact per-model rates *learned at runtime* from a live catalog fetch (OpenRouter reports them). Process-lifetime only; the ledger stores tokens so a restart just falls back to the tables.
2. `MODEL_PRICING` — hand-maintained exact `$ / million tokens (in, out)` for endpoints with no listable catalog (the Anthropic wire has no `/models`). Fact-checked Jul 2026 against each vendor's pricing page. Per-**model**, not per-provider — "within a provider, models diverge a LOT (fable-5 is ~2x opus, flash undercuts pro); a provider-level guess made fable-5 look cheaper than opus, so pricing per *model* is the only honest way."
3. `PRICING` — provider-level fallback, *deliberately rough*, labeled `est` (e.g. openrouter `(1.0, 3.0)`, xai grok `(3.0, 15.0)`).

There's also **`MODEL_CUTOFF`** — knowledge-cutoff date per model. The arena *discloses* when each brain's world knowledge ends, so "a 2025 model denying that 2026 models exist reads as stale data, not stupidity" (gemini-3.1-pro confidently denies 2026 models exist; its cutoff is 2025-01). Every `MODEL_PRICING` id **must** have an entry here — enforced by a test.

`:free` model ids (OpenRouter's $0 tier) return `(0.0, 0.0)` — so it works with zero spend, just rate-limited.

### Token usage summary (`usage_summary`)
Reads the ledger → all-time tokens + dollar cost + per-day and per-provider breakdowns. Reprices *every row* with current tables. The running total "survives demo resets, so the number is the real running total — trustworthy, not a per-session guess."

---

## 6. Multi-provider with one wire format (`loop/models.py`)

The loop speaks **one dialect**: Anthropic's Messages shape (`system`/`messages`/`tools` in, content blocks out). Providers plug in two ways:
- **Anthropic wire format (native)** → Anthropic, Kimi/Moonshot, GLM/Z.ai, MiniMax
- **OpenAI wire format (thin adapter)** → `OpenAICompatClient` (~60 lines) speaks the Anthropic shape *the loop expects*, backed by an OpenAI `chat.completions` API. "Worth reading once" — it's the entire difference between the two wire formats.

Several **battle-tested decisions** visible here:
- **`max_tokens` key-name fallback**: newer endpoints use `max_completion_tokens`; older ones only know `max_tokens`. `_call` retries the swap *only when the error is ABOUT that param* — *"retrying on any error masked the real failure (a gpt-5.x call would fail for some other reason, then the max_tokens retry buried it under a confusing message)."*
- **API key ASCII check**: `.strip()` so a trailing newline doesn't corrupt the auth header (headers are latin-1, a stray non-ASCII char errors cryptically); `try: api_key.encode("latin-1")` catches bad pastes explicitly.
- **`WAKU_LLM_TIMEOUT=120`**: "a hung network call must never freeze a turn silently."
- **200-with-empty-choices handling**: some OpenAI-compatible endpoints (OpenRouter on rate limit) return 200 with an error body and no choices — they *surface that message* instead of dying on a TypeError.
- **Gemini `thought_signature`**: Gemini thinking models attach a `thought_signature` to tool calls and **REQUIRE it echoed back next turn, else 400 "missing a thought_signature"**. They carry it through `extra` and put it back in `_to_openai`. A genuinely hard-won fix.
- **gpt-5.6 reasoning models can't use function tools on `/v1/chat/completions`** (they need `/v1/responses`), so every Waku turn 400s on them. The non-reasoning "chat" line DOES call tools fine; `gpt-5.3-chat-latest` is pinned for reproducibility. This is *flagged in the provider table comments as a known limitation.*

---

## 7. The wiring (`app.py`) — the assembly diagram

Every gateway calls `Waku.respond()`. The construction order is the architecture: `config → db → tools → memory → session → loop`. `client` and `conn` are **injectable** so evals swap in a scripted model and the dashboard injects a cross-thread connection — "same seam either way."

`respond()` does **one full turn**:
1. Compose observers: the caller's `observer` ∘ `tracer.event` ∘ `_capture` (captures gate/graph/route decisions to persist with the turn).
2. `with self.tracer.turn(...)` — one root span + `turn_start`/`turn_end` markers.
3. If `graph_workflows` is on, try `_respond_via_graph`; **any exception → `result=None`** and falls to the plain `_run_full_turn`. The graph's `full_agent` node calls *the exact same* `_run_full_turn`.
4. Build a `meta` dict (gate decision, graph route/path, iterations, latency_ms, per-tool status codes, the **model that actually answered** — honest about whether the small model handled a quick graph turn vs the big model).
5. `session.add_exchange(...)` — records the turn; folds tool activity into the assistant history entry as a compact `[tools used: ...]` line. *"Without it, the model forgets it already acted and re-runs the same tool next turn (the triple-booked-meeting bug from the first live test)."* A real bug that informed a real design.
6. `maybe_consolidate` (the diamond) and `export_markdown` (keep `MEMORY.md` in sync).

There's a deliberate **status-code heuristic** `_status`: "error" if the tool output contains "failed"/"timed out"/starts with "error" — so the turn card shows red honestly.

---

## 8. Recurring Design Decisions (the philosophy behind the choices)

These appear over and over, and they're *the* lessons of the project:

1. **Fail open at every seam that's about capability.** The retrieval gate, the triage classifier, the graph engine, the consolidator — if any of them break, the cost is *latency*, never *a lost reply*. "A broken classifier must cost latency, never capability." The diamond (consolidation/gate) is the same idea applied to "only sometimes."

2. **Small model judges; big model acts.** The retrieval gate, triage classifier, and summarizer all use `small_model` (cheap/fast). The big model only wakes for real work. The judge is yet a third model that's NOT racing.

3. **Routers/control-flow are ALWAYS code, never LLMs.** Routes on counts/labels a model wrote, never on prose. "Routing on the model's wording would hand control flow to the model AND make the branch impossible to test."

4. **Store immutable ground truth; derive the rest.** Ledger stores tokens (prices change); `usage.jsonl`/`chat_log` persist; cost/cutoff reprice at read from current tables. Fix a rate → every past chart corrects silently.

5. **Surface errors, don't crash.** `ToolRegistry.execute` returns `f"Error: ..."` as text so the model can retry. The graph records node errors into `state["errors"]` and drains cleanly. Surface-don't-crash is the literal rule name.

6. **Everything is a single readable file with its box named in the docstring.** The loop is ~90 lines; the OpenAI adapter is ~60; every module opens with *which box it is on the whiteboard and why*.

7. **Progressive disclosure everywhere.** Skills: frontmatter → body → referenced files. Retrieval: gate → search → top-k. Memory: sliding window + distill → reconstruct when relevant. Context grows into the prompt *only when it helps*.

8. **Isolation for safety.** The arena's temp homes mean a race can mutate state without touching yours; gather "proposes, never acts" by *literally withholding the tools parameter*; `WAKU_APPLE_CALENDAR`/`WAKU_GH_TOOL` default off.

9. **Make it honest about its own limits.** The turn card shows *which model answered*. The arena shows the knowledge cutoff. Tool output states exactly where its artifact landed, and the SOUL instructs relay that truthfully ("never claim something synced anywhere the tool output doesn't say").

10. **Reproducibility over freshness aliases.** Pin `gpt-5.3-chat-latest` over `gpt-5-chat-latest` "so a benchmark is reproducible."

---

### Where to look for each topic in the code

| You asked about | File |
|---|---|
| How they execute loops | `loop/agent.py`, `graph/engine.py`, `graph/workflows/triage.py`, `graph/workflows/gather.py` |
| Planning & building memory context | `runtime/session.py`, `memory/__init__.py`, `memory/retrieval_gate.py`, `memory/procedural/loader.py`, `db.py` |
| How they evaluate results | `ops/scoring.py`, `ops/judge.py`, `ops/arena.py`, `ops/coding_eval.py`, `ops/release_gate.py`, `ops/tracing.py` |
| Token management & calculation | `ops/tracing.py` (`_record_usage`), `ops/pricing.py`, `config.py` (`max_tokens`, `history_turns`), `loop/models.py` |
| Every decision & why | Mostly in the **docstrings and inline comments** — this project treats the *explanation* as a first-class artifact alongside the code |

If you want, I can go deeper into any single subsystem (e.g. the OpenAI-compat adapter line-by-line, or the graph engine's wave scheduler, or how an eval dataset case is written), or I can walk one concrete turn through the whole stack end-to-end.
