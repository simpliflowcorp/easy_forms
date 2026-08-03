# PI Agent Upgrade Plan v3 — Capability Improvements & Defect Fixes

**Version:** 3.0  
**Date:** 2025-08-03  
**Based On:** `pi_agent_spec.md` v1.0, Current Architecture Analysis  
**Status:** Implementation Roadmap

---

## 1. Executive Summary

This document outlines the **concrete implementation plan** to evolve the current single-loop 4-persona agent (`runAgentLoop`) into the **PI Multi-Agent System** specified in `pi_agent_spec.md`. It identifies **critical defects** in the current architecture, prioritizes **capability gaps**, and provides a **phased delivery plan** with measurable milestones.

**Target:** Production-ready PI Agent MVP in **8 weeks** (4 phases × 2 weeks).

---

## 2. Current Architecture Defects (Critical)

### 2.1 Structural Defects

| ID | Defect | Impact | Root Cause | Fix Priority |
|----|--------|--------|------------|--------------|
| **D-001** | **Single-threaded persona loop** — no parallel execution, no sub-agent delegation | Latency scales linearly with task complexity; cannot handle multi-form workflows | Hardcoded `while (isLooping)` in `agentLoop.ts` | **P0** |
| **D-002** | **No persistent memory across sessions** — only `conversationHistory` (capped at 10 turns) | Cannot learn user preferences, repeat patterns, or build procedural knowledge | Redis TTL 24h, no vector search, no semantic indexing | **P0** |
| **D-003** | **Planner produces flat action lists, not task graphs** — no dependency resolution, no critical path | Sequential execution even for independent tasks; no rollback granularity | `runPlanner` emits `actionPlan: AgentAction[]` without edges | **P0** |
| **D-004** | **Executor is monolithic** — single `runExecutor` handles all domains | Tool allow-list pollution; no domain specialization; hard to extend | `tools.ts` schema used by all; no executor routing | **P0** |
| **D-005** | **Evaluator is post-hoc only** — no pre-execution verification, no red-teaming | Hallucinated tool calls caught only after sandbox mutation attempt | `runEvaluator` runs after `EXECUTOR_SANDBOX` | **P1** |
| **D-006** | **No skill synthesis/extensibility** — skills hardcoded in `skills.md` + `tools.ts` | Users cannot define custom workflows; every new capability requires code deploy | Static `SKILL_TO_SCOPE`, `TOOL_TO_SCOPE` maps | **P1** |
| **D-007** | **Per-user lock prevents concurrent workflows** — `agent_lock:{userId}` | Multi-tab, webhook, or parallel requests blocked | `acquireAgentLock` in `agentLoop.ts` | **P1** |
| **D-008** | **No structured audit trail for LLM decisions** — only `executionTrace` with truncated payloads | Cannot debug "why did the agent do X?" post-hoc | `addTrace` truncates to 4KB, no decision rationale | **P1** |
| **D-009** | **Token budget checked only at loop iteration boundaries** — not per-tool-call | Single expensive tool call can blow budget mid-execution | `checkBudget` called once per loop in `agentLoop.ts` | **P2** |
| **D-010** | **PII redaction is key-name only** — misses values in arbitrary keys | Email/phone in `"User Email Address"` field leaks to LLM | `redactPII` in `helper/redact.ts` only checks key names | **P2** |

---

### 2.2 Functional Gaps vs. PI Spec

| Capability | Current State | PI Spec Target | Gap |
|------------|---------------|----------------|-----|
| **Multi-form workflows** | ❌ Single form per ticket | ✅ DAG of form tasks | Complete redesign |
| **Conditional logic / branching** | ❌ Not supported | ✅ Planner generates conditional edges | New planner output schema |
| **Parallel tool execution** | ❌ Sequential only | ✅ Executor pool with dependency wait | New executor dispatcher |
| **Skill creation by users** | ❌ Impossible | ✅ `pi_skill_synth` agent + registry | New agent + persistence |
| **Long-term memory** | ❌ 24h Redis + 10-turn history | ✅ Tiered memory (episodic/semantic/procedural) | New memory agent + vector DB |
| **Self-critique / red-teaming** | ❌ Basic QA only | ✅ Adversarial `pi_critic` with findings | New critic agent |
| **Budget enforcement per-task** | ❌ Per-loop only | ✅ Per-tool, per-agent, per-execution | Budget tracker service |
| **Deterministic replay** | ❌ Not possible | ✅ Checkpoint-based replay | Checkpoint serializer |
| **Cross-session learning** | ❌ No | ✅ Procedural memory extraction | Memory agent synthesis |
| **Proactive suggestions** | ❌ Reactive only | ✅ Orchestrator emits `nextActions` | Orchestrator output schema |

