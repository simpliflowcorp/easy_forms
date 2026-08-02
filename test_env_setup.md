# Testing Environment Plan for Easy Forms Agent

This document outlines a plan to set up a comprehensive testing environment for the Easy Forms Agent subsystem. It includes unit, integration, and end-to-end test strategies, along with sample test cases to verify agent functionality.

## 1. Testing Goals

- Ensure each agent persona (Drafter, Planner, Executor, Evaluator, Communicator) behaves correctly in isolation.
- Verify that tools are invoked with correct parameters and that sandbox isolation is respected.
- Validate that the agent loop transitions between personas correctly and respects iteration limits.
- Confirm that skills map to the correct tools and that permissions are enforced.
- Ensure that the merge process (sandbox → production) works correctly and requires explicit user approval.
- Guard against regressions in the agent loop (especially the Evaluator → Executor sandbox routing invariant).

## 2. Test Environment Setup

### 2.1 Dependencies
- **MongoDB**: Use an in-memory MongoDB server (e.g., `mongodb-memory-server`) for unit and integration tests.
- **Redis**: Use a local Redis instance (or `redis-mock`) for sandbox and agent state caching.
- **LLM Mock**: Replace the LLM client with a mock that returns deterministic, pre‑programmed JSON responses for each persona.
- **Test Runner**: Use `ts-node` with `tsconfig-paths/register` (as already used in existing tests) or migrate to Vitest/Jest if preferred.

### 2.2 Environment Variables
Create a `.env.test` file (or use environment variables) to point to test databases:
```
MONGODB_URI=mongodb://localhost:27017/test_easyforms
REDIS_HOST=localhost
REDIS_PORT=6379
NVIDIA_API_KEY=test-key   # (will be overridden by mock)
```

### 2.3 Docker Compose (optional for local debugging)
```yaml
services:
  mongo:
    image: mongo:6
    ports: ["27017:27017"]
  redis:
    image: redis:alpine
    ports: ["6379:6379"]
```

### 2.4 npm Scripts (add to package.json)
```json
{
  "scripts": {
    "test:unit": "ts-node -r tsconfig-paths/register -r dotenv/config ./tests/agent/unit/**/*.test.ts",
    "test:integration": "ts-node -r tsconfig-paths/register -r dotenv/config ./tests/agent/integration/**/*.test.ts",
    "test:e2e": "ts-node -r tsconfig-paths/register -r dotenv/config ./tests/agent/e2e/**/*.test.ts",
    "test": "npm run test:unit && npm run test:integration && npm run test:e2e",
    "agent:eval": "ts-node -r dotenv/config tests/agent/eval/runner.ts"
  }
}
```

## 3. Test Suite Structure

```
tests/
└─ agent/
   ├─ unit/          # Isolated unit tests for personas, tools, helpers
   ├─ integration/   # Tests that combine multiple components (e.g., agent loop with mocked LLM and DB)
   ├─ e2e/           # End‑to‑end tests against real MongoDB/Redis (or testcontainers)
   └─ eval/          # Existing golden‑prompt evaluation suite
```

## 4. Sample Test Cases

### 4.1 Unit Tests

#### Drafter
- **Given** a user prompt “Create a contact form with name and email”, when the Drafter runs, then it should set `isQuestion: false`, `stage: STAGE_2`, and produce requirements that include a form name and two elements.
- **Given** a vague prompt “I want a form”, when the Drafter runs, then it should set `isQuestion: true` and ask for clarification.
- **Given** a follow‑up prompt “Yes, that’s the form I want” after a clarification, when the Drafter runs with `isFollowUpConfirmed: true`, then it should proceed to STAGE_2.

#### Planner
- **Given** requirements for creating a form with two fields, when the Planner runs, then it should produce an action plan with a single `create_form` tool call containing the correct name and elements.
- **Given** requirements for updating a form, when the Planner runs, then it should produce an action plan with an `update_form` tool call containing the correct `formId` and updates.

#### Executor (Sandbox)
- **Given** an action plan with a `create_form` tool call, when the Executor runs, then it should add the form definition to the sandbox `forms` map and not touch the production database.
- **Given** an action plan with a `run_database_query` tool call, when the Executor runs, then it should execute the query against the sandbox‑isolated collections (or a mock) and store the result in `sandbox.queryResults`.

#### Evaluator
- **Given** an action plan where all actions succeeded, when the Evaluator runs, then it should set `evaluatorFeedback` indicating success and `shouldRetry: false`.
- **Given** an action plan where one action failed with error “mongo error”, when the Evaluator runs and `iterationCount < maxIterations`, then it should route back to `EXECUTOR_SANDBOX` with `evaluatorFeedback` containing the error message.
- **Given** an LLM‑QA step that returns `{ shouldRetry: true, feedback: "missing field" }`, when the Evaluator runs, then it should route back to `EXECUTOR_SANDBOX` with `evaluatorFeedback` set to the feedback.

