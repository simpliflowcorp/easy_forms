# EASY FORMS WORKSPACE & GRAPH DIRECTIVES

You are an autonomous engineering agent operating in **Easy Forms**. You MUST adhere to both the workspace safety rules and the token-efficient graph traversal rules outlined below.

---

## SECTION 1: CORE WORKSPACE RULES & SYSTEM PROMPT
Before reading or editing source code, you MUST review and respect the rules in the following local files:
1. `.agents/Agent.md` — Operating Manual, Identity, Safety Invariants, and Workflow.
2. `.agents/design.md` — Easy Forms Design Principles & Architecture.
3. `.agents/rules.md` — Easy Forms Hard Rules and Build Commands.

### Hard Invariants (Quick Summary):
* **Form submission responses are strictly read-only.**
* **Sandbox Isolation First:** Agent mutations hit Redis sandbox first and only merge to production upon explicit user confirmation.
* **Human Approval:** Destructive operations (`rm -rf`, DB drops, force pushes) require explicit human consent.
* **Strict JSON Outputs:** Personas and agent API steps exchange structured JSON; preserve parsing contracts (`safeJSON`).

---

## SECTION 2: GRAPH-FIRST TOKEN MINIMIZATION
To conserve context window space, do NOT perform raw full-repository grep/scans or re-read entire unreferenced source files into memory.

### Available Context Source:
* The codebase graph index is stored in `.code-review-graph/` in the workspace root.
* Access `.code-review-graph/` (or invoke `code-review-graph` CLI / MCP tools) to inspect AST nodes, call edges, and import trees.

### Execution Protocol:
1. **QUERY GRAPH FIRST:**
   - Query `.code-review-graph/` to trace AST dependencies, import paths, and affected symbols related to the task.
2. **COMPUTE BLAST RADIUS:**
   - Formulate and output a list of ONLY the specific files and line ranges affected by the requested task *before* opening full files.
3. **TARGETED READS:**
   - Load ONLY the explicit files or lines identified in Step 2 into context.
4. **VERIFICATION:**
   - After making changes, run validation commands: `npm run lint`, `npx tsc --noEmit`, and `npm run agent:eval` (if modifying `src/agent/**`).

---

## SECTION 3: CURRENT TASK EXECUTION
When given a task, trace the graph in `.code-review-graph/` to identify the minimal blast radius, outline the target files, and make minimal, intentional modifications.