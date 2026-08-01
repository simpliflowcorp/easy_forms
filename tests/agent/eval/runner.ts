import { runAgentLoop } from "@/agent/agentLoop";
import { connectDB } from "@/dbConfig/dbConfig";
import User from "@/models/userModel";

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

function checkToolsUsed(actionPlan: any[], expectedTools: string[]): boolean {
  const usedTools = actionPlan.map(a => a.tool).filter(Boolean);
  return expectedTools.every(t => usedTools.includes(t));
}

async function runGoldenPrompt(userId: string, prompt: GoldenPrompt): Promise<{
  passed: boolean;
  details: string;
  state: any;
}> {
  try {
    const state = await runAgentLoop(userId, prompt.prompt, false, undefined, undefined, () => {});
    
    const usedTools = state.actionPlan.map((a: any) => a.tool).filter(Boolean);
    const toolsMatch = checkToolsUsed(state.actionPlan, prompt.expectedTools);
    const iterationsOk = state.iterationCount <= prompt.maxIterations;
    const completed = state.isComplete === true;
    const noError = state.ticket.status !== "LLM_ERROR" && state.ticket.status !== "REJECTED";
    
    const passed = toolsMatch && iterationsOk && completed && noError;
    
    let details = `Tools: [${usedTools.join(", ")}] (expected: [${prompt.expectedTools.join(", ")}]) | `;
    details += `Iterations: ${state.iterationCount}/${prompt.maxIterations} | `;
    details += `Complete: ${completed} | Status: ${state.ticket.status}`;
    
    if (!toolsMatch) details += ` | TOOLS MISMATCH`;
    if (!iterationsOk) details += ` | ITERATIONS EXCEEDED`;
    if (!completed) details += ` | NOT COMPLETE`;
    if (!noError) details += ` | ERROR: ${state.ticket.status}`;
    
    return { passed, details, state };
  } catch (error: any) {
    return { 
      passed: false, 
      details: `THREW: ${error.message}`, 
      state: null 
    };
  }
}

async function main() {
  console.log("🧪 Starting Agent Evaluation...\n");
  
  await connectDB();
  
  const fs = await import("fs");
  const path = await import("path");
  const promptsPath = path.join(process.cwd(), "tests/agent/eval/golden-prompts.jsonl");
  const content = fs.readFileSync(promptsPath, "utf-8");
  const prompts = parseGoldenPrompts(content);
  
  // Find or create a test user
  let testUser = await User.findOne({ email: "eval@test.local" }).lean();
  if (!testUser) {
    testUser = await User.create({
      username: "evaluser",
      email: "eval@test.local",
      password: "test123",
    });
  }
  const userId = testUser._id.toString();
  
  console.log(`Running ${prompts.length} golden prompts for user ${userId}...\n`);
  
  let passed = 0;
  let failed = 0;
  const results: Array<{ prompt: string; passed: boolean; details: string }> = [];
  
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
    });
  }
  
  console.log(`\n📊 Results: ${passed}/${prompts.length} passed, ${failed} failed`);
  
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