#### Communicator
- **Given** a completed action plan with no errors, when the Communicator runs, then it should produce a user‑friendly reply summarizing what was done (e.g., “I’ve created your contact form.”).
- **Given** an `LLM_ERROR` status, when the Communicator runs, then it should return a user‑friendly error message and not mark the ticket as resolved.

### 4.2 Integration Tests (Agent Loop with Mocked LLM)

We will mock the LLM client to return predefined sequences of JSON responses that drive the agent through each persona.

#### Test Case: Create a Simple Form
1. **Mock LLM Sequence**:
   - Drafter: Returns `{ stage: "STAGE_2", title: "Contact Form", isQuestion: false, requirements: { name: "Contact Form", elements: [...] } }`
   - Planner: Returns an action plan with one `create_form` call.
   - Executor: Returns success for `create_form`.
   - Evaluator: Returns `{ shouldRetry: false, isComplete: true, feedback: "Form created." }`
   - Communicator: Returns reply “Form created successfully.”
2. **Assertions**:
   - The ticket progresses through DRAFTER → PLANNER → EXECUTOR_SANDBOX → EVALUATOR → COMMUNICATOR → RESOLVED.
   - The sandbox contains the new form definition.
   - No production form is created (verify via direct DB query or mock).
   - The final reply matches the expected message.

#### Test Case: Update Form (Requires Human Approval)
1. **Mock LLM Sequence**:
   - Drafter: Identifies update request, sets stage STAGE_2.
   - Planner: Returns action plan with `update_form` (mutating tool).
   - Executor: Success in sandbox.
   - Evaluator: Detects muting plan → sets `activePersona: AWAITING_USER_APPROVAL`.
   - (Simulate user approval by setting `mergeApproved: true` and providing the same ticket ID.)
   - On second iteration (with `mergeApproved=true`): The loop goes directly to `MERGED_TO_PRODUCTION`.
2. **Assertions**:
   - After first iteration, ticket status is `AWAITING_USER_APPROVAL` and sandbox contains the update.
   - After approval, the merge function is called and the sandbox changes are applied to the production mock.
   - The final reply indicates successful merge.

#### Test Case: Evaluator → Executor Sandbox Routing Invariant
- Intentionally inject a transient error in the Executor (e.g., mock the database throw an error on first call, succeed on second).
- Verify that the Evaluator routes back to `EXECUTOR_SANDBOX` (not to `PLANNER`) and increments `iterationCount`.
- After two attempts, the action succeeds and the flow proceeds.

### 4.3 End‑to‑End Tests (Real DB, Real LLM or Recorded Responses)

- Use a test container for MongoDB and Redis.
- Optionally use a recorded VCR‑style cassette for LLM responses to keep tests deterministic and fast.
- Test a full workflow: user asks to create a form, agent creates it, user asks to add a field, agent updates, user asks to see responses (empty), user deletes the form (with confirmation).
- Verify that each step results in the expected database state.

## 5. Guardrails & Safety Tests

- **Form Response Immutability**: Attempt to call `update_form` or `delete_form` on the `Response` collection via the agent; verify that the agent refuses (tools only allow read operations on Response).
- **Sandbox Isolation**: After a failed merge attempt (simulated conflict), ensure that production data remains unchanged.
- **Permission Checks**: Try to invoke a tool without the required permission scope (e.g., call `delete_form` without `destructive_actions`); verify the agent aborts with a permission error.
- **Human Confirmation for Destructive Actions**: Ensure that the agent never proceeds to `MERGED_TO_PRODUCTION` for a delete action without explicit `mergeApproved: true`.

## 6. Reporting & Continuous Integration

- Add a test step in CI that runs `npm test` (unit + integration) on every push.
- Run the agent evaluation (`npm run agent:eval`) as part of CI to ensure golden‑prompt compatibility.
- Publish test coverage reports (aim for ≥80% on agent/* files).

## 7. Open Questions & Next Steps

- Decide on a mocking library (e.g., `ts-mockito`, `jest.mock`, or manual mocks) and adopt it consistently.
- Consider using `testcontainers` for spinning up real MongoDB/Redis in integration tests if in‑memory providers prove insufficient.
- Evaluate whether to migrate existing tests to a unified test runner (Vitest/Jest) for better watch mode and coverage.

---

By following this plan, we will have a robust test suite that gives confidence in the agent’s correctness, guards against regressions, and ensures safety invariants are never violated.

