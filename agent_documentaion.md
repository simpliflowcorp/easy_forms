# Easy Forms AI Agent System Documentation

## Overview
The Easy Forms project utilizes a sophisticated multi-persona AI Agent system to process user requests, build and modify forms, and query data. Instead of relying on a single large prompt, the system breaks down complex tasks into a sequential pipeline of specialized agents (personas). This architecture ensures high-quality execution, self-correction, and data safety.

## Architecture: The Multi-Persona Loop
The agent operates in a sequential state machine loop (managed in `src/agent/agentLoop.ts`). Each step in the loop is handled by a specialized persona:

1. **Drafter (`runDrafter`)**: 
   - **Role**: The entry point. Digests the user's prompt and analyzes the semantic intent without relying on fragile keyword matching.
   - **Responsibilities**: Classifies the request into stages (`STAGE_1` for read-only, `STAGE_2` for edits/creation, `STAGE_3` for destructive actions), validates requirements against `guidelines.md` and `skills.md`, and ensures permissions are respected. Asks clarifying questions if the prompt is vague.

2. **Planner (`runPlanner`)**:
   - **Role**: The strategist. Takes the validated requirements from the Drafter and compiles a step-by-step Action Plan.
   - **Responsibilities**: Maps user requirements to concrete tool calls (e.g., `create_form`, `update_form`, `run_database_query`). Flags destructive operations for human confirmation.

3. **Executor (`runExecutor`)**:
   - **Role**: The worker. Executes the planned tool steps.
   - **Responsibilities**: Interacts with the backend via `src/lib/agentTools.ts`. Crucially, it runs within an isolated **Sandbox Store** environment. It never mutates the production database directly during initial loop turns.

4. **Evaluator (`runEvaluator`)**:
   - **Role**: Quality Assurance. 
   - **Responsibilities**: Compares the sandbox outputs against the user's initial goals. If an action fails or the result is incomplete, the Evaluator can trigger a retry loop (up to a defined `maxIterations`, usually 3) with specific feedback for the Executor. 

5. **Communicator (`runCommunicator`)**:
   - **Role**: The spokesperson.
   - **Responsibilities**: Generates a final, user-friendly response summarizing what was accomplished (or what failed) to present back to the user.

## Core Features
*   **Sandbox Isolation**: All data modifications (creations, updates, deletions) occur in a localized sandbox. A final "Merge to Production" step (`MERGED_TO_PRODUCTION`) requires explicit user approval before touching the live MongoDB database.
*   **Tenant Isolation**: Security is baked into the tool execution layer (`agentTools.ts`). All operations enforce tenant isolation by strictly scoping queries and updates to the active `userId`.
*   **State Recovery**: The system caches execution state in Redis and uses MongoDB for backup. If the LLM provider crashes or the server goes offline, the agent can resume tickets exactly where they left off.

---

## Advantages

*   **Exceptional Safety**: The combination of the Sandbox environment and the requirement for explicit human approval on destructive actions makes the agent extremely safe to use in a production setting.
*   **High Output Quality**: The Evaluator persona acts as an automated QA engineer. It allows the system to catch and self-correct hallucinations or API errors before the user even sees the result.
*   **Specialization**: Splitting the logic into multiple personas allows for very focused, smaller system prompts. This reduces LLM confusion and improves adherence to complex instructions.
*   **Resiliency**: Built-in state management via Redis/MongoDB ensures that long-running multi-step operations aren't lost due to transient network or API failures.

## Disadvantages & Limitations

*   **High Latency and Cost**: A single user request requires at least 4 to 5 separate LLM API calls (one for each persona). This drastically increases response latency and token usage costs compared to a single-shot agent approach.
*   **Architectural Complexity**: Maintaining the state machine, managing sandbox state synchronization, and handling Redis/MongoDB hydration adds significant complexity to the codebase.
*   **Context Window Inflation**: As the loop iterates and the Evaluator sends feedback back to the Executor, the `executionTrace` grows. This can quickly eat up the LLM's context window and increase costs on longer tickets.
*   **Rigid Tool Boundaries**: The agent is currently limited to a hardcoded set of tools (`create_form`, `update_form`, `delete_form`, `run_database_query`). Extending its capabilities requires manual updates to multiple persona prompts and the underlying `agentTools.ts` file.
