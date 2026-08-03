# Easy Forms — Comprehensive Project Context

## 1. System Overview

**Easy Forms** is an enterprise-grade, full-stack form builder and submission management platform built on Next.js (App Router), React 19, TypeScript, and MongoDB/Redis. It enables users to dynamically design, configure, publish, share, and analyze interactive forms, as well as collect and export structured response data in multiple formats (CSV, JSON, PDF).

In addition to core form-building capabilities, Easy Forms features a multi-persona **AI Agent Subsystem** (`src/agent/`) capable of understanding natural language prompts to create forms, modify schemas, query responses with tenant isolation, compute aggregate analytics, and execute safe database operations via a sandbox-first workflow.

---

## 2. Technology Stack & Runtime Architecture

| Layer | Technology | Key Details |
| :--- | :--- | :--- |
| **Framework** | Next.js 16 (App Router) / React 19 | Server and Client Components, `(client)` route grouping, API routes in `src/app/api/` |
| **Language** | TypeScript 7 (Strict Mode) | `module: NodeNext`, `moduleResolution: NodeNext`, path alias `@/*` |
| **Database** | MongoDB / Mongoose | Primary authoritative document store for Users, Forms, Responses, Views, Tickets, and Audit Events |
| **Caching & In-Memory** | Redis (`ioredis` / `@vercel/kv`) | Used for Agent Lock (`agent_lock:{userId}`), Sandbox Store (`sandbox:{userId}:{ticketId}`), SSE session states, and Rate Limiting |
| **Authentication** | NextAuth.js v4 & Custom JWT | Credentials provider, Google OAuth, custom JWT cookie verification, email verification flows |
| **Real-time Engine** | WebSockets (`ws`) & SSE | WebSocket server (`src/lib/wsServer.ts`) for real-time form collaboration/updates; Server-Sent Events for agent streams and health checks |
| **Drag & Drop / UI** | `@dnd-kit/*`, `@xyflow/react` | Interactive drag-and-drop builder canvas, sortable element lists, flow diagrams |
| **Data Visualization** | `recharts` | Area, Bar, Line, Pie, and Radar charts for analytics views |
| **Data Export** | `@react-pdf/renderer`, `pdf-lib`, `pdfkit`, `@json2csv/node` | Multi-format response and form export engine |
| **Validation** | `zod` (v4) | Schema validation for API payloads and agent structured outputs |
| **State Management** | `zustand` | Client-side reactive stores (`src/store/store.ts`) for forms, user preferences, agent sidebar state |
| **Styling** | SCSS Modules & Vanilla CSS | Modular styling under `src/scss/` and component-level `*.module.scss` |
| **Background Processing** | `node-cron` / Custom Worker | Expiry checks for published forms and background maintenance |

---

## 3. Directory Structure & Key Subsystems

```plaintext
easy_forms/
├── .agents/                 # Workspace operational rules, design principles, hard invariants
│   ├── Agent.md             # System prompt & operating manual
│   ├── design.md            # Architecture & prompt-craft guardrails
│   └── rules.md             # Hard rules, command guides, and safety boundaries
├── .code-review-graph/      # AST dependency graph database (graph.db) for token-efficient traversal
├── docs/                    # Architectural specs, runbooks, canary deployment guides
│   ├── agent/               # In-depth agent memory, loop, LLMOps, and eval analysis
│   ├── CANARY_DEPLOYMENT.md
│   └── RUNBOOK.md
├── src/
│   ├── agent/               # Multi-persona autonomous AI agent engine
│   │   ├── helper/          # PII redact, JSON parser (safeJSON), validation, ID generators
│   │   ├── legacy/          # Llama-3 fallback parser (quarantined behind feature flag)
│   │   ├── personas/        # Drafter, Planner, Executor, Evaluator, Communicator
│   │   ├── policy/          # Permissions engine & skill/tool gating
│   │   ├── prompts/         # Versioned prompt loader and system prompt registry
│   │   ├── sandbox/         # Redis sandbox store, distributed locks, transactional merge engine
│   │   ├── agentLoop.ts     # Main orchestrator loop
│   │   ├── guardrails.md    # Strict safety invariants
│   │   ├── tools.ts         # OpenAI tool calling schema definitions
│   │   └── types.ts         # Canonical TypeScript interfaces for agent state
│   ├── app/                 # Next.js App Router
│   │   ├── (client)/        # Client-facing pages
│   │   │   ├── (mainpath)/  # Authenticated routes (dashboard, forms, edit, analytics, settings)
│   │   │   ├── (publicPath)/# Public unauthenticated routes (form submission portal)
│   │   │   └── auth/        # Signin, signup, verify email, password reset
│   │   ├── admin/           # Admin monitoring & agent telemetry dashboard
│   │   ├── api/             # REST & streaming endpoints (agent, auth, form, export, sse, ws)
│   │   └── layout.tsx       # Root layout with session, language, and theme wrappers
│   ├── components/          # Reusable UI component library
│   │   ├── ActionBar/       # Agent sidebar drawer, AI floating bar, confirmation modals
│   │   ├── builderWorkbench/# Form builder canvas, field properties, drag-and-drop elements
│   │   ├── dashboard/       # Charts, metrics counters, info cards
│   │   ├── Inputs/          # Dynamic form inputs (text, select, radio, date, color, etc.)
│   │   └── Loaders/         # Sci-fi and standard loading states
│   ├── dbConfig/            # Mongoose database connection configuration
│   ├── emailTemplates/      # Transactional HTML email templates
│   ├── helper/              # Utility libraries (mailer, error handlers, dates, deep clone)
│   ├── hooks/               # Custom React hooks (useWebSocket, useAgentWS, useClickAway)
│   ├── language/            # Internationalization (i18n) dictionaries
│   ├── lib/                 # Core utilities (llmClient, llmHealthMonitor, redis, wsServer, agentTools)
│   ├── models/              # Mongoose data models
│   ├── service/             # Business logic layer (notificationService, etc.)
│   └── store/               # Zustand global state stores
└── tests/                   # Test suites (eval golden prompts, load tests, unit stubs)
```

