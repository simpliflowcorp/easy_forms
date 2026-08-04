import mongoose from "mongoose";
import { connectDB } from "@/dbConfig/dbConfig";
import Form from "@/models/formModel";
import AgentTicket from "@/models/agentTicketModel";
import type { SkillDefinition } from "@/agent/types";

function getUserMatchCondition(userId: string): any {
  if (mongoose.Types.ObjectId.isValid(userId)) {
    const objId = new mongoose.Types.ObjectId(userId);
    return { $in: [objId, userId] };
  }
  return userId;
}

/**
 * Scans recent forms and tickets for recurring user workflows.
 * If 3 or more similar patterns are detected (e.g. NPS + comments forms), returns a proposed SkillDefinition (e.g. `weekly_pulse`) for the Skill Author persona to approve.
 */
export async function proposeSkillFromPatterns(
  userId: string
): Promise<SkillDefinition | null> {
  await connectDB();

  const userMatch = getUserMatchCondition(userId);

  // Fetch recent forms created by user
  const forms = await Form.find({ user: userMatch })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  // Fetch recent tickets created by user
  const tickets = await AgentTicket.find({ userId })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  let npsFormCount = 0;
  let commentsFormCount = 0;

  for (const form of forms as any[]) {
    const nameLower = (form.name || "").toLowerCase();
    const descLower = (form.description || "").toLowerCase();
    if (nameLower.includes("nps") || descLower.includes("nps") || nameLower.includes("pulse")) {
      npsFormCount++;
    }
    if (nameLower.includes("comment") || descLower.includes("comment") || nameLower.includes("feedback")) {
      commentsFormCount++;
    }
  }

  for (const ticket of tickets as any[]) {
    const promptLower = (ticket.prompt || "").toLowerCase();
    if (promptLower.includes("nps") || promptLower.includes("pulse")) {
      npsFormCount++;
    }
    if (promptLower.includes("comment") || promptLower.includes("feedback")) {
      commentsFormCount++;
    }
  }

  // Pattern detection: If user has created 3+ NPS/pulse/comment forms, propose `weekly_pulse`
  if (npsFormCount >= 3 || (npsFormCount >= 2 && commentsFormCount >= 1) || commentsFormCount >= 3) {
    const proposal: SkillDefinition = {
      skillId: "skill_weekly_pulse",
      name: "weekly_pulse",
      version: "1.0.0",
      permissionScope: "form_creation",
      tools: [
        { tool: "create_form", paramsFrom: "requirements" },
        { tool: "publish_form", paramsFrom: "context" },
      ],
      maxIterations: 3,
      negativeTests: [
        {
          assert: "no_pii_leak",
          description: "Form elements must not log raw PII details",
        },
      ],
      dryRunShape: {
        formName: "Weekly NPS Pulse",
        elementCount: 2,
      },
      requiredParams: ["title"],
      optionalParams: ["frequency", "description"],
    };
    return proposal;
  }

  return null;
}
