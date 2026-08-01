import { z } from "zod";

export const DrafterOutputSchema = z.object({
  stage: z.enum(["STAGE_1", "STAGE_2", "STAGE_3"]),
  skill: z.enum([
    "build_form",
    "edit_form",
    "read_query_skill",
    "delete_form_skill",
    "unsupported",
    "run_database_query",
    "filter_responses",
    "generate_analytics_skill",
    "manage_custom_views",
    "product_guide",
    "general_chat",
  ]),
  title: z.string().optional(),
  isVague: z.boolean().optional().default(false),
  clarifyingQuestion: z.string().optional(),
  requirements: z
    .object({
      formTitle: z.string().optional(),
      fields: z
        .array(
          z.object({
            label: z.string(),
            type: z.union([
              z.literal(1),
              z.literal(2),
              z.literal(3),
              z.literal(4),
              z.literal(5),
            ]),
            required: z.boolean(),
            options: z.array(z.string()).optional(),
          })
        )
        .optional(),
    })
    .optional(),
  isFollowUp: z.boolean().optional().default(false),
  isFollowUpConfirmed: z.boolean().optional().default(false),
  followUpTicketId: z.string().optional(),
  isCancellation: z.boolean().optional().default(false),
  isTopicChange: z.boolean().optional().default(false),
  guideResponse: z.string().optional(),
  llmRawOutput: z.string().optional(),
});

export const EvaluatorOutputSchema = z.object({
  thoughtProcess: z.string().optional(),
  isComplete: z.boolean().optional(),
  shouldRetry: z.boolean().optional(),
  feedback: z.string().optional(),
});

export type DrafterOutput = z.infer<typeof DrafterOutputSchema>;
export type EvaluatorOutput = z.infer<typeof EvaluatorOutputSchema>;

export function parsePersona<T>(raw: string | undefined | null, schema: z.ZodSchema<T>): T | null {
  if (!raw || typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Fast path 1: whole string is valid JSON.
  try {
    const parsed = JSON.parse(trimmed);
    return schema.parse(parsed) as T;
  } catch {
    // Not valid JSON or validation failed - fall through to balanced extraction
  }

  // Fast path 2: try to locate a ```json ... ``` fenced block.
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) {
    try {
      const parsed = JSON.parse(fence[1].trim());
      return schema.parse(parsed) as T;
    } catch {
      // fall through
    }
  }

  // Balanced extraction: walk the string, track brace depth, skip strings.
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          const candidate = trimmed.slice(start, i + 1);
          try {
            const parsed = JSON.parse(candidate);
            return schema.parse(parsed) as T;
          } catch {
            // Not valid JSON or validation failed — keep scanning.
            start = -1;
          }
        }
      }
    }
  }
  return null;
}