---

## 3. Phased Implementation Plan

### Phase 1: Foundation & Core Multi-Agent (Weeks 1-2)
**Goal:** Replace `runAgentLoop` with `PIOrchestrator` + `PlannerAgent` + `ExecutorAgent` (forms domain) + `CriticAgent`. Keep memory simple (Redis + Mongo).

#### Deliverables
| Task | Owner | Files | Acceptance Criteria |
|------|-------|-------|---------------------|
| **1.1** Create `PIOrchestrator` class with ACP message bus | Backend | `src/agent/pi/orchestrator.ts`, `src/agent/pi/acp.ts` | Routes intent → planner → executor → critic → response |
| **1.2** Implement `PlannerAgent` with DAG output | Backend | `src/agent/pi/planner.ts`, `src/agent/pi/types.ts` | Emits `ExecutionPlan` with `TaskNode[]`, `TaskEdge[]` |
| **1.3** Split `Executor` into domain agents | Backend | `src/agent/pi/executors/forms.ts`, `src/agent/pi/executors/base.ts` | `pi_executor_forms` handles form tools only |
| **1.4** Implement `CriticAgent` with pre-flight verification | Backend | `src/agent/pi/critic.ts` | Verifies plan before execution; red-teams results |
| **1.5** Per-execution sandbox + lock (`pi_lock:{executionId}`) | Backend | `src/agent/pi/sandbox.ts`, `src/agent/pi/lock.ts` | Concurrent executions per user work |
| **1.6** Structured audit log with decision rationale | Backend | `src/agent/pi/audit.ts` | Every LLM call logged with input/output/reasoning |
| **1.7** Budget tracker (per-execution, per-task, per-user-day) | Backend | `src/agent/pi/budget.ts` | Enforces limits at tool-call granularity |
| **1.8** SSE streaming for new orchestrator | Backend | `src/app/api/pi-agent/execute/route.ts` | Streams plan, task events, verification, completion |

#### Testing
- Unit: Planner DAG generation, Executor tool routing, Critic verdict schema
- Integration: Happy path (create form), retry path (critic rejects → executor retries), budget exhaustion
- E2E: Multi-form workflow (create 2 forms, link via custom view)

---

### Phase 2: Memory Layer & Response/Views Executors (Weeks 3-4)
**Goal:** Add tiered memory, complete executor coverage, enable cross-session learning.

#### Deliverables
| Task | Owner | Files | Acceptance Criteria |
|------|-------|-------|---------------------|
| **2.1** Implement `MemoryAgent` with 3 tiers | Backend | `src/agent/pi/memory/agent.ts`, `src/agent/pi/memory/vector.ts` | Stores/retrieves episodic/semantic/procedural |
| **2.2** Vector DB integration (MongoDB Atlas Vector Search or Pinecone) | Backend | `src/agent/pi/memory/vector.ts` | Semantic search over traces, skills, preferences |
| **2.3** `pi_executor_responses` + `pi_executor_views` | Backend | `src/agent/pi/executors/responses.ts`, `src/agent/pi/executors/views.ts` | Full tool coverage for responses & views |
| **2.4** Conversation history → episodic memory migration | Backend | `src/agent/pi/memory/migration.ts` | Existing `conversationHistory` searchable |
| **2.5** User preference learning (implicit from behavior) | Backend | `src/agent/pi/memory/preferences.ts` | Infers preferred field types, naming, view configs |
| **2.6** Procedural memory extraction (successful workflows → skills) | Backend | `src/agent/pi/memory/procedural.ts` | Detects repeat patterns, proposes skill synthesis |
| **2.7** Context assembly for agent prompts | Backend | `src/agent/pi/memory/context.ts` | Injects relevant memory into planner/executor/critic |

