/**
 * R6.2 — Stub-stack evaluation runner.
 * 
 * Runs the golden prompt evaluation against a fully mocked stack:
 * - In-memory MongoDB-like stores (no external DB)
 * - Mocked LLM client with configurable responses
 * - No external dependencies (no MongoDB, no Redis, no network calls)
 * 
 * Runs with: node --experimental-strip-types tests/agent/eval/stubRunner.ts
 * 
 * This bypasses the ts-node + TS7 compatibility issue entirely.
 */

import { runAgentLoop } from "@/agent/agentLoop";
import { AgentState, AgentTicket, AgentAction } from "@/agent/types";
import AgentTicketModel from "@/models/agentTicketModel";
import AgentUsageModel from "@/models/agentUsageModel";
import User from "@/models/userModel";
import { connectDB } from "@/dbConfig/dbConfig";
import { retryLLM, LLMOfflineError, LLMBudgetExceededError, LLMMessage, LLMOptions, LLMResult } from "@/lib/llmClient";

// ─── In-memory stores ────────────────────────────────────────────────────

interface InMemoryUser {
  _id: string;
  username: string;
  email: string;
  password: string;
  preferences?: Record<string, any>;
}

interface InMemoryTicket {
  ticketId: string;
  sessionId?: string;
  userId: string;
  prompt: string;
  stage: string;
  title: string;
  status: string;
  activePersona: string;
  iterationCount: number;
  maxIterations: number;
  requirements: any;
  actionPlan: any[];
  sandbox: any;
  executionTrace: any[];
  reply: string;
  isComplete: boolean;
  isQuestion: boolean;
  resumedPrompt?: string;
  drafterMessage?: string;
  evaluatorFeedback?: string;
  llmRawOutput?: string;
  createdAt: string;
}

interface InMemoryUsage {
  ticketId: string;
  userId: string;
  persona: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  createdAt: Date;
}

const users = new Map<string, InMemoryUser>();
const tickets = new Map<string, InMemoryTicket>(); // key: `${userId}:${ticketId}`
const usageRecords: InMemoryUsage[] = [];

// ─── Mock LLM Client ────────────────────────────────────────────────────

type MockLLMResponse = {
  content: string;
  tool_calls?: any[];
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number; model: string };
};

const mockLLMResponses = new Map<string, MockLLMResponse[]>();
let mockLLMResponseIndex = new Map<string, number>();

function setMockLLMResponse(key: string, responses: MockLLMResponse[]) {
  mockLLMResponses.set(key, responses);
  mockLLMResponseIndex.set(key, 0);
}

function getMockLLMResponse(key: string): MockLLMResponse | null {
  const responses = mockLLMResponses.get(key);
  if (!responses || responses.length === 0) return null;
  const idx = mockLLMResponseIndex.get(key) || 0;
  if (idx >= responses.length) return responses[responses.length - 1];
  mockLLMResponseIndex.set(key, idx + 1);
  return responses[idx];
}

// Override the real retryLLM with our mock
const originalRetryLLM = retryLLM;

// We'll patch the module's export at runtime
import * as llmClientModule from "@/lib/llmClient";

// ─── Mock Mongoose Models ────────────────────────────────────────────────

const mockAgentTicketModel = {
  findOne: async (query: any) => {
    const key = `${query.userId}:${query.ticketId}`;
    const ticket = tickets.get(key);
    if (!ticket) return null;
    return { ...ticket, lean: () => ({ ...ticket }) };
  },
  findOneAndUpdate: async (query: any, update: any, options?: any) => {
    const key = `${query.userId}:${query.ticketId}`;
    const existing = tickets.get(key);
    const updated = { ...existing, ...update, ticketId: query.ticketId, userId: query.userId };
    tickets.set(key, updated);
    return updated;
  },
  create: async (data: any) => {
    if (Array.isArray(data)) return data.map(d => ({ ...d }));
    return { ...data };
  },
  find: async (query: any) => {
    const results: InMemoryTicket[] = [];
    for (const ticket of tickets.values()) {
      if (query.userId && ticket.userId !== query.userId) continue;
      results.push(ticket);
    }
    return results.map(t => ({ ...t, lean: () => ({ ...t }) }));
  },
};