---

## 4. Core Data Models (`src/models/`)

1. **`User` (`src/models/userModel.ts`)**
   - Stores account credentials (bcrypt hashed), verification tokens, active sessions, profile metadata, and notification/theme preferences.
2. **`Form` (`src/models/formModel.ts`)**
   - Core form entity: `user` (owning ObjectId), `name`, `description`, `formId` (hashed public ID), `elements` array (dynamic form fields with types, labels, validations, options), `expiry`, `status` (active/inactive), `agentIdempotencyKey`, and `updatedAt`.
3. **`Response` (`src/models/responseModel.ts`)**
   - Stores submitted respondent data: `form_id` (ObjectId referencing Form), `data` (key-value response map), `submitted_at`, and respondent metadata. Form submission responses are **strictly read-only** to the AI agent.
4. **`CustomView` (`src/models/customViewModel.ts`)**
   - User-defined filtered/sorted tabular views for form response inspection: `formId`, `name`, `filters` array, `sortField`, `sortOrder`, `user`, and `agentIdempotencyKey`.
5. **`AgentTicket` (`src/models/agentTicketModel.ts`)**
   - Authoritative persistent state for AI agent interactions: `ticketId`, `userId`, `sessionId`, `prompt`, `status` (`OPEN`, `PROCESSING`, `AWAITING_USER_APPROVAL`, `RESOLVED`, `REJECTED`, `LLM_ERROR`), `stage`, `requirements`, `actionPlan`, `sandbox`, `trace`, `tokenUsage`, and `reply`.
6. **`AgentAuditEvent` (`src/models/agentAuditEventModel.ts`)**
   - Immutable audit log recording every sandbox production merge: `ticketId`, `userId`, `action` (`create_form`, `update_form`, `delete_form`, `create_view`), `resourceId`, `serverDiff`, `outcome` (`success`, `concurrency_miss`, `failed`).
7. **`AgentUsage` (`src/models/agentUsageModel.ts`)**
   - Per-turn LLM token tracking: `ticketId`, `userId`, `persona`, `model`, `promptTokens`, `completionTokens`, `totalTokens`, `costUsd`.
8. **`PendingMerge` (`src/models/PendingMerge.ts`)**
   - Fallback two-phase commit tracking entity for standalone MongoDB instances lacking replica-set transaction support.

---

## 5. Security Invariants & Isolation Directives

- **Tenant Isolation:** All database queries (both standard API routes and AI agent tool invocations) MUST filter strictly by the authenticated `userId`. In `src/lib/agentTools.ts`, any user-supplied `form_id` is intersected with the user's owned forms list (`resolveFormIdFilter`) to prevent cross-tenant enumeration.
- **Read-Only Submission Responses:** Under no circumstances are `Response` documents writable or mutable via the AI agent.
- **Optimistic Concurrency & Idempotency:** All agent merges verify `expectedUpdatedAt` and enforce unique sparse indices on `agentIdempotencyKey` to prevent double-merge races and overwrite collisions.
- **PII Redaction:** Sensitive user data keys (`email`, `phone`, `password`, `ssn`) are stripped via `redactPII` (`src/agent/helper/redact.ts`) before passing tool results or context into LLM prompts.

---

## 6. Build, Test, & Validation Workflow

- **Lint:** `npm run lint` (`next lint`)
- **Typecheck:** `npx tsc --noEmit`
- **Build:** `npm run build`
- **Agent Golden Prompt Evaluation:** `npm run agent:eval`
- **Dev Servers:** `npm run dev` (Next.js + Docker Redis), `npm run dev:ws` (Next.js + WebSocket Server)