#### Testing
- Memory: Store 1000 traces, verify recall precision/recall
- Preference: Same user creates 5 forms → 6th form pre-fills preferred fields
- Procedural: User repeats "NPS + comments" 3x → skill proposed

---

### Phase 3: Skill Synthesis & Advanced Planning (Weeks 5-6)
**Goal:** Enable user-defined skills, conditional planning, bulk operations.

#### Deliverables
| Task | Owner | Files | Acceptance Criteria |
|------|-------|-------|---------------------|
| **3.1** `pi_skill_synth` agent implementation | Backend | `src/agent/pi/skill_synth/agent.ts` | Analyzes patterns, generates skill JSON, registers |
| **3.2** Skill Registry API (CRUD, versioning, deprecation) | Backend | `src/agent/pi/skill_synth/registry.ts`, `src/app/api/pi-agent/skills/route.ts` | Users can list/create/update/delete skills |
| **3.3** Skill validation sandbox (safe execution test) | Backend | `src/agent/pi/skill_synth/validator.ts` | New skills tested against guardrails before register |
| **3.4** Planner: conditional edges & branching | Backend | `src/agent/pi/planner.ts` (extend) | Plans with `if/else` based on tool results |
| **3.5** Planner: loop constructs (map/reduce over collections) | Backend | `src/agent/pi/planner.ts` (extend) | "For each form, generate analytics" → parallel tasks |
| **3.6** Bulk operation tools (`bulk_create_forms`, `export_responses`) | Backend | `src/lib/agentTools.ts` (extend), `src/agent/tools.ts` (extend) | Atomic multi-form create, response export |
| **3.7** Skill composition (macro skills from micro skills) | Backend | `src/agent/pi/skill_synth/composer.ts` | "onboarding_flow" = create_form × 3 + create_view |

#### Testing
- Skill synth: Generate "weekly_pulse" skill from 3 examples → registers → executes
- Conditional: "If form has >100 responses, generate analytics else create view"
- Bulk: Create 10 forms in one execution → all succeed or all rollback

---

### Phase 4: Hardening, Observability & Production Readiness (Weeks 7-8)
**Goal:** Zero-defect target, full observability, migration path for existing users.

#### Deliverables
| Task | Owner | Files | Acceptance Criteria |
|------|-------|-------|---------------------|
| **4.1** Deterministic replay from checkpoints | Backend | `src/agent/pi/replay.ts` | Re-run any execution from checkpoint with same results |
| **4.2** Counterfactual execution ("what if") | Backend | `src/agent/pi/replay.ts` (extend) | Modify tool result at checkpoint, re-execute downstream |
| **4.3** Execution trace visualization (Mermaid + Timeline) | Backend/Frontend | `src/agent/pi/visualize.ts`, UI components | Mermaid DAG, swimlane timeline, cost waterfall |
| **4.4** PII redaction upgrade (value-based regex + key-name) | Backend | `src/agent/helper/redact.ts` (extend) | Catches email/phone/SSN in any string value |
| **4.5** Migration shim: Legacy `runAgentLoop` → PI Orchestrator | Backend | `src/agent/pi/legacy_shim.ts` | Existing tickets resume in new system |
| **4.6** Comprehensive eval suite (agent:eval) | QA | `tests/agent/pi/` | 100+ scenarios: happy, error, adversarial, budget, concurrency |
| **4.7** Load testing (100 concurrent executions) | QA | `scripts/load_test_pi_agent.ts` | P99 latency < 30s, 0 data loss, 0 auth bypass |
| **4.8** Documentation & runbooks | Docs | `docs/pi-agent/` | Architecture, API, troubleshooting, runbooks |

#### Testing
- Replay: 100 random executions → replay matches original
- Adversarial: Prompt injection, tool hallucination, budget bypass attempts
- Migration: 50 legacy tickets → all resume correctly

---

## 4. Detailed Technical Specifications (Per Phase)

### 4.1 Phase 1: Core Types & Interfaces

```typescript
// src/agent/pi/types.ts
export interface ExecutionPlan {
  planId: string;
  goal: string;
  tasks: TaskNode[];
  edges: TaskEdge[];
  checkpoints: Checkpoint[];
  estimatedCost: CostEstimate;
  riskAssessment: Risk[];
  fallbackPlan?: ExecutionPlan;
  metadata: {
    createdBy: "pi_planner";
    model: string;
    tokenEstimate: number;
  };
}

export interface TaskNode {
  taskId: string;
  agent: ExecutorIdentity;  // pi_executor_forms | pi_executor_responses | pi_executor_views
  skill: string;
  tool: string;
  params: Record<string, any>;
  successCriteria: SuccessCriterion[];
  dependsOn: string[];       // Task IDs
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  metadata: {
    isDestructive: boolean;
    requiresConfirmation: boolean;
    idempotencyKey: string;
    estimatedTokens: number;
  };
}

export interface TaskEdge {
  from: string;  // taskId
  to: string;    // taskId
  type: "dependency" | "conditional" | "loop";
  condition?: string;  // For conditional: "result.count > 100"
}

export interface SuccessCriterion {
  type: "tool_success" | "schema_match" | "value_check" | "custom";
  specification: any;  // e.g., { field: "result.form.name", equals: params.name }
}

export interface CriticVerdict {
  verdict: "pass" | "conditional_pass" | "fail" | "escalate";
  score: number;
  findings: Finding[];
  requiredFixes: FixDirective[];
  retryGuidance?: string;
  escalationReason?: string;
}

export interface ExecutionState {
  executionId: string;
  userId: string;
  sessionId?: string;
  status: ExecutionStatus;
  plan: ExecutionPlan;
  taskStates: Map<string, TaskState>;
  checkpoints: Checkpoint[];
  budget: BudgetSnapshot;
  auditLog: AuditEntry[];
  memoryPointers: MemoryPointer[];
}
```

### 4.2 Phase 1: ACP Message Bus

```typescript
// src/agent/pi/acp.ts
type Performative = 
  | "request" | "inform" | "query" | "propose" 
  | "accept" | "reject" | "cancel" | "failure" | "heartbeat";

interface ACPMessage<T = any> {
  messageId: string;
  timestamp: string;
  from: AgentIdentity;
  to: AgentIdentity | "broadcast";
  performative: Performative;
  payload: T;
  correlationId?: string;
  replyTo?: AgentIdentity;
  ttl?: number;
}

class MessageBus {
  private subscribers: Map<AgentIdentity, (msg: ACPMessage) => Promise<void>> = new Map();
  private pending: Map<string, { resolve: Function; reject: Function; timeout: NodeJS.Timeout }> = new Map();
  
  subscribe(agent: AgentIdentity, handler: (msg: ACPMessage) => Promise<void>): void;
  unsubscribe(agent: AgentIdentity): void;
  send<T>(msg: ACPMessage<T>): Promise<void>;
  request<T, R>(from: AgentIdentity, to: AgentIdentity, payload: T, timeoutMs?: number): Promise<R>;
  broadcast(msg: ACPMessage): Promise<void>;
}
```

### 4.3 Phase 1: Orchestrator Loop

```typescript
// src/agent/pi/orchestrator.ts
export class PIOrchestrator {
  private bus: MessageBus;
  private budgetTracker: BudgetTracker;
  private memory: MemoryAgent;
  private sandbox: ExecutionSandbox;
  private lock: ExecutionLock;
  
  async execute(input: OrchestratorInput): Promise<OrchestratorOutput> {
    const executionId = generateExecutionId();
    
    // 1. Acquire per-execution lock
    await this.lock.acquire(executionId, input.userId);
    
    // 2. Pre-flight budget check
    await this.budgetTracker.checkPreFlight(input.userId, input.budget);
    
    // 3. Load context from memory
    const context = await this.memory.assembleContext(input.userId, input.memoryScope);
    
    // 4. PLAN
    const plan = await this.bus.request<PlannerRequest, ExecutionPlan>(
      "pi_orchestrator", "pi_planner", { goal: input.intent, context, budget: input.budget }
    );
    
    // 5. CRITIC: Pre-flight plan verification
    const planVerdict = await this.bus.request<CriticRequest, CriticVerdict>(
      "pi_orchestrator", "pi_critic", { plan, phase: "pre_execution" }
    );
    if (planVerdict.verdict === "fail") {
      // Retry planning with feedback (max 2x)
      return this.retryWithFeedback(input, planVerdict);
    }
    
    // 6. EXECUTE: Topological task execution
    const executionState = await this.executePlan(executionId, input, plan, context);
    
    // 7. CRITIC: Post-execution verification
    const finalVerdict = await this.bus.request<CriticRequest, CriticVerdict>(
      "pi_orchestrator", "pi_critic", { plan, executionState, phase: "post_execution" }
    );
    
    // 8. MERGE if mutating
    if (executionState.hasMutations && finalVerdict.verdict !== "fail") {
      return this.awaitUserApprovalAndMerge(executionState);
    }
    
    // 9. LEARN: Memory indexing
    await this.memory.indexExecution(executionState);
    
    // 10. RESPOND
    return this.synthesizeResponse(executionState);
  }
}
```