const mockAgentUsageModel = {
  create: async (data: any) => {
    const records = Array.isArray(data) ? data : [data];
    for (const r of records) {
      usageRecords.push({
        ...r,
        createdAt: new Date(),
      });
    }
    return records;
  },
  aggregate: async (pipeline: any[]) => {
    // Simple aggregation support for budget checks
    const matchStage = pipeline.find((p: any) => p.$match);
    const groupStage = pipeline.find((p: any) => p.$group);
    
    let filtered = usageRecords;
    if (matchStage) {
      if (matchStage.$match.userId) {
        filtered = filtered.filter(u => u.userId === matchStage.$match.userId);
      }
      if (matchStage.$match.createdAt?.$gte) {
        filtered = filtered.filter(u => u.createdAt >= matchStage.$match.createdAt.$gte);
      }
    }
    
    if (groupStage && groupStage.$group._id === null) {
      const total = filtered.reduce((sum, u) => sum + u.totalTokens, 0);
      return [{ _id: null, total }];
    }
    
    return [];
  },
};

const mockUserModel = {
  findOne: async (query: any) => {
    for (const user of users.values()) {
      if (query.email && user.email === query.email) return user;
      if (query._id && user._id === query._id) return user;
    }
    return null;
  },
  create: async (data: any) => {
    const user: InMemoryUser = {
      _id: data._id || `user_${Date.now()}`,
      username: data.username,
      email: data.email,
      password: data.password,
      preferences: data.preferences || {},
    };
    users.set(user._id, user);
    return user;
  },
  findById: async (id: string) => {
    return users.get(id) || null;
  },
};

// ─── Patch modules at runtime ────────────────────────────────────────────

// We'll use a global to store the mock state
declare global {
  var __MOCK_MODE__: boolean;
  var __MOCK_USERS__: Map<string, InMemoryUser>;
  var __MOCK_TICKETS__: Map<string, InMemoryTicket>;
  var __MOCK_USAGE__: InMemoryUsage[];
}

globalThis.__MOCK_MODE__ = true;
globalThis.__MOCK_USERS__ = users;
globalThis.__MOCK_TICKETS__ = tickets;
globalThis.__MOCK_USAGE__ = usageRecords;

// ─── Mock LLM implementation ────────────────────────────────────────────

async function mockRetryLLM(
  messages: LLMMessage[],
  options: LLMOptions = {},
  retry: any = {}
): Promise<LLMResult> {
  // Determine which mock to use based on the system prompt / message content
  const systemPrompt = messages.find(m => m.role === "system")?.content || "";
  const key = systemPrompt.includes("DRAFTER") ? "drafter" :
              systemPrompt.includes("PLANNER") ? "planner" :
              systemPrompt.includes("EVALUATOR") ? "evaluator" :
              systemPrompt.includes("COMMUNICATOR") ? "communicator" : "default";
  
  const response = getMockLLMResponse(key);
  if (!response) {
    // Default fallback
    return {
      role: "assistant",
      content: JSON.stringify({
        thoughtProcess: "Mock response",
        isComplete: true,
        shouldRetry: false,
        feedback: "Mock evaluation complete",
      }),
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, model: "mock" },
    };
  }
  
  return {
    role: "assistant",
    content: response.content,
    tool_calls: response.tool_calls,
    usage: response.usage || { promptTokens: 100, completionTokens: 50, totalTokens: 150, model: "mock" },
  };
}

// ─── Test harness ────────────────────────────────────────────────────────

import { __testRetryLLMOverride } from "@/lib/llmClient";

interface GoldenPrompt {
  prompt: string;
  expectedSkills: string[];
  expectedTools: string[];
  maxIterations: number;
  category: string;
}

function parseGoldenPrompts(content: string): GoldenPrompt[] {
  return content.trim().split("\n").map(line => JSON.parse(line));
}

async function setupMockUser(): Promise<string> {
  const userId = "507f1f77bcf86cd799439011"; // Valid MongoDB ObjectId
  users.set(userId, {
    _id: userId,
    username: "evaluser",
    email: "eval@test.local",
    password: "test123",
    preferences: {},
  });
  return userId;
}

function checkToolsUsed(actionPlan: AgentAction[], expectedTools: string[]): boolean {
  const usedTools = actionPlan.map(a => a.tool).filter(Boolean);
  return expectedTools.every(t => usedTools.includes(t));
}

