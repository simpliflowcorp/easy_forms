# PI Agent Specification — Easy Forms Multi-Agent System

**Version:** 1.0  
**Date:** 2025-08-03  
**Status:** Draft — Implementation Target

---

## 1. Executive Summary

This specification defines the **PI Agent** — a multi-agent system for Easy Forms that provides **full end-to-end control** over the application, database, and user workflows. The PI Agent supersedes the current single-loop 4-persona architecture (Drafter → Planner → Executor → Evaluator → Communicator) with a **hierarchical multi-agent framework** featuring specialized sub-agents, persistent memory, skill synthesis, and autonomous planning/execution loops.

**Core Promise:** *Any action a human user can perform in Easy Forms — read, write, update, delete — the PI Agent can perform autonomously, reliably, and with full auditability.*

---

## 2. Architectural Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PI AGENT ORCHESTRATOR                           │
│  (Goal Decomposition → Agent Dispatch → State Aggregation → Verification)│
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        ▼                         ▼                         ▼
┌───────────────┐        ┌───────────────┐        ┌───────────────┐
│  PLANNER      │        │  EXECUTOR     │        │  CRITIC       │
│  AGENT        │        │  AGENT        │        │  AGENT        │
│               │        │               │        │               │
│ • Task graph  │        │ • Tool use    │        │ • QA/Verify   │
│ • Dependency  │        │ • Sandbox     │        │ • Red-team    │
│   resolution  │        │   isolation   │        │ • Self-critique│
│ • Resource    │        │ • Idempotency │        │ • Conformance │
│   allocation  │        │ • Parallel    │        │   checking    │
└───────┬───────┘        └───────┬───────┘        └───────┬───────┘
        │                        │                        │
        └────────────────────────┼────────────────────────┘
                                 ▼
                    ┌─────────────────────────┐
                    │   MEMORY & KNOWLEDGE    │
                    │   LAYER                 │
                    │                         │
                    │ • Episodic (traces)     │
                    │ • Semantic (skills,     │
                    │   schemas, patterns)    │
                    │ • Procedural (workflows)│
                    │ • User preference model │
                    └─────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │   SKILL REGISTRY &      │
                    │   SYNTHESIS ENGINE      │
                    │                         │
                    │ • Built-in skills       │
                    │ • User-defined skills   │
                    │ • Auto-generated skills │
                    │ • Skill composition     │
                    └─────────────────────────┘
```

---

## 3. Agent Roles & Responsibilities

### 3.1 PI Orchestrator (Root Agent)
**Identity:** `pi_orchestrator`  
**Model:** High-reasoning (e.g., GPT-4o, Claude Opus)  
**Responsibilities:**
- Accept user intent (natural language, structured goals, or API calls)
- Decompose into **sub-goals** with explicit success criteria
- Dispatch to specialized sub-agents via **Agent Communication Protocol (ACP)**
- Aggregate partial results, handle failures, manage retries
- Maintain **global execution state** (DAG of tasks, dependencies, checkpoints)
- Enforce **budget constraints** (tokens, time, cost, API calls)
- Emit **structured audit trail** for every decision

**Interface:**
```typescript
interface OrchestratorInput {
  userId: string;
  intent: UserIntent;           // { goal, constraints, context, priority }
  sessionId?: string;
  budget: BudgetConstraints;    // { maxTokens, maxTimeMs, maxCostUsd, maxToolCalls }
  memoryScope: MemoryScope;     // { read: [], write: [] }
}