### 4.4 Phase 2: Memory Agent

```typescript
// src/agent/pi/memory/agent.ts
export class MemoryAgent {
  private vectorDB: VectorStore;
  private redis: RedisClient;
  private mongo: MongoClient;
  
  // Tier 1: Working memory (Redis, session-scoped)
  async getWorkingMemory(executionId: string): Promise<WorkingMemory>;
  async setWorkingMemory(executionId: string, data: WorkingMemory): Promise<void>;
  
  // Tier 2: Short-term (Redis + Mongo, 30 days)
  async storeEpisodic(trace: ExecutionTrace): Promise<string>;  // Returns memoryId
  async retrieveEpisodic(query: MemoryQuery, limit: number): Promise<ExecutionTrace[]>;
  async getUserPreferences(userId: string): Promise<UserPreferences>;
  async updateUserPreferences(userId: string, prefs: Partial<UserPreferences>): Promise<void>;
  
  // Tier 3: Long-term (Vector DB, indefinite)
  async storeSemantic(skill: SkillDefinition): Promise<void>;
  async searchSemantic(query: string, filters: MemoryFilter, limit: number): Promise<SkillDefinition[]>;
  async storeProcedural(workflow: ProceduralMemory): Promise<void>;
  async retrieveProcedural(pattern: string): Promise<ProceduralMemory[]>;
  
  // Context assembly for agents
  async assembleContext(userId: string, scope: MemoryScope): Promise<AgentContext> {
    const [preferences, recentTraces, relevantSkills, procedural] = await Promise.all([
      this.getUserPreferences(userId),
      this.retrieveEpisodic({ userId, limit: 5 }),
      this.searchSemantic(scope.query || "", { category: scope.read }, 10),
      this.retrieveProcedural(scope.query || ""),
    ]);
    return { preferences, recentTraces, relevantSkills, procedural };
  }
}
```

### 4.5 Phase 3: Skill Synthesis Agent

```typescript
// src/agent/pi/skill_synth/agent.ts
export class SkillSynthesisAgent {
  private registry: SkillRegistry;
  private memory: MemoryAgent;
  private validator: SkillValidator;
  
  async analyzeAndPropose(userId: string, trigger: "pattern_detected" | "user_request"): Promise<SkillProposal[]> {
    // 1. Get recent successful executions
    const traces = await this.memory.retrieveEpisodic({ userId, status: "completed", limit: 50 });
    
    // 2. Detect recurring patterns (LLM-based)
    const patterns = await this.detectPatterns(traces);
    
    // 3. For each pattern, generate skill definition
    const proposals: SkillProposal[] = [];
    for (const pattern of patterns) {
      const skillDef = await this.generateSkill(pattern);
      const validation = await this.validator.validate(skillDef);
      if (validation.valid) {
        proposals.push({ skillDef, pattern, confidence: pattern.frequency / traces.length });
      }
    }
    return proposals;
  }
  
  async registerSkill(skillDef: SkillDefinition, author: "user" | "system"): Promise<SkillDefinition> {
    // 1. Validate against guardrails
    const validation = await this.validator.validate(skillDef);
    if (!validation.valid) throw new Error(`Skill validation failed: ${validation.errors.join(", ")}`);
    
    // 2. Test in sandbox
    const testResult = await this.validator.sandboxTest(skillDef);
    if (!testResult.pass) throw new Error(`Sandbox test failed: ${testResult.error}`);
    
    // 3. Register with versioning
    return this.registry.register(skillDef, author);
  }
  
  async composeSkills(skillIds: string[], compositionName: string): Promise<SkillDefinition> {
    // Generate macro skill that sequences micro skills
    const microSkills = await Promise.all(skillIds.map(id => this.registry.get(id)));
    return this.generateMacroSkill(microSkills, compositionName);
  }
}
```

