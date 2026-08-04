/**
 * Mermaid visualization for Orchestrator execution plans (A-S3.10).
 * 
 * Generates a `graph TD` block for the admin dashboard showing the
 * task DAG with dependencies, conditional edges, and parallel branches.
 */

import { ExecutionPlan, TaskNode, TaskEdge, ExecutorRole } from "../types";

/** Color scheme for different executor roles. */
const ROLE_COLORS: Record<ExecutorRole, string> = {
  executor_forms: "#3b82f6",      // blue
  executor_responses: "#10b981",  // emerald
  executor_views: "#f59e0b",      // amber
  executor_generic: "#8b5cf6",    // violet
};

/** Shape for different task statuses. */
const STATUS_SHAPES: Record<string, string> = {
  pending: "rect",
  running: "circle",
  completed: "rect,stroke-dasharray: 5 5",
  failed: "rect,stroke:#ef4444,color:#ef4444",
  skipped: "rect,stroke:#9ca3af",
};

/**
 * Generate a Mermaid diagram for an execution plan.
 * 
 * @param plan - The execution plan to visualize
 * @param taskStates - Optional current task states for status coloring
 * @returns Mermaid diagram as a string
 */
export function generateMermaid(
  plan: ExecutionPlan,
  taskStates?: Map<string, { status: string; result?: any }>
): string {
  const lines: string[] = [
    "graph TD",
    `    subgraph "${plan.goal}"`,
    `        direction TB`,
  ];

  // Add task nodes
  for (const task of plan.tasks) {
    const roleColor = ROLE_COLORS[task.role] || "#6b7280";
    const status = taskStates?.get(task.taskId)?.status || "pending";
    const shape = STATUS_SHAPES[status] || "rect";
    
    const label = `${task.tool}\\n${task.skill}\\n(${task.taskId.slice(0, 8)})`;
    const nodeId = sanitizeId(task.taskId);
    
    lines.push(`        ${nodeId}[["${label}"]]:::${task.role}`);
  }

  // Add edges
  for (const edge of plan.edges) {
    const fromId = sanitizeId(edge.from);
    const toId = sanitizeId(edge.to);
    
    let edgeStyle = "-->";
    let edgeLabel = "";
    
    switch (edge.type) {
      case "dependency":
        edgeStyle = "-->";
        break;
      case "conditional":
        edgeStyle = "-.->";
        edgeLabel = `|${edge.condition || "condition"}|`;
        break;
      case "loop":
        edgeStyle = "~~>";
        edgeLabel = "|loop|";
        break;
    }
    
    lines.push(`        ${fromId} ${edgeStyle}${edgeLabel} ${toId}`);
  }

  // Add checkpoints as special nodes
  if (plan.checkpoints && plan.checkpoints.length > 0) {
    lines.push(`        subgraph "Checkpoints"`);
    for (const cp of plan.checkpoints) {
      const cpId = `cp_${sanitizeId(cp.checkpointId)}`;
      lines.push(`        ${cpId}[("⟳ ${cp.checkpointId.slice(0, 8)}")]:::checkpoint`);
      if (cp.taskId) {
        lines.push(`        ${sanitizeId(cp.taskId)} --> ${cpId}`);
      }
    }
    lines.push(`        end`);
  }

  lines.push(`    end`);

  // Add classDefs for styling
  lines.push(``);
  lines.push(`    classDef executor_forms fill:#3b82f6,color:#fff,stroke:#1e40af;`);
  lines.push(`    classDef executor_responses fill:#10b981,color:#fff,stroke:#047857;`);
  lines.push(`    classDef executor_views fill:#f59e0b,color:#fff,stroke:#b45309;`);
  lines.push(`    classDef executor_generic fill:#8b5cf6,color:#fff,stroke:#5b21b6;`);
  lines.push(`    classDef checkpoint fill:#6b7280,color:#fff,stroke:#374151,stroke-dasharray: 5 5;`);
  
  // Status-based styling
  lines.push(`    classDef pending fill:#e5e7eb,color:#1f2937;`);
  lines.push(`    classDef running fill:#dbeafe,color:#1e40af,stroke:#3b82f6,stroke-width:2px;`);
  lines.push(`    classDef completed fill:#d1fae5,color:#065f46;`);
  lines.push(`    classDef failed fill:#fee2e2,color:#991b1b,stroke:#ef4444;`);
  lines.push(`    classDef skipped fill:#f3f4f6,color:#6b7280;`);

  return lines.join("\n");
}