interface OrchestratorOutput {
  status: "completed" | "partial" | "failed" | "awaiting_input";
  result: any;
  executionTrace: ExecutionTrace;
  artifacts: Artifact[];        // Forms created, reports generated, etc.
  nextActions?: UserAction[];   // Suggested follow-ups
}
```

---

### 3.2 Planner Agent
**Identity:** `pi_planner`  
**Model:** Reasoning-optimized (e.g., o1, Claude Sonnet)  
**Responsibilities:**
- Convert high-level goals into **executable task graphs** (DAGs)
- Perform **dependency analysis** and **critical path identification**
- Allocate **resources** (tools, skills, sub-agents) per task
- Generate **contingency plans** for failure modes
- Output **structured execution plan** with verifiable milestones

**Output Schema:**
```typescript
interface ExecutionPlan {
  planId: string;
  goal: string;
  tasks: TaskNode[];
  edges: TaskEdge[];            // Dependencies
  checkpoints: Checkpoint[];    // Verifiable intermediate states
  estimatedCost: CostEstimate;
  riskAssessment: Risk[];
  fallbackPlan?: ExecutionPlan;
}

interface TaskNode {
  taskId: string;
  agent: AgentIdentity;         // Which sub-agent executes
  skill: string;                // Primary skill required
  tool: string;                 // Primary tool (if atomic)
  params: Record<string, any>;  // Input parameters
  successCriteria: SuccessCriterion[];
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  metadata: {
    isDestructive: boolean;
    requiresConfirmation: boolean;
    idempotencyKey: string;
  };
}
```

---

### 3.3 Executor Agent(s)
**Identity:** `pi_executor_{domain}` (e.g., `pi_executor_forms`, `pi_executor_analytics`, `pi_executor_views`)  
**Model:** Tool-use optimized (e.g., GPT-4o, Claude Sonnet)  
**Responsibilities:**
- Execute **atomic tool operations** within sandbox isolation
- Manage **idempotency keys** and **optimistic concurrency**
- Handle **parallel execution** of independent tasks
- Stream **progress events** for long-running operations
- Surface **structured errors** with recovery hints
- Never mutate production directly — all writes go through sandbox → merge pipeline

**Specialized Executors:**
| Executor | Domain | Tools |
|----------|--------|-------|
| `pi_executor_forms` | Form CRUD | `create_form`, `update_form`, `delete_form`, `read_form` |
| `pi_executor_responses` | Response data | `query_responses`, `generate_analytics`, `run_database_query` |
| `pi_executor_views` | Custom views | `create_custom_view`, `get_custom_views`, `update_custom_view`, `delete_custom_view` |
| `pi_executor_generic` | Cross-cutting | `run_database_query` (admin), bulk operations |

---

### 3.4 Critic Agent (Quality Assurance)
**Identity:** `pi_critic`  
**Model:** High-reasoning, adversarial (e.g., o1, Claude Opus)  
**Responsibilities:**
- **Verify** execution results against success criteria
- **Red-team** outputs: hallucination detection, security issues, logic errors
- **Conformance checking** against schemas, permissions, guardrails
- **Regression detection** vs. expected behavior patterns
- Emit **structured feedback** for retry or escalation

**Output Schema:**
```typescript
interface CriticVerdict {
  verdict: "pass" | "conditional_pass" | "fail" | "escalate";
  score: number;                // 0-100 quality score
  findings: Finding[];
  requiredFixes: FixDirective[]; // Specific, actionable
  retryGuidance?: string;       // For executor retry
  escalationReason?: string;    // If human intervention needed
}

interface Finding {
  type: "correctness" | "completeness" | "security" | "performance" | "style";
  severity: "critical" | "major" | "minor" | "info";
  taskId: string;
  description: string;
  evidence: any;
  suggestedFix: string;
}
```

---

### 3.5 Memory Agent
**Identity:** `pi_memory`  
**Model:** Embedding + retrieval optimized  
**Responsibilities:**
- **Episodic memory:** Store/retrieve execution traces, decisions, outcomes
- **Semantic memory:** Index skills, schemas, patterns, user preferences
- **Procedural memory:** Learn and replay successful workflows
- **Context assembly** for agent prompts (relevant history, similar tasks)
- **Forgetting policy:** TTL, relevance decay, privacy compliance

**Memory Tiers:**
| Tier | Storage | TTL | Use Case |
|------|---------|-----|----------|
| Working | Redis (in-context) | Session | Active task context |
| Short-term | Redis + Mongo | 30 days | Recent tickets, user preferences |
| Long-term | Mongo + Vector DB | Indefinite | Skills, patterns, learned workflows |
| Archive | Cold storage | Compliance | Audit logs, deleted data |

---

### 3.6 Skill Synthesis Agent
**Identity:** `pi_skill_synth`  
**Model:** Code generation + reasoning  
**Responsibilities:**
- **Analyze** user requests for recurring patterns
- **Generate** new skill definitions (prompt + tool schema + validation)
- **Compose** existing skills into higher-level macros
- **Validate** synthesized skills against guardrails
- **Register** skills in registry with versioning
- **Deprecate** unused/obsolete skills

**Skill Definition Schema:**
```typescript
interface SkillDefinition {
  skillId: string;
  name: string;
  version: string;
  description: string;
  category: "builtin" | "user_defined" | "synthesized";
  author: "system" | "user:{id}" | "pi_skill_synth";
  
