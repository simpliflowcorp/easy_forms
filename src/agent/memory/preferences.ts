import mongoose from "mongoose";
import { connectDB } from "@/dbConfig/dbConfig";
import Form from "@/models/formModel";
import AgentTicket from "@/models/agentTicketModel";
import AgentMemoryModel from "@/models/AgentMemoryModel";
import type { UserPreferences } from "@/agent/types";

function getUserMatchCondition(userId: string): any {
  if (mongoose.Types.ObjectId.isValid(userId)) {
    const objId = new mongoose.Types.ObjectId(userId);
    return { $in: [objId, userId] };
  }
  return userId;
}

/**
 * Scans the last 50 successful traces/forms for a user to infer preferred field types and naming patterns using simple statistics.
 */
export async function inferPreferencesFromHistory(
  userId: string
): Promise<UserPreferences> {
  await connectDB();

  const userMatch = getUserMatchCondition(userId);
  const forms = await Form.find({ user: userMatch })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const fieldTypeCounts: Record<string, number> = {};
  const namingPatternSet = new Set<string>();

  for (const form of forms as any[]) {
    if (form.name) {
      // Extract prefix/naming patterns (e.g. "Weekly", "Feedback", "Survey")
      const words = form.name.trim().split(/\s+/);
      if (words.length > 0) {
        namingPatternSet.add(words[0]);
      }
    }

    if (Array.isArray(form.elements)) {
      for (const elem of form.elements) {
        const typeStr = String(elem.type ?? "text");
        fieldTypeCounts[typeStr] = (fieldTypeCounts[typeStr] || 0) + 1;
      }
    }
  }

  // Also check execution tickets
  const tickets = await AgentTicket.find({ userId, status: "RESOLVED" })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  for (const ticket of tickets as any[]) {
    if (ticket.prompt && typeof ticket.prompt === "string") {
      if (ticket.prompt.toLowerCase().includes("nps")) {
        namingPatternSet.add("NPS");
      }
      if (ticket.prompt.toLowerCase().includes("feedback")) {
        namingPatternSet.add("Feedback");
      }
    }
  }

  // Check saved preferences in AgentMemoryModel
  const prefMemories = await AgentMemoryModel.find({
    userId,
    key: { $regex: "^pref", $options: "i" },
  }).lean();

  const viewConfigs: Record<string, any> = {};
  for (const mem of prefMemories as any[]) {
    viewConfigs[mem.key] = mem.value;
  }

  const preferences: UserPreferences = {
    preferredFieldTypes: fieldTypeCounts,
    namingPatterns: Array.from(namingPatternSet),
    viewConfigs,
  };

  return preferences;
}