/**
 * Generate a simplified Mermaid diagram for quick overview.
 */
export function generateMermaidSummary(plan: ExecutionPlan): string {
  const lines: string[] = [
    "graph LR",
    `    Start([Start]) --> ${sanitizeId(plan.tasks[0]?.taskId || "first")}`,
  ];

  // Group by role for parallel visualization
  const byRole = new Map<ExecutorRole, TaskNode[]>();
  for (const task of plan.tasks) {
    if (!byRole.has(task.role)) byRole.set(task.role, []);
    byRole.get(task.role)!.push(task);
  }

  let prevRoleNode = "Start";
  for (const [role, tasks] of byRole) {
    const roleNode = `role_${role}`;
    lines.push(`    ${prevRoleNode} --> ${roleNode}[["${role} (${tasks.length} tasks)"]]`);
    
    for (const task of tasks) {
      lines.push(`    ${roleNode} --> ${sanitizeId(task.taskId)}[["${task.tool}"]]`);
    }
    
    prevRoleNode = roleNode;
  }

  lines.push(`    ${prevRoleNode} --> End([End])`);

  // Styling
  lines.push(``);
  lines.push(`    classDef executor_forms fill:#3b82f6,color:#fff;`);
  lines.push(`    classDef executor_responses fill:#10b981,color:#fff;`);
  lines.push(`    classDef executor_views fill:#f59e0b,color:#fff;`);
  lines.push(`    classDef executor_generic fill:#8b5cf6,color:#fff;`);

  return lines.join("\n");
}

/**
 * Generate Mermaid for a specific execution trace (post-execution).
 * Shows actual execution order with timing.
 */
export function generateMermaidTrace(
  plan: ExecutionPlan,
  taskStates: Map<string, { status: string; startedAt?: number; completedAt?: number; result?: any }>
): string {
  const lines: string[] = [
    "graph TD",
    `    subgraph "Execution Trace: ${plan.goal}"`,
  ];

  // Sort tasks by start time
  const sortedTasks = [...plan.tasks].sort((a, b) => {
    const aStart = taskStates.get(a.taskId)?.startedAt || 0;
    const bStart = taskStates.get(b.taskId)?.startedAt || 0;
    return aStart - bStart;
  });

  for (const task of sortedTasks) {
    const state = taskStates.get(task.taskId);
    const nodeId = sanitizeId(task.taskId);
    const duration = state?.startedAt && state?.completedAt 
      ? state.completedAt - state.startedAt 
      : 0;
    const status = state?.status || "pending";
    
    const label = `${task.tool} (${duration}ms)`;
    lines.push(`        ${nodeId}[["${label}"]]:::${status}`);
  }

  // Add edges
  for (const edge of plan.edges) {
    const fromId = sanitizeId(edge.from);
    const toId = sanitizeId(edge.to);
    lines.push(`        ${fromId} --> ${toId}`);
  }

  lines.push(`    end`);
  lines.push(``);
  lines.push(`    classDef pending fill:#e5e7eb,color:#1f2937;`);
  lines.push(`    classDef running fill:#dbeafe,color:#1e40af,stroke:#3b82f6,stroke-width:2px;`);
  lines.push(`    classDef completed fill:#d1fae5,color:#065f46;`);
  lines.push(`    classDef failed fill:#fee2e2,color:#991b1b,stroke:#ef4444;`);
  lines.push(`    classDef skipped fill:#f3f4f6,color:#6b7280;`);

  return lines.join("\n");
}

/** Sanitize task IDs for Mermaid node IDs. */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Export all visualization functions. */
export const visualize = {
  generateMermaid,
  generateMermaidSummary,
  generateMermaidTrace,
};