  // Execution contract
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  requiredTools: string[];
  requiredPermissions: string[];
  
  // Behavior
  systemPrompt: string;
  fewShotExamples: FewShotExample[];
  validationRules: ValidationRule[];
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  usageCount: number;
  successRate: number;
  tags: string[];
}
```

---

## 4. Agent Communication Protocol (ACP)

All inter-agent communication uses **structured JSON over typed channels**:

```typescript
// Base message envelope
interface ACPMessage<T = any> {
  messageId: string;            // UUID
  timestamp: string;            // ISO 8601
  from: AgentIdentity;
  to: AgentIdentity | "broadcast";
  performative: Performative;
  payload: T;
  correlationId?: string;       // Links request/response
  replyTo?: AgentIdentity;
  ttl?: number;                 // Max hops
}

type Performative = 
  | "request"       // Ask agent to perform task
  | "inform"        // Share information/result
  | "query"         // Ask question
  | "propose"       // Propose plan/action
  | "accept"        // Accept proposal
  | "reject"        // Reject proposal
  | "cancel"        // Cancel in-progress task
  | "failure"       // Report failure
  | "heartbeat";    // Liveness

// Example: Orchestrator → Planner
{
  "messageId": "msg_abc123",
  "timestamp": "2025-08-03T12:00:00Z",
  "from": "pi_orchestrator",
  "to": "pi_planner",
  "performative": "request",
  "payload": {
    "task": "create_execution_plan",
    "goal": "Build a customer feedback form with NPS, comments, and follow-up consent",
    "constraints": { "maxFields": 10, "mustInclude": ["nps", "email"] },
    "budget": { "maxTokens": 50000 }
  },
  "correlationId": "corr_xyz789"
}
```

---

## 5. State Management & Persistence

### 5.1 Global Execution State (Redis + Mongo)
```typescript
interface PIExecutionState {
  executionId: string;
  userId: string;
  sessionId?: string;
  status: "planning" | "executing" | "verifying" | "awaiting_approval" | "completed" | "failed";
  
  // Hierarchical task state
  rootPlan: ExecutionPlan;
  taskStates: Map<string, TaskState>;
  
  // Agent states
  agentStates: Map<AgentIdentity, AgentLocalState>;
  
  // Memory references
  memoryPointers: MemoryPointer[];
  
  // Budget tracking
  budgetConsumed: BudgetSnapshot;
  
  // Audit
  auditLog: AuditEntry[];
  
