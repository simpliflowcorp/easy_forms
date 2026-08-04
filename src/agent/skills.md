# Agent Skills Registry

> **DEPRECATED — Stage 3**
> Built-in skills live in `src/agent/skills/registry.json`.
> User-authored skills are managed via `AgentSkillModel` (Agent C) and the Skill Author persona.
> This file is a human-readable soft reference ONLY.

## 1. build_form
- **Registry**: `registry.json` → `skillId: "build_form"`
- **Tools**: `create_form`
- **Permission**: `form_management`

## 2. edit_form
- **Registry**: `registry.json` → `skillId: "edit_form"`
- **Tools**: `update_form`, `add_form_element`, `update_form_element`, `remove_form_element`, `reorder_form_elements`, `set_form_status`, `update_form_metadata_settings`
- **Permission**: `form_management`

## 3. delete_form_skill
- **Registry**: `registry.json` → `skillId: "delete_form_skill"`
- **Tools**: `delete_form`
- **Permission**: `destructive_actions`

## 4. filter_responses
- **Registry**: `registry.json` → `skillId: "filter_responses"`
- **Tools**: `query_responses`
- **Permission**: `data_analytics`

## 5. generate_analytics_skill
- **Registry**: `registry.json` → `skillId: "generate_analytics_skill"`
- **Tools**: `generate_analytics`, `dashboard_stats`
- **Permission**: `data_analytics`

## 6. manage_custom_views
- **Registry**: `registry.json` → `skillId: "manage_custom_views"`
- **Tools**: `create_custom_view`, `get_custom_views`, `update_custom_view`, `delete_custom_view`
- **Permission**: `data_analytics`

## User-Defined Skills
Stored in `AgentSkillModel` (Agent C), gated by `skill_authoring` scope.
Merge via `MergeableKind = "skill_create" | "skill_update" | "skill_soft_delete"`.
