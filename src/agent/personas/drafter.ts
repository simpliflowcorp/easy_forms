import { AgentState, AgentTicket } from "../types";
import permissionsConfig from "../permissions.json";
import { DRAFTER_SYSTEM_PROMPT } from "../prompts";
import { callLLM } from "@/lib/llmClient";

export async function runDrafter(state: AgentState): Promise<AgentState> {
  const { prompt, userId } = state;

  let llmAnalysis: any = null;
  let rawContent: string = "";
  try {
    const message = await callLLM([
      { role: "system", content: DRAFTER_SYSTEM_PROMPT },
      { role: "user", content: prompt }
    ], {
      response_format: { type: "json_object" }
    });
    
    rawContent = message?.content || "";
    console.log("LLM Raw Output:", rawContent);
    
    const match = rawContent.match(/\{[\s\S]*\}/);
    if (match) {
      llmAnalysis = JSON.parse(match[0]);
    }
  } catch (err: any) {
    console.warn("LLM Drafter call failed or timed out. Error:", err.message);
    rawContent = `Error: ${err.message}`;
  }

  // Fallback semantic parser if LLM is offline
  if (!llmAnalysis) {
    const lower = prompt.toLowerCase().trim();
    if (lower.startsWith("how many") || lower.startsWith("count") || lower.startsWith("list")) {
      llmAnalysis = {
        stage: "STAGE_1",
        skill: "read_query_skill",
        title: "Read Lookup Query",
        isVague: false,
      };
    } else if (lower.startsWith("delete")) {
      llmAnalysis = {
        stage: "STAGE_3",
        skill: "delete_form_skill",
        title: "Delete Action Request",
        isVague: false,
      };
    } else {
      llmAnalysis = {
        stage: "STAGE_2",
        skill: "build_form",
        title: "Form Action Request",
        isVague: !lower.includes("field") && !lower.includes("name") && !lower.includes("rating"),
        clarifyingQuestion: "What specific fields should we include in your form?",
      };
    }
  }

  // Update ticket stage based on Drafter LLM intent analysis
  const updatedTicket: AgentTicket = {
    ...state.ticket,
    stage: llmAnalysis.stage || "STAGE_1",
    title: llmAnalysis.title || "Agent Ticket",
  };
  state.ticket = updatedTicket;

  // Handle Unsupported skills or Greetings
  if (llmAnalysis.skill === "unsupported") {
    return {
      ...state,
      activePersona: "DRAFTER",
      isQuestion: true,
      reply: llmAnalysis.clarifyingQuestion || "Hello! How can I assist you with Easy Forms today?",
      llmRawOutput: rawContent,
    };
  }

  // Handle STAGE_1 Read Requests
  if (llmAnalysis.stage === "STAGE_1" || llmAnalysis.skill === "read_query_skill") {
    state.requirements = {
      ...state.requirements,
      skill: "read_query_skill",
    };
    return {
      ...state,
      activePersona: "PLANNER",
      drafterMessage: `Drafter Persona digested prompt intent as Read Query. Requirements ready for Planner.`,
      llmRawOutput: rawContent,
    };
  }

  // Check Permissions from permissions.json
  const perms = permissionsConfig.permissions;
  if (llmAnalysis.skill === "build_form" && !perms.form_management) {
    return {
      ...state,
      activePersona: "REJECTED",
      isQuestion: true,
      reply: "Permission Denied: 'form_management' is currently disabled in permissions.json.",
      llmRawOutput: rawContent,
    };
  }

  // If prompt is vague (e.g. user wants to build a form but provided no fields), ask clarifying question
  if (llmAnalysis.isVague) {
    return {
      ...state,
      activePersona: "DRAFTER",
      isQuestion: true,
      reply:
        llmAnalysis.clarifyingQuestion ||
        `I can help you build a form! To gather all required parameters per guidelines.md, please specify:\n1. Form Title\n2. What specific fields to include (e.g. Full Name, Email, Star Rating, Comments)\n3. Mandatory fields`,
      llmRawOutput: rawContent,
    };
  }

  // Store digested requirements
  state.requirements = {
    skill: llmAnalysis.skill,
    formTitle: llmAnalysis.requirements?.formTitle || prompt.substring(0, 30),
    formDescription: prompt,
    fields: llmAnalysis.requirements?.fields || [
      { label: "Full Name", type: 1, required: true },
      { label: "Email Address", type: 1, required: true },
    ],
  };

  return {
    ...state,
    activePersona: "PLANNER",
    drafterMessage: `Drafter Persona digested prompt intent. Requirements ready for Planner.`,
    llmRawOutput: rawContent,
  };
}