  // Checkpoints for resume
  checkpoints: Checkpoint[];
}
```

### 5.2 Sandbox Isolation (Enhanced)
- **Per-execution sandbox** (not per-user) — keyed by `executionId`
- **Transactional merge** with idempotency keys (existing pattern preserved)
- **Optimistic concurrency** with `expectedUpdatedAt` (existing pattern preserved)
- **Cross-agent sandbox sharing** for coordinated multi-agent writes

---

## 6. Tool & Skill Registry

### 6.1 Built-in Tools (Current + Extensions)
| Tool | Category | Mutating | Description |
|------|----------|----------|-------------|
| `create_form` | Forms | ✅ | Create form with elements |
| `update_form` | Forms | ✅ | Update form schema/properties |
| `delete_form` | Forms | ✅ | Delete form (requires confirmation) |
| `read_form` | Forms | ❌ | Get form by ID |
| `query_responses` | Responses | ❌ | Filtered response queries |
| `generate_analytics` | Responses | ❌ | Aggregate statistics |
| `run_database_query` | Generic | ❌ | Raw read-only Mongo queries |
| `create_custom_view` | Views | ✅ | Save filter/sort preset |
| `get_custom_views` | Views | ❌ | List saved views |
| `update_custom_view` | Views | ✅ | Modify saved view |
| `delete_custom_view` | Views | ✅ | Delete saved view |
| **`bulk_create_forms`** | Forms | ✅ | Create multiple forms atomically |
| **`bulk_update_forms`** | Forms | ✅ | Update multiple forms |
| **`export_responses`** | Responses | ❌ | Export to CSV/JSON/PDF |
| **`import_responses`** | Responses | ✅ | Import responses (admin) |
| **`manage_webhooks`** | System | ✅ | Configure form webhooks |
| **`manage_integrations`** | System | ✅ | Third-party integrations |

### 6.2 Permission Scopes (Extended)
```json
{
  "permissions": {
    "form_management": true,
    "data_analytics": true,
    "destructive_actions": false,
    "bulk_operations": false,
    "system_admin": false,
    "integration_management": false,
    "webhook_management": false,
    "allowed_tools": [ "...current tools...", "bulk_create_forms", "export_responses" ]
  }
}
```

---

## 7. Safety & Guardrails (Hard Invariants)

| # | Invariant | Enforcement Layer |
|---|-----------|-------------------|
| 1 | **Form responses are strictly read-only** | Tool schema (no write tools for Response), runtime validator |
| 2 | **Sandbox isolation before production merge** | Executor only writes to sandbox; merge requires explicit user approval |
| 3 | **Human confirmation for destructive actions** | Critic flags → Orchestrator pauses → UI confirmation modal |
| 4 | **Permission verification before every tool call** | Executor pre-check via `checkToolPermission()` |
| 5 | **Loop budget: max 3 retries per task, max 50 tasks per execution** | Orchestrator tracks and enforces |
| 6 | **Token/cost budget per execution and per user/day** | Orchestrator + Memory Agent pre-flight checks |
| 7 | **PII redaction in all LLM contexts** | Automatic via `redactPII()` on all outbound prompts |
| 8 | **Audit logging for every mutating action** | `AgentAuditEvent` created in merge transaction |
| 9 | **Idempotency keys on all mutating operations** | Executor generates; merge uses `$setOnInsert` |
| 10 | **Optimistic concurrency on updates/deletes** | Executor snapshots `updatedAt`; merge validates |
| 11 | **Per-execution Redis lock (not per-user)** | `pi_lock:{executionId}` prevents double-execution |
| 12 | **Skill sandbox: synthesized skills cannot access tools outside declared `requiredTools`** | Runtime tool allow-list per skill |

---

## 8. Multi-Agent Loop Protocol

```
ORCHESTRATOR LOOP (per user request)
├─ 1. INGEST: Parse intent, load context, check budgets
├─ 2. PLAN: Dispatch to PLANNER → get ExecutionPlan
├─ 3. VALIDATE: CRITIC reviews plan for safety/completeness
│   └─ If FAIL: return to PLANNER with feedback (max 2 retries)
├─ 4. EXECUTE: For each task in topological order:
│   ├─ Dispatch to appropriate EXECUTOR
│   ├─ EXECUTOR runs tool in sandbox, streams progress
│   ├─ CRITIC verifies result against success criteria
│   │   └─ If FAIL: retry with feedback (max 3 retries per task)
│   └─ On success: checkpoint state
├─ 5. MERGE: If any mutating tasks → present to user for approval
│   └─ On approval: transactional merge to production
├─ 6. LEARN: MEMORY AGENT indexes trace, SKILL SYNTH analyzes patterns
└─ 7. RESPOND: ORCHESTRATOR synthesizes final response
```

---

## 9. Observability & Debugging

### 9.1 Structured Logging
Every agent emits **structured JSON logs** with:
- `agentId`, `executionId`, `taskId`, `timestamp`
- `eventType`: `plan_start`, `tool_call`, `tool_result`, `verification`, `retry`, `checkpoint`, `merge`
- `payload`: typed per event type
- `metrics`: tokens, latency, cost

### 9.2 Execution Trace Visualization
- Mermaid diagram generation from execution DAG
- Timeline view with agent swimlanes
- Token/cost waterfall
- Error propagation tree

### 9.3 Replay & Debugging
- **Deterministic replay** from any checkpoint (sandbox + memory state)
- **Counterfactual execution**: "What if tool X returned Y?"
- **Skill attribution**: Which skill generated which action?

---

## 10. API Surface

### 10.1 Primary Endpoint
```
POST /api/pi-agent/execute
{
  "intent": "Build a multi-step onboarding flow with 3 forms, conditional logic, and analytics dashboard",
  "constraints": { "maxForms": 5, "deadline": "2025-08-10" },
  "sessionId": "sess_abc",
  "budget": { "maxTokens": 200000, "maxCostUsd": 5.00 },
  "memoryScope": { "read": ["user_preferences", "recent_forms"], "write": ["episodic", "semantic"] }
}
```

### 10.2 Streaming Response (SSE)
```json
// Event types
{ "type": "plan", "plan": ExecutionPlan }
{ "type": "task_start", "taskId": "task_1", "agent": "pi_executor_forms" }
{ "type": "tool_call", "taskId": "task_1", "tool": "create_form", "params": {...} }
{ "type": "tool_result", "taskId": "task_1", "result": {...} }
{ "type": "verification", "taskId": "task_1", "verdict": "pass" }
{ "type": "checkpoint", "executionId": "exec_123", "stateRef": "redis_key" }
{ "type": "awaiting_approval", "mutations": [...] }
{ "type": "completed", "result": {...}, "artifacts": [...] }
{ "type": "error", "taskId": "task_1", "error": {...}, "recovery": "retry|escalate|abort" }
```

### 10.3 Management Endpoints
```
GET  /api/pi-agent/executions/:executionId       // Get execution state
POST /api/pi-agent/executions/:executionId/resume // Resume from checkpoint
POST /api/pi-agent/executions/:executionId/approve // Approve merge
GET  /api/pi-agent/skills                         // List skills
POST /api/pi-agent/skills                         // Register skill
GET  /api/pi-agent/memory/search                  // Semantic memory search
```

---

## 11. Configuration

```env
# Model selection
PI_ORCHESTRATOR_MODEL=gpt-4o
PI_PLANNER_MODEL=o1-mini
PI_EXECUTOR_MODEL=gpt-4o-mini
PI_CRITIC_MODEL=claude-opus-4
PI_MEMORY_MODEL=text-embedding-3-large
PI_SKILL_SYNTH_MODEL=gpt-4o