---

## 5. Migration Strategy

### 5.1 Legacy Compatibility Layer

```typescript
// src/agent/pi/legacy_shim.ts
export class LegacyAgentShim {
  // Wraps PI Orchestrator to mimic runAgentLoop interface
  async runAgentLoop(
    userId: string,
    prompt: string,
    mergeApproved: boolean,
    resumeTicketId?: string,
    sessionId?: string,
    onUpdate?: (state: AgentState) => void,
    onChunk?: (persona: string, chunk: string) => void
  ): Promise<AgentState> {
    // 1. Convert legacy prompt → PI intent
    const intent = this.convertPromptToIntent(prompt, resumeTicketId);
    
    // 2. Execute via PI Orchestrator
    const result = await piOrchestrator.execute({
      userId,
      intent,
      sessionId,
      budget: { maxTokens: 50000, maxCostUsd: 1.00 },
      memoryScope: { read: ["all"], write: ["episodic"] }
    });
    
    // 3. Convert PI output → legacy AgentState
    return this.convertResultToAgentState(result, mergeApproved, resumeTicketId);
  }
  
  private convertPromptToIntent(prompt: string, resumeTicketId?: string): UserIntent {
    // Use current Drafter logic for classification, then enrich
    // This preserves existing behavior while routing through new system
  }
}
```

### 5.2 Data Migration

| Collection | Migration Action |
|------------|------------------|
| `AgentTicket` | Add `executionId` field; on read, if missing, create PI execution and link |
| `AgentUsage` | Keep for billing; add `executionId` correlation |
| `sandbox:{userId}` | Migrate to `sandbox:{executionId}` on first resume |
| `conversationHistory` | Bulk insert into `episodic_memory` collection with embeddings |

---

## 6. Risk Assessment & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Planner generates invalid DAGs** | High | High | Critic pre-flight + schema validation + fallback to linear plan |
| **Executor tool hallucination** | Medium | High | Allow-list per agent + Critic verification + sandbox isolation |
| **Memory recall returns irrelevant context** | Medium | Medium | Relevance scoring + user feedback loop + manual override |
| **Skill synthesis creates unsafe skills** | Low | Critical | Sandbox test + human approval for user-defined + guardrail validation |
| **Budget overrun in production** | Medium | High | Hard limits at orchestrator + per-tool tracking + circuit breaker |
| **Concurrent execution data races** | Low | High | Per-execution lock + optimistic concurrency + idempotency keys |
| **Vector DB unavailable** | Low | Medium | Fallback to keyword search in Mongo; degrade gracefully |
| **Migration breaks existing tickets** | Medium | High | Legacy shim + parallel run + gradual cutover + rollback plan |

---

## 7. Success Metrics & KPIs

| Metric | Baseline (Current) | Target (PI v3) | Measurement |
|--------|-------------------|----------------|-------------|
| **End-to-end success rate** | ~85% (est.) | ≥ 95% | `executionState.status === "completed"` / total |
| **Avg. latency (simple form)** | ~8s | < 10s | P50 from `executionTrace` timestamps |
| **Avg. latency (complex multi-form)** | N/A (not supported) | < 60s | P50 for executions with >3 tasks |
| **Token efficiency** | 1.0x (baseline) | ≤ 1.2x | `totalTokens / taskCount` vs. current |
| **User merge approval rate** | ~90% | ≥ 95% | Approved merges / total merge prompts |
| **Skill synthesis adoption** | 0% | ≥ 20% of users | Users with ≥1 custom skill / total users |
| **Memory recall precision** | N/A | ≥ 85% | Human eval of context relevance |
| **Zero data loss incidents** | 0 (target) | 0 | Audit log verification |
| **Unauthorized access attempts blocked** | 100% | 100% | Security test suite pass rate |

---

## 8. Team & Resource Allocation

