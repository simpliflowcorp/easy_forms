import { connectDB } from "@/dbConfig/dbConfig";
import AgentMemoryModel from "@/models/AgentMemoryModel";
import AgentTicket from "@/models/agentTicketModel";
import AgentSkillModel from "@/models/AgentSkillModel";
import AgentSkillUsageModel from "@/models/AgentSkillUsageModel";
import AgentFailureModel from "@/models/AgentFailureModel";
import { applyLRUCap } from "./compaction";
import type { AgentMemory, AgentContext, MemoryScope } from "./types";

export async function assembleContext(
  userId: string,
  scope: MemoryScope
): Promise<AgentContext> {
  await connectDB();

  // 1. Pull User Preferences / Memories based on scope.read
  let memoryDocs;
  if (scope?.read && scope.read.length > 0 && !scope.read.includes("*")) {
    memoryDocs = await AgentMemoryModel.find({
      userId,
      key: { $in: scope.read },
    });
  } else {
    memoryDocs = await AgentMemoryModel.find({ userId });
  }

  const preferences: AgentMemory[] = memoryDocs.map((doc) => ({
    userId: doc.userId,
    key: doc.key,
    value: doc.value,
    confidence: doc.confidence,
    lastUsedAt: doc.lastUsedAt,
  }));

  // 2. Pull Recent Execution Traces from tickets (capped at 8 via LRU)
  const recentTickets = await AgentTicket.find({ userId })
    .sort({ updatedAt: -1 })
    .limit(8);

  const rawTraces = recentTickets.map((t) => ({
    ticketId: t.ticketId,
    prompt: t.prompt,
    stage: t.stage,
    status: t.status,
    updatedAt: (t as any).updatedAt || new Date(),
    executionTrace: t.executionTrace,
  }));

  const recentTraces = applyLRUCap(rawTraces, 8);

  // 3. Pull Relevant Skills
  let skillFilter: Record<string, any> = { userId };
  if (scope?.query) {
    skillFilter.name = { $regex: scope.query, $options: "i" };
  }

  const skillsDocs = await AgentSkillModel.find(skillFilter).limit(8);
  const skillUsages = await AgentSkillUsageModel.find({ userId })
    .sort({ count: -1 })
    .limit(8);

  const relevantSkills = [
    ...skillsDocs.map((s) => ({
      name: s.name,
      version: s.version,
      definition: s.definition,
    })),
    ...skillUsages.map((u) => ({
      skill: u.skill,
      count: u.count,
      successRate: u.successRate,
    })),
  ];

  // 4. Pull Procedural Memory / Recent Failures
  const failures = await AgentFailureModel.find({ userId })
    .sort({ lastAt: -1 })
    .limit(8);

  const procedural = failures.map((f) => ({
    promptHash: f.promptHash,
    error: f.error,
    count: f.count,
    lastAt: f.lastAt,
  }));

  return {
    preferences,
    recentTraces,
    relevantSkills,
    procedural,
  };
}