# Budgets
PI_MAX_TOKENS_PER_EXECUTION=200000
PI_MAX_COST_PER_EXECUTION_USD=10.00
PI_MAX_TIME_PER_EXECUTION_MS=300000
PI_MAX_TASKS_PER_EXECUTION=50
PI_MAX_RETRIES_PER_TASK=3
PI_MAX_PLAN_RETRIES=2

# Memory
PI_MEMORY_TTL_DAYS=30
PI_EPISODIC_TTL_DAYS=90
PI_VECTOR_DB_URI=mongodb://...
PI_REDIS_URL=redis://...

# Safety
PI_ENABLE_SKILL_SYNTHESIS=true
PI_ENABLE_BULK_OPERATIONS=false
PI_REQUIRE_CONFIRMATION_FOR_DESTRUCTIVE=true
PI_PII_REDACTION_MODE=strict  # strict | key_only | off
```

---

## 12. Migration Path from Current Architecture

| Current Component | PI Agent Equivalent | Migration Strategy |
|-------------------|---------------------|-------------------|
| `runAgentLoop()` | `PIOrchestrator.execute()` | Wrap current loop as `LegacyExecutor` skill |
| `Drafter` | `PlannerAgent` (intent classification) | Extract classification logic |
| `Planner` | `PlannerAgent` (task graph) | Upgrade to DAG-based planning |
| `Executor` | `ExecutorAgents` (domain-specialized) | Split by domain, keep sandbox logic |
| `Evaluator` | `CriticAgent` | Upgrade to adversarial verification |
| `Communicator` | `Orchestrator` response synthesis | Merge into orchestrator |
| `sandboxRedisStore` | `ExecutionSandbox` (per-execution) | Extend key schema |
| `mergeSandboxToProduction` | `MergeCoordinator` | Keep transactional logic |
| `permissions.json` | `PolicyEngine` (OPA-style) | Extend with tool-level policies |
| `AgentTicket` | `PIExecutionState` | New collection, migrate on read |

---

## 13. Success Criteria (MVP)

| Metric | Target |
|--------|--------|
| **Task success rate** (end-to-end) | ≥ 95% |
| **Avg. execution time** (simple form) | < 10s |
| **Avg. execution time** (complex multi-form) | < 60s |
| **Token efficiency** vs. current loop | ≤ 1.2x |
| **User confirmation rate** (merge approval) | ≥ 90% |
| **Skill synthesis accuracy** (human eval) | ≥ 80% |
| **Memory recall precision** (relevant context) | ≥ 85% |
| **Zero data loss** (sandbox merge) | 100% |
| **Zero unauthorized access** | 100% |

---

## 14. Appendices

### A. Agent Identity Registry
```typescript
const AGENT_REGISTRY: Record<AgentIdentity, AgentSpec> = {
  pi_orchestrator: { model: "gpt-4o", maxConcurrency: 1, capabilities: ["plan", "dispatch", "aggregate", "verify"] },
  pi_planner: { model: "o1-mini", maxConcurrency: 3, capabilities: ["task_graph", "dependency_resolution", "resource_allocation"] },
  pi_executor_forms: { model: "gpt-4o-mini", maxConcurrency: 10, capabilities: ["create_form", "update_form", "delete_form", "read_form"] },
  pi_executor_responses: { model: "gpt-4o-mini", maxConcurrency: 10, capabilities: ["query_responses", "generate_analytics", "run_database_query"] },
  pi_executor_views: { model: "gpt-4o-mini", maxConcurrency: 10, capabilities: ["create_custom_view", "update_custom_view", "delete_custom_view", "get_custom_views"] },
  pi_critic: { model: "claude-opus-4", maxConcurrency: 5, capabilities: ["verify", "red_team", "conformance_check"] },
  pi_memory: { model: "text-embedding-3-large", maxConcurrency: 20, capabilities: ["store", "retrieve", "assemble_context", "forget"] },
  pi_skill_synth: { model: "gpt-4o", maxConcurrency: 2, capabilities: ["analyze", "generate", "validate", "register", "compose"] },
};
```

### B. Tool Allow-List per Agent
(Enforced at runtime by Executor dispatcher)
```typescript
const AGENT_TOOL_ALLOWLIST: Record<AgentIdentity, string[]> = {
  pi_orchestrator: [],  // No direct tool access
  pi_planner: [],       // No direct tool access
  pi_executor_forms: ["create_form", "update_form", "delete_form", "read_form", "bulk_create_forms", "bulk_update_forms"],
  pi_executor_responses: ["query_responses", "generate_analytics", "run_database_query", "export_responses"],
  pi_executor_views: ["create_custom_view", "get_custom_views", "update_custom_view", "delete_custom_view"],
  pi_critic: [],        // Read-only verification
  pi_memory: [],        // Internal only
  pi_skill_synth: ["run_database_query"],  // For pattern analysis only
};
```

---

*End of Specification*