| Role | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|------|---------|---------|---------|---------|
| Backend Engineer (Agent Core) | 2 | 1 | 1 | 1 |
| Backend Engineer (Memory/Vector) | 0 | 2 | 1 | 0 |
| Backend Engineer (Skills/Tools) | 1 | 1 | 2 | 1 |
| QA / Eval Engineer | 0.5 | 1 | 1 | 2 |
| Frontend Engineer (Streaming UI) | 0.5 | 0 | 0.5 | 1 |
| DevOps (Vector DB, Load Test) | 0 | 0.5 | 0.5 | 1 |
| **Total FTE** | **4** | **5.5** | **6** | **6** |

---

## 9. Appendix: Current Codebase Mapping

### Files to Refactor/Replace
| Current File | PI Agent Replacement | Phase |
|--------------|---------------------|-------|
| `src/agent/agentLoop.ts` | `src/agent/pi/orchestrator.ts` + `src/agent/pi/legacy_shim.ts` | 1, 4 |
| `src/agent/personas/drafter.ts` | `src/agent/pi/planner.ts` (intent classification) | 1 |
| `src/agent/personas/planner.ts` | `src/agent/pi/planner.ts` (DAG generation) | 1 |
| `src/agent/personas/executor.ts` | `src/agent/pi/executors/*.ts` | 1, 2 |
| `src/agent/personas/evaluator.ts` | `src/agent/pi/critic.ts` | 1 |
| `src/agent/personas/communicator.ts` | `src/agent/pi/orchestrator.ts` (response synthesis) | 1 |
| `src/agent/tools.ts` | Extended in `src/agent/pi/tools.ts` | 1, 3 |
| `src/lib/agentTools.ts` | Extended with bulk/export tools | 3 |
| `src/agent/sandbox/sandboxRedisStore.ts` | `src/agent/pi/sandbox.ts` (per-execution) | 1 |
| `src/agent/sandbox/agentLock.ts` | `src/agent/pi/lock.ts` (per-execution) | 1 |
| `src/agent/policy/permissions.ts` | `src/agent/pi/policy.ts` (OPA-style) | 1 |
| `src/agent/helper/redact.ts` | Enhanced PII redaction | 4 |

### New Files (Phase 1)
```
src/agent/pi/
├── types.ts              # Core type definitions
├── acp.ts                # Agent Communication Protocol
├── orchestrator.ts       # PI Orchestrator
├── planner.ts            # Planner Agent
├── critic.ts             # Critic Agent
├── sandbox.ts            # Per-execution sandbox
├── lock.ts               # Per-execution lock
├── budget.ts             # Budget tracker
├── audit.ts              # Structured audit logging
├── executors/
│   ├── base.ts           # Base executor class
│   ├── forms.ts          # Form executor
│   ├── responses.ts      # Response executor (Phase 2)
│   └── views.ts          # View executor (Phase 2)
├── memory/               # Phase 2
│   ├── agent.ts
│   ├── vector.ts
│   ├── preferences.ts
│   ├── procedural.ts
│   └── context.ts
├── skill_synth/          # Phase 3
│   ├── agent.ts
│   ├── registry.ts
│   ├── validator.ts
│   └── composer.ts
├── replay.ts             # Phase 4
├── visualize.ts          # Phase 4
└── legacy_shim.ts        # Phase 4
```

---

## 10. Immediate Next Steps (Week 1)

1. **Create PI Agent directory structure** — `mkdir -p src/agent/pi/{executors,memory,skill_synth}`
2. **Define core types** — `src/agent/pi/types.ts` (ExecutionPlan, TaskNode, CriticVerdict, etc.)
3. **Implement ACP message bus** — `src/agent/pi/acp.ts` with in-memory + Redis backend
4. **Build PlannerAgent** — Extract intent classification from Drafter, add DAG generation
5. **Build Forms Executor** — Extract form tool logic from current Executor
6. **Build CriticAgent** — Start with schema validation + basic red-teaming
7. **Wire Orchestrator loop** — Minimal end-to-end: intent → plan → execute → verify → respond
8. **Add SSE endpoint** — `src/app/api/pi-agent/execute/route.ts` streaming new event types
9. **Write integration test** — Create form → verify sandbox → merge → audit log

---

*End of Upgrade Plan v3*