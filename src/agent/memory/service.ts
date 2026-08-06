import { connectDB } from "@/dbConfig/dbConfig";
import { redactPII } from "@/agent/helper/redact";
import AgentMemoryModel from "@/models/AgentMemoryModel";
import AgentSkillUsageModel from "@/models/AgentSkillUsageModel";
import AgentFailureModel from "@/models/AgentFailureModel";
import { summarize as summarizeTicket } from "@/agent/memory/compaction";
import { assembleContext as assembleUserContext } from "@/agent/memory/context";
import type {
  AgentMemory,
  AgentFailure,
  AgentSkillUsage,
  MemoryScope,
  AgentContext,
  MemoryService,
} from "./types";

export class MemoryServiceImpl implements MemoryService {
  async getMemory(
    userId: string,
    key?: string
  ): Promise<AgentMemory | AgentMemory[]> {
    await connectDB();
    if (key) {
      const doc = await AgentMemoryModel.findOne({ userId, key });
      if (!doc) return null as any;
      return {
        userId: doc.userId,
        key: doc.key,
        value: doc.value,
        confidence: doc.confidence,
        lastUsedAt: doc.lastUsedAt,
      };
    }

    const docs = await AgentMemoryModel.find({ userId });
    return docs.map((doc) => ({
      userId: doc.userId,
      key: doc.key,
      value: doc.value,
      confidence: doc.confidence,
      lastUsedAt: doc.lastUsedAt,
    }));
  }

  async setMemory(
    userId: string,
    key: string,
    value: unknown,
    opts?: { confidence?: number }
  ): Promise<void> {
    await connectDB();
    const redactedValue = redactPII(value);

    const existing = await AgentMemoryModel.findOne({ userId, key });
    if (existing) {
      const newConfidence =
        opts?.confidence !== undefined
          ? Math.min(0.9, opts.confidence)
          : Math.min(0.9, (existing.confidence ?? 0.5) + 0.1);

      existing.value = redactedValue;
      existing.confidence = newConfidence;
      existing.lastUsedAt = new Date();
      await existing.save();
    } else {
      const initConfidence = Math.min(0.9, opts?.confidence ?? 0.5);
      await AgentMemoryModel.create({
        userId,
        key,
        value: redactedValue,
        confidence: initConfidence,
        lastUsedAt: new Date(),
      });
    }
  }

  async recordSkillUse(
    userId: string,
    skill: string,
    ok: boolean,
    iterations: number
  ): Promise<void> {
    await connectDB();
    const existing = await AgentSkillUsageModel.findOne({ userId, skill });
    if (existing) {
      const newCount = existing.count + 1;
      const newSuccessRate =
        (existing.successRate * existing.count + (ok ? 1 : 0)) / newCount;
      const newAvgIterations =
        (existing.avgIterations * existing.count + iterations) / newCount;

      existing.count = newCount;
      existing.successRate = newSuccessRate;
      existing.avgIterations = newAvgIterations;
      existing.lastUsedAt = new Date();
      await existing.save();
    } else {
      await AgentSkillUsageModel.create({
        userId,
        skill,
        count: 1,
        successRate: ok ? 1 : 0,
        avgIterations: iterations,
        lastUsedAt: new Date(),
      });
    }
  }

  async recordFailure(
    userId: string,
    promptHash: string,
    err: string
  ): Promise<void> {
    await connectDB();
    const redactedErr = typeof err === "string" ? redactPII(err) : redactPII(String(err));

    const existing = await AgentFailureModel.findOne({ userId, promptHash });
    if (existing) {
      existing.count += 1;
      existing.error = redactedErr;
      existing.lastAt = new Date();
      await existing.save();
    } else {
      await AgentFailureModel.create({
        userId,
        promptHash,
        error: redactedErr,
        count: 1,
        lastAt: new Date(),
      });
    }
  }

  async recentFailures(
    userId: string,
    sinceMs: number
  ): Promise<AgentFailure[]> {
    await connectDB();
    const sinceDate = new Date(Date.now() - sinceMs);
    const docs = await AgentFailureModel.find({
      userId,
      lastAt: { $gte: sinceDate },
    }).sort({ lastAt: -1 });

    return docs.map((doc) => ({
      userId: doc.userId,
      promptHash: doc.promptHash,
      lastError: doc.error,
      count: doc.count,
      lastAt: doc.lastAt,
    }));
  }

  async summarize(ticketId: string): Promise<string> {
    return summarizeTicket(ticketId);
  }

  async assembleContext(
    userId: string,
    scope: MemoryScope
  ): Promise<AgentContext> {
    return assembleUserContext(userId, scope);
  }
}

export const memoryService = new MemoryServiceImpl();
