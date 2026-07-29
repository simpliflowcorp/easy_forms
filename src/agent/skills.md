# Agent Skills Registry

This document lists all supported skills in Easy Forms, their description, mapped execution tools, and required permission scopes.

---

## 1. Skill: Form Building (`build_form`)
- **Description**: Create new form schemas with custom titles, descriptions, expiry dates, and form elements.
- **Required Tools**: `create_form`
- **Permission Scope**: `form_management`
- **Required Data**: `name` (string), `elements` (array of fields with `label` and `type`).

## 2. Skill: Form Editing (`edit_form`)
- **Description**: Add fields, modify element labels, update dropdown options, or change form titles.
- **Required Tools**: `update_form`, `read_form`
- **Permission Scope**: `form_management`
- **Required Data**: `formId` (string), `updates` (object).

## 3. Skill: Form Deletion (`delete_form_skill`)
- **Description**: Permanently remove a form and its schema.
- **Required Tools**: `delete_form`
- **Permission Scope**: `destructive_actions`
- **Required Data**: `formId` (string).
- **Security Rule**: Must require human confirmation modal before sandbox merge.

## 4. Skill: Response Data Filtering (`filter_responses`)
- **Description**: Query submission responses using column value filters (e.g. `contains`, `equals`, `gt`, `lt`).
- **Required Tools**: `query_responses`
- **Permission Scope**: `data_analytics`
- **Required Data**: `formId` (string), `filters` (array of `{ field, operator, value }`).

## 5. Skill: Response Analytics (`generate_analytics_skill`)
- **Description**: Calculate overall response counts, submission distributions, and field statistics.
- **Required Tools**: `generate_analytics`
- **Permission Scope**: `data_analytics`
- **Required Data**: `formId` (string).

## 6. Skill: Custom Table Views Management (`manage_custom_views`)
- **Description**: Create, read, update, or delete saved custom response table view filter presets.
- **Required Tools**: `create_custom_view`, `get_custom_views`, `update_custom_view`, `delete_custom_view`
- **Permission Scope**: `data_analytics`
- **Required Data**: `formId` (string), `name` (string).
