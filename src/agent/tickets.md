# Ticket Classification & Stage Specification

## Ticket Classification Engine

Every prompt submitted to the Easy Forms AI Agent initializes an **Agent Ticket** classified into one of three stages based on intent:

---

## Stage 1: Read Requests, Lookups & Routing (`STAGE_1`)
- **Intent**: Fast read-only queries, status checks, analytics metrics, and navigation.
- **Example Prompts**:
  - *"How many responses does form X have?"*
  - *"What is the expiry date of Customer Survey?"*
- **Agent Behavior & UI Dispatch**:
  - Bypasses sidebar drawers and modals.
  - Processes instant database query.
  - Responds via a **Quick Toast Notification / Embedded Answer**.

---

## Stage 2: Create & Edit Requests (`STAGE_2`)
- **Intent**: Building new forms, updating schemas, editing element properties, and managing custom table views.
- **Example Prompts**:
  - *"Let's build a feedback form."*
  - *"Add a phone number field to Contact Us form."*
- **Agent Behavior & UI Dispatch**:
  - Initializes a `STAGE_2` Ticket.
  - Opens the **Slide-Over Sidebar Chat Drawer (`AgentSidebarDrawer.tsx`)**.
  - Runs the interactive persona loop (`Drafter` 🔍 ➔ `Planner` 📝 ➔ `Executor` ⚙️ ➔ `Evaluator` 🧪).
  - Displays requirement questions, field options, action checklists, and final DB merge controls inside the sidebar.

---

## Stage 3: Delete Requests & Destructive Operations (`STAGE_3`)
- **Intent**: Form deletion or custom view deletion.
- **Example Prompts**:
  - *"Delete the test form."*
  - *"Remove custom view High Ratings."*
- **Agent Behavior & UI Dispatch**:
  - Initializes a `STAGE_3` Ticket.
  - Opens the **Confirmation Modal (`AgentConfirmationModal.tsx`)**.
  - Offers **Backup Suggestions** (providing instant links to download CSV or JSON exports of form submissions before deletion).
  - Requires explicit user confirmation button click before executing destruction.