async function runGoldenPrompt(userId: string, prompt: GoldenPrompt): Promise<{
  passed: boolean;
  details: string;
  state: AgentState | null;
  latencyMs: number;
  tokensUsed: number;
  iterations: number;
}> {
  const startTime = Date.now();
  let latencyMs = 0;
  
  try {
    // Clear any previous mock responses for this run
    mockLLMResponseIndex.clear();
    
    // Setup default mock responses for each persona
    // These can be overridden per-test if needed
    setMockLLMResponse("drafter", [
      { content: JSON.stringify({ stage: "STAGE_1", title: "Test", isVague: false, isQuestion: false, isComplete: false, requirements: {} }) },
    ]);
    setMockLLMResponse("planner", [
      { content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "run_database_query", arguments: JSON.stringify({ collection: "Form", operation: "find", query: {} }) } }] },
    ]);
    setMockLLMResponse("evaluator", [
      { content: JSON.stringify({ thoughtProcess: "OK", isComplete: true, shouldRetry: false, feedback: "OK" }) },
    ]);
    setMockLLMResponse("communicator", [
      { content: "Task completed." },
    ]);
    
// R7: Set the test override for retryLLM
const { __testRetryLLMOverride } = await import("../../../src/lib/llmClient.js");

const originalOverride = (await import("../../../src/lib/llmClient.js")).__testRetryLLMOverride?.current;
if (__testRetryLLMOverride) {
  __testRetryLLMOverride.current = mockRetryLLM;
}
    
    let state: AgentState | null = null;
    try {
      state = await runAgentLoop(userId, prompt.prompt, false, undefined, undefined, () => {});
} finally {
      // Restore original override
      if (__testRetryLLMOverride && originalOverride !== undefined) {
        __testRetryLLMOverride.current = originalOverride;
      } else if (__testRetryLLMOverride && originalOverride === undefined) {
        __testRetryLLMOverride.current = undefined;
      }
    }
    const latencyMs = Date.now() - startTime;
    const usedTools = state!.actionPlan.map((a: any) => a.tool).filter(Boolean);
    const toolsMatch = checkToolsUsed(state.actionPlan, prompt.expectedTools);
    const iterationsOk = state.iterationCount <= prompt.maxIterations;
    const completed = state.isComplete === true;
    const noError = state.ticket.status !== "LLM_ERROR" && state.ticket.status !== "REJECTED";
    const tokensUsed = state.tokenUsage?.total || 0;
    
    const passed = toolsMatch && iterationsOk && completed && noError;
    
    // R6.3: Per-call assertions
    const assertionFailures: string[] = [];
    
    // 1. Params correctness: each action should have required params for its tool
    for (const action of state.actionPlan) {
      if (action.tool === "create_form") {
        if (!action.params?.name || !action.params?.elements) {
          assertionFailures.push(`create_form missing required params: ${JSON.stringify(action.params)}`);
        }
        if (action.params?.elements && !Array.isArray(action.params.elements)) {
          assertionFailures.push(`create_form elements must be array`);
        }
      }
      if (action.tool === "update_form") {
        if (!action.params?.formId) {
          assertionFailures.push(`update_form missing formId`);
        }
        if (!action.params?.updates || Object.keys(action.params.updates).length === 0) {
          assertionFailures.push(`update_form missing updates`);
        }
      }
      if (action.tool === "delete_form") {
        if (!action.params?.formId) {
          assertionFailures.push(`delete_form missing formId`);
        }
      }
      if (action.tool === "run_database_query") {
        if (!action.params?.collection || !action.params?.operation || !action.params?.query) {
          assertionFailures.push(`run_database_query missing required params`);
        }
      }
    }
    
    // 2. Sandbox shape validation: if there are mutations, sandbox should have updates/deletes
    const hasMutations = state.actionPlan.some(a => ["create_form", "update_form", "delete_form"].includes(a.tool));
    if (hasMutations) {
      if (!state.sandbox || typeof state.sandbox !== "object") {
        assertionFailures.push("Sandbox missing for mutating operations");
      } else {
        if (!Array.isArray(state.sandbox.updates)) {
          assertionFailures.push("Sandbox missing updates array");
        }
        if (!Array.isArray(state.sandbox.deletes)) {
          assertionFailures.push("Sandbox missing deletes array");
        }
      }
    }
    
    // 3. Reply semantics: no leaked PII in communicator reply
    if (state.reply && typeof state.reply === "string") {
      const piiPatterns = [
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // email
        /\b\d{3}-\d{2}-\d{4}\b/, // SSN
        /\b(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/, // phone
      ];
      for (const pattern of piiPatterns) {
        if (pattern.test(state.reply)) {
          assertionFailures.push(`PII leaked in reply: ${pattern}`);
        }
      }
    }
    
    // 4. Evaluator retry routing: if retries occurred, they must route to EXECUTOR_SANDBOX, never PLANNER
    const tracePersonas = state.executionTrace?.map((t: any) => t.persona) || [];
    for (let i = 1; i < tracePersonas.length; i++) {
      const prev = tracePersonas[i - 1];
      const curr = tracePersonas[i];
      if (prev === "EVALUATOR" && curr === "PLANNER") {
        assertionFailures.push("REGRESSION: Evaluator routed retry to PLANNER instead of EXECUTOR_SANDBOX");
      }
    }
    
    const allPassed = passed && assertionFailures.length === 0;
    
    let details = `Tools: [${usedTools.join(", ")}] (expected: [${prompt.expectedTools.join(", ")}]) | `;
    details += `Iterations: ${state.iterationCount}/${prompt.maxIterations} | `;
    details += `Complete: ${completed} | Status: ${state.ticket.status} | Tokens: ${tokensUsed} | Latency: ${latencyMs}ms`;
    
    if (!toolsMatch) details += ` | TOOLS MISMATCH`;
    if (!iterationsOk) details += ` | ITERATIONS EXCEEDED`;
    if (!completed) details += ` | NOT COMPLETE`;
    if (!noError) details += ` | ERROR: ${state.ticket.status}`;
    if (assertionFailures.length > 0) {
      details += ` | ASSERTIONS FAILED: ${assertionFailures.join("; ")}`;
    }
    
    return { passed: allPassed, details, state, latencyMs, tokensUsed, iterations: state.iterationCount };
  } catch (error: any) {
    return { 
      passed: false, 
      details: `THREW: ${error.message}`, 
      state: null,
      latencyMs: Date.now() - startTime,
      tokensUsed: 0,
      iterations: 0,
    };
  }
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  const fs = await import("fs");
  const path = await import("path");
  const promptsPath = path.join(process.cwd(), "tests/agent/eval/golden-prompts.jsonl");
  const content = fs.readFileSync(promptsPath, "utf-8");
  const prompts = parseGoldenPrompts(content);
  
  // Setup mock user
  const userId = await setupMockUser();
  
  console.log(`Running ${prompts.length} golden prompts for mock user ${userId}...\n`);
  
  let passed = 0;
  let failed = 0;
  const results: Array<{ 
    prompt: string; 
    passed: boolean; 
    details: string;
    latencyMs: number;
    tokensUsed: number;
    iterations: number;
  }> = [];
  
  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    process.stdout.write(`[${i + 1}/${prompts.length}] ${prompt.category}: "${prompt.prompt.substring(0, 50)}..." `);
    
    const result = await runGoldenPrompt(userId, prompt);
    
    if (result.passed) {
      console.log("✅ PASS");
      passed++;
    } else {
      console.log("❌ FAIL");
      console.log(`   ${result.details}`);
      failed++;
    }
    
    results.push({
      prompt: prompt.prompt,
      passed: result.passed,
      details: result.details,
      latencyMs: result.latencyMs,
      tokensUsed: result.tokensUsed,
      iterations: result.iterations,
    });
  }
  
  console.log(`\n📊 Results: ${passed}/${prompts.length} passed, ${failed} failed`);
  
  // Metrics summary
  const totalLatency = results.reduce((sum, r) => sum + r.latencyMs, 0);
  const totalTokens = results.reduce((sum, r) => sum + r.tokensUsed, 0);
  const avgLatency = totalLatency / results.length;
  const avgTokens = totalTokens / results.length;
  
  console.log(`\n📈 Metrics:`);
  console.log(`   Avg latency: ${avgLatency.toFixed(0)}ms`);
  console.log(`   Avg tokens: ${avgTokens.toFixed(0)}`);
  console.log(`   Total latency: ${totalLatency}ms`);
  console.log(`   Total tokens: ${totalTokens}`);
  
  // Persist report
  const reportPath = path.join(process.cwd(), "tests/agent/eval/reports");
  if (!fs.existsSync(reportPath)) {
    fs.mkdirSync(reportPath, { recursive: true });
  }
  const reportFile = path.join(reportPath, `stub-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(reportFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: { passed, failed, total: prompts.length },
    metrics: { avgLatency, avgTokens, totalLatency, totalTokens },
    results,
  }, null, 2));
  console.log(`\n📄 Report saved to: ${reportFile}`);
  
  if (failed > 0) {
    console.log("\n❌ Failures:");
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - "${r.prompt.substring(0, 60)}..."`);
      console.log(`    ${r.details}`);
    });
    process.exit(1);
  } else {
    console.log("\n✅ All golden prompts passed!");
    process.exit(0);
  }
}

main().catch(err => {
  console.error("Evaluation failed:", err);
  process.exit(1);
});