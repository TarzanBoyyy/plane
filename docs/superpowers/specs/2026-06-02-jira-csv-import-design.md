---
name: jira-csv-import
description: Design for importing Plane-format CSV back into Plane as issues
metadata:
  type: project
---

# Jira CSV Import — Design Spec

**Date:** 2026-06-02
**Status:** Approved

## Problem

The Plane open-source codebase has an export feature (`ExportIssuesEndpoint`) that exports issues to CSV/JSON/XLSX. The import side (`POST /api/workspaces/{slug}/import-issues/`) is called by the frontend but the backend endpoint does not exist — causing the imports page to fail to load.

## Goal

Implement a symmetric import endpoint that accepts a Plane-exported CSV file and creates issues in a target project.

---

## CSV Format (from IssueExportSerializer)

The exporter produces CSVs with these pretty-printed headers:

| CSV Header  | Model Field           | Notes                                                                      |
| ----------- | --------------------- | -------------------------------------------------------------------------- |
| Name        | Issue.name            | Required                                                                   |
| State Name  | State.name            | Lookup by project; fallback to project default                             |
| Priority    | Issue.priority        | urgent/high/medium/low/none; fallback to none                              |
| Assignees   | Issue.assignees (M2M) | JSON list of full names; skip unknown users                                |
| Labels      | Issue.labels (M2M)    | JSON list of label names; create if missing                                |
| Start Date  | Issue.start_date      | YYYY-MM-DD or blank                                                        |
| Target Date | Issue.target_date     | YYYY-MM-DD or blank                                                        |
| Is Draft    | Issue.is_draft        | true/false string                                                          |
| Parent      | Issue.parent          | identifier string e.g. PROJ-42; resolve after bulk create                  |
| Cycles      | IssueIssueCycle       | JSON list of cycle names; skip if not found                                |
| Modules     | IssueIssueModule      | JSON list of module names; skip if not found                               |
| Comments    | IssueComment          | JSON list of {comment, created_by, created_at}; created_by matched by name |
| Links       | IssueLink             | JSON list of {url, title}                                                  |
| Relations   | IssueRelation         | JSON list of {type, issue, direction}; resolve after bulk create           |

---

## Architecture

### Backend — 3 changes

#### 1. `plane/app/views/importer/base.py` (new file)

Class: `ImportIssuesEndpoint(BaseAPIView)`

- Permission: `ROLE.ADMIN, ROLE.MEMBER` at WORKSPACE level
- Method: `POST`
- Input: `multipart/form-data` — `file` (CSV), `project_id` (UUID string)
- Logic:
  1. Validate project belongs to workspace and user is a member
  2. Read uploaded CSV file, decode via `CSVFormatter().decode()`
  3. **Pass 1 — bulk create issues:**
     - For each row: resolve state, priority, build Issue object
     - `Issue.objects.bulk_create()` with `batch_size=100`
     - Track `identifier → issue_id` map for pass 2
  4. **Pass 2 — create relations:**
     - Assignees: match workspace members by full_name, create IssueAssignee
     - Labels: get_or_create Label per project, create IssueLabel
     - Parent: look up by identifier in identifier map
     - Comments: create IssueComment records
     - Links: create IssueLink records
     - Cycles/Modules: look up by name in project, create join records if found
     - Relations: resolve both sides using identifier map
- Response: `{"imported": N, "skipped": N, "errors": [list of row errors]}`

#### 2. `plane/app/views/importer/__init__.py` (new file)

Export `ImportIssuesEndpoint`.

#### 3. `plane/app/urls/importer.py` (new file)

```python
path("workspaces/<str:slug>/import-issues/", ImportIssuesEndpoint.as_view(), name="import-issues")
```

Wire into `plane/app/urls/__init__.py` as `importer_urls`.

Also add `ImportIssuesEndpoint` to `plane/app/views/__init__.py`.

---

## Error handling

- Missing required `name` field → skip row, add to errors list
- Unknown state name → fall back to project default state
- Unknown user in assignees → skip that assignee silently
- Unparseable date → set field to None
- Invalid priority → set to "none"
- File too large (>10MB) → return 400 immediately
- Non-CSV file → return 400 immediately

---

## Frontend

No changes needed. `ImportForm` already:

- Calls `POST /api/workspaces/${slug}/import-issues/`
- Sends `multipart/form-data` with `project_id` and `file`
- Shows success/error toast on response

---

## What is NOT in scope

- Importing attachments (binary files not in CSV)
- Creating new workspace members from assignee names
- Importing estimate points (requires estimate system lookup)
- XLSX/JSON import (CSV only for now)
