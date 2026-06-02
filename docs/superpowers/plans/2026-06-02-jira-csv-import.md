# Jira CSV Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a synchronous `POST /api/workspaces/{slug}/import-issues/` endpoint that reads a Plane-exported CSV and bulk-creates issues (with labels, assignees, comments, links, cycles, modules, relations) in a target project.

**Architecture:** Two-pass import — Pass 1 bulk-creates bare Issue rows; Pass 2 stitches M2M and FK relations using the identifier→id map built in Pass 1. No Celery. Synchronous. Mirrors `ExportIssuesEndpoint` in structure.

**Tech Stack:** Django REST Framework, `plane.utils.porters.formatters.CSVFormatter`, `plane.db.models` (Issue, State, Label, IssueAssignee, IssueLabel, IssueComment, IssueLink, CycleIssue, ModuleIssue, IssueRelation)

---

## File Map

| Action | Path |
|--------|------|
| **Create** | `apps/api/plane/app/views/importer/__init__.py` |
| **Create** | `apps/api/plane/app/views/importer/base.py` |
| **Create** | `apps/api/plane/app/urls/importer.py` |
| **Modify** | `apps/api/plane/app/urls/__init__.py` |
| **Modify** | `apps/api/plane/app/views/__init__.py` |

---

### Task 1: Create importer view package skeleton

**Files:**
- Create: `apps/api/plane/app/views/importer/__init__.py`
- Create: `apps/api/plane/app/views/importer/base.py`

- [ ] **Step 1: Create the `__init__.py`**

File: `apps/api/plane/app/views/importer/__init__.py`

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from .base import ImportIssuesEndpoint
```

- [ ] **Step 2: Create `base.py` with the stub class**

File: `apps/api/plane/app/views/importer/base.py`

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import allow_permission, ROLE
from .. import BaseAPIView


class ImportIssuesEndpoint(BaseAPIView):

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug):
        return Response({"message": "not implemented"}, status=status.HTTP_501_NOT_IMPLEMENTED)
```

- [ ] **Step 3: Commit**

```bash
cd /opt/plane-source
git add apps/api/plane/app/views/importer/__init__.py apps/api/plane/app/views/importer/base.py
git commit -m "feat: scaffold importer view package"
```

---

### Task 2: Wire the URL

**Files:**
- Create: `apps/api/plane/app/urls/importer.py`
- Modify: `apps/api/plane/app/urls/__init__.py`

- [ ] **Step 1: Create `apps/api/plane/app/urls/importer.py`**

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views import ImportIssuesEndpoint


urlpatterns = [
    path(
        "workspaces/<str:slug>/import-issues/",
        ImportIssuesEndpoint.as_view(),
        name="import-issues",
    ),
]
```

- [ ] **Step 2: Export `ImportIssuesEndpoint` from the views package**

In `apps/api/plane/app/views/__init__.py`, add after line 226 (the ExportIssuesEndpoint import):

```python
from .importer.base import ImportIssuesEndpoint
```

- [ ] **Step 3: Wire into the URL registry**

In `apps/api/plane/app/urls/__init__.py`:

Add import after the `exporter_urls` line:
```python
from .importer import urlpatterns as importer_urls
```

Add `*importer_urls,` to the `urlpatterns` list (after `*exporter_urls,`):
```python
    *exporter_urls,
    *importer_urls,
```

- [ ] **Step 4: Verify Django can load URLs (no import errors)**

```bash
cd /opt/plane-source/apps/api
python manage.py check --deploy 2>&1 | head -30
# Expected: no ImportError or ModuleNotFoundError lines
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/plane/app/urls/importer.py apps/api/plane/app/urls/__init__.py apps/api/plane/app/views/__init__.py
git commit -m "feat: register import-issues URL"
```

---

### Task 3: Implement Pass 1 — parse CSV and bulk-create bare issues

**Files:**
- Modify: `apps/api/plane/app/views/importer/base.py`

- [ ] **Step 1: Replace the stub with the full implementation**

File: `apps/api/plane/app/views/importer/base.py`

```python
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import json
from datetime import datetime

from rest_framework import status
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from plane.app.permissions import allow_permission, ROLE
from plane.db.models import (
    Issue,
    IssueAssignee,
    IssueComment,
    IssueLabel,
    IssueLink,
    IssueRelation,
    Label,
    Project,
    State,
)
from plane.utils.porters.formatters import CSVFormatter

from .. import BaseAPIView

try:
    from plane.db.models import CycleIssue, Cycle
    _CYCLES_AVAILABLE = True
except ImportError:
    _CYCLES_AVAILABLE = False

try:
    from plane.db.models import ModuleIssue, Module
    _MODULES_AVAILABLE = True
except ImportError:
    _MODULES_AVAILABLE = False

VALID_PRIORITIES = {"urgent", "high", "medium", "low", "none"}


def _parse_date(value):
    """Return date object or None for blank/invalid strings."""
    if not value or not value.strip():
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(value.strip(), fmt).date()
        except ValueError:
            continue
    return None


def _parse_json_list(value):
    """Return a Python list from a JSON-encoded string, or [] on failure."""
    if not value or not value.strip():
        return []
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


class ImportIssuesEndpoint(BaseAPIView):
    parser_classes = [MultiPartParser]

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug):
        # --- validate inputs ---
        uploaded_file = request.FILES.get("file")
        project_id = request.data.get("project_id")

        if not uploaded_file:
            return Response({"error": "file is required"}, status=status.HTTP_400_BAD_REQUEST)
        if not project_id:
            return Response({"error": "project_id is required"}, status=status.HTTP_400_BAD_REQUEST)
        if uploaded_file.size > 10 * 1024 * 1024:
            return Response({"error": "File too large. Max 10MB."}, status=status.HTTP_400_BAD_REQUEST)
        if not uploaded_file.name.lower().endswith(".csv"):
            return Response({"error": "Only CSV files are supported."}, status=status.HTTP_400_BAD_REQUEST)

        # --- validate project membership ---
        try:
            project = Project.objects.get(
                id=project_id,
                workspace__slug=slug,
                project_projectmember__member=request.user,
                project_projectmember__is_active=True,
            )
        except Project.DoesNotExist:
            return Response({"error": "Project not found or access denied."}, status=status.HTTP_404_NOT_FOUND)

        workspace = project.workspace

        # --- decode CSV ---
        try:
            content = uploaded_file.read().decode("utf-8-sig")
        except UnicodeDecodeError:
            return Response({"error": "Could not decode file as UTF-8."}, status=status.HTTP_400_BAD_REQUEST)

        rows = CSVFormatter().decode(content)
        if not rows:
            return Response({"imported": 0, "skipped": 0, "errors": []}, status=status.HTTP_200_OK)

        # --- preload project states ---
        states = {s.name.lower(): s for s in State.objects.filter(project=project)}
        default_state = (
            State.objects.filter(project=project, default=True).first()
            or State.objects.filter(project=project).first()
        )

        # --- Pass 1: bulk create bare issues ---
        issues_to_create = []
        skipped = 0
        row_errors = []
        # Map from CSV row index → row dict (for pass 2)
        row_by_index = {}

        for idx, row in enumerate(rows):
            name = (row.get("name") or "").strip()
            if not name:
                skipped += 1
                row_errors.append({"row": idx + 2, "error": "Missing required field: name"})
                continue

            priority = (row.get("priority") or "none").strip().lower()
            if priority not in VALID_PRIORITIES:
                priority = "none"

            state_name = (row.get("state_name") or "").strip().lower()
            state = states.get(state_name, default_state)

            is_draft_raw = (row.get("is_draft") or "false").strip().lower()
            is_draft = is_draft_raw in ("true", "1", "yes")

            issue = Issue(
                project=project,
                workspace=workspace,
                name=name,
                priority=priority,
                state=state,
                start_date=_parse_date(row.get("start_date")),
                target_date=_parse_date(row.get("target_date")),
                is_draft=is_draft,
                created_by=request.user,
            )
            issues_to_create.append(issue)
            row_by_index[len(issues_to_create) - 1] = row

        Issue.objects.bulk_create(issues_to_create, batch_size=100)

        # --- Pass 2: M2M and FK relations ---
        # Build identifier map for parent/relation resolution
        # Re-fetch the created issues in the same order using sequence_id
        created_issues = list(
            Issue.objects.filter(
                project=project,
                id__in=[i.id for i in issues_to_create]
            ).order_by("created_at")
        )

        # Build identifier → issue map (e.g. "PROJ-42" → issue)
        identifier_map = {
            f"{project.identifier}-{issue.sequence_id}": issue
            for issue in created_issues
        }

        # Also build position map: issues_to_create index → created issue
        # (order preserved by bulk_create insertion order)
        issue_by_pos = {i: issue for i, issue in enumerate(created_issues)}

        # Preload workspace members by full_name for assignee resolution
        from django.contrib.auth import get_user_model
        User = get_user_model()
        members_by_name = {}
        for member in User.objects.filter(
            member_workspace__workspace=workspace,
            member_workspace__is_active=True,
        ):
            full_name = f"{member.first_name} {member.last_name}".strip()
            if full_name:
                members_by_name[full_name.lower()] = member

        assignees_to_create = []
        labels_to_create = []
        comments_to_create = []
        links_to_create = []
        cycle_issues_to_create = []
        module_issues_to_create = []
        relation_pairs = []  # list of (issue, related_issue, relation_type)
        parent_pairs = []    # list of (issue, identifier_str)

        for pos, row in row_by_index.items():
            issue = issue_by_pos.get(pos)
            if issue is None:
                continue

            # Assignees
            for name_raw in _parse_json_list(row.get("assignees")):
                name_key = str(name_raw).strip().lower()
                user = members_by_name.get(name_key)
                if user:
                    assignees_to_create.append(
                        IssueAssignee(
                            issue=issue,
                            assignee=user,
                            project=project,
                            workspace=workspace,
                        )
                    )

            # Labels (get_or_create per project)
            for label_name in _parse_json_list(row.get("labels")):
                label_name = str(label_name).strip()
                if label_name:
                    label, _ = Label.objects.get_or_create(
                        name=label_name,
                        project=project,
                        workspace=workspace,
                        defaults={"color": "#6b7280"},
                    )
                    labels_to_create.append(
                        IssueLabel(
                            issue=issue,
                            label=label,
                            project=project,
                            workspace=workspace,
                        )
                    )

            # Comments
            for comment_data in _parse_json_list(row.get("comments")):
                if not isinstance(comment_data, dict):
                    continue
                comment_text = str(comment_data.get("comment") or "").strip()
                if not comment_text:
                    continue
                comment_html = f"<p>{comment_text}</p>"
                actor = None
                created_by_name = str(comment_data.get("created_by") or "").strip().lower()
                if created_by_name:
                    actor = members_by_name.get(created_by_name)
                comments_to_create.append(
                    IssueComment(
                        issue=issue,
                        comment_html=comment_html,
                        comment_stripped=comment_text,
                        comment_json={},
                        actor=actor or request.user,
                        project=project,
                        workspace=workspace,
                    )
                )

            # Links
            for link_data in _parse_json_list(row.get("links")):
                if not isinstance(link_data, dict):
                    continue
                url = str(link_data.get("url") or "").strip()
                if not url:
                    continue
                links_to_create.append(
                    IssueLink(
                        issue=issue,
                        url=url,
                        title=str(link_data.get("title") or "")[:255],
                        project=project,
                        workspace=workspace,
                    )
                )

            # Cycles
            if _CYCLES_AVAILABLE:
                for cycle_name in _parse_json_list(row.get("cycles")):
                    cycle_name = str(cycle_name).strip()
                    if not cycle_name:
                        continue
                    try:
                        cycle = Cycle.objects.get(name=cycle_name, project=project)
                        cycle_issues_to_create.append(
                            CycleIssue(
                                issue=issue,
                                cycle=cycle,
                                project=project,
                                workspace=workspace,
                            )
                        )
                    except Cycle.DoesNotExist:
                        pass

            # Modules
            if _MODULES_AVAILABLE:
                for module_name in _parse_json_list(row.get("modules")):
                    module_name = str(module_name).strip()
                    if not module_name:
                        continue
                    try:
                        module = Module.objects.get(name=module_name, project=project)
                        module_issues_to_create.append(
                            ModuleIssue(
                                issue=issue,
                                module=module,
                                project=project,
                                workspace=workspace,
                            )
                        )
                    except Module.DoesNotExist:
                        pass

            # Parent (deferred — needs full identifier_map)
            parent_identifier = (row.get("parent") or "").strip()
            if parent_identifier:
                parent_pairs.append((issue, parent_identifier))

            # Relations (deferred)
            for rel_data in _parse_json_list(row.get("relations")):
                if not isinstance(rel_data, dict):
                    continue
                rel_type = str(rel_data.get("type") or "").strip()
                rel_issue_identifier = str(rel_data.get("issue") or "").strip()
                if rel_type and rel_issue_identifier:
                    relation_pairs.append((issue, rel_issue_identifier, rel_type))

        # Bulk save M2M rows
        IssueAssignee.objects.bulk_create(assignees_to_create, ignore_conflicts=True, batch_size=100)
        IssueLabel.objects.bulk_create(labels_to_create, ignore_conflicts=True, batch_size=100)
        IssueLink.objects.bulk_create(links_to_create, batch_size=100)

        # Comments use custom save() (manages Description model), so save one by one
        for comment in comments_to_create:
            comment.save()

        if _CYCLES_AVAILABLE:
            CycleIssue.objects.bulk_create(cycle_issues_to_create, ignore_conflicts=True, batch_size=100)
        if _MODULES_AVAILABLE:
            ModuleIssue.objects.bulk_create(module_issues_to_create, ignore_conflicts=True, batch_size=100)

        # Resolve parents
        parents_to_update = []
        for issue, parent_identifier in parent_pairs:
            parent_issue = identifier_map.get(parent_identifier)
            if parent_issue:
                issue.parent = parent_issue
                parents_to_update.append(issue)
        if parents_to_update:
            Issue.objects.bulk_update(parents_to_update, ["parent"], batch_size=100)

        # Resolve relations
        VALID_RELATION_TYPES = {"duplicate", "relates_to", "blocked_by", "start_before", "finish_before", "implemented_by"}
        relations_to_create = []
        for issue, rel_issue_identifier, rel_type in relation_pairs:
            related = identifier_map.get(rel_issue_identifier)
            if related and rel_type in VALID_RELATION_TYPES:
                relations_to_create.append(
                    IssueRelation(
                        issue=issue,
                        related_issue=related,
                        relation_type=rel_type,
                        project=project,
                        workspace=workspace,
                    )
                )
        IssueRelation.objects.bulk_create(relations_to_create, ignore_conflicts=True, batch_size=100)

        imported = len(created_issues)
        return Response(
            {"imported": imported, "skipped": skipped, "errors": row_errors},
            status=status.HTTP_200_OK,
        )
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/plane/app/views/importer/base.py
git commit -m "feat: implement two-pass CSV import endpoint"
```

---

### Task 4: Smoke-test end-to-end

- [ ] **Step 1: Restart the API server**

```bash
cd /opt/plane-source
docker compose restart api 2>/dev/null || supervisorctl restart plane-api 2>/dev/null || pkill -HUP -f gunicorn
```

- [ ] **Step 2: Export a small set of issues to get a valid CSV**

In Plane UI: Settings → Exports → Export to CSV. Download the file.

- [ ] **Step 3: POST the CSV to the import endpoint**

Replace `YOUR_SLUG`, `YOUR_PROJECT_ID`, `YOUR_TOKEN`, and `export.csv` as appropriate:

```bash
curl -s -X POST \
  "http://localhost/api/workspaces/YOUR_SLUG/import-issues/" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "project_id=YOUR_PROJECT_ID" \
  -F "file=@export.csv" | python3 -m json.tool
```

Expected response:
```json
{
  "imported": 5,
  "skipped": 0,
  "errors": []
}
```

- [ ] **Step 4: Verify issues appear in the project in the UI**

Open the project board. Confirm imported issues are present with correct state, priority, labels, and assignees.

- [ ] **Step 5: Test the imports page loads without error**

Navigate to Settings → Imports. Confirm the page loads (no blank screen / 404).

- [ ] **Step 6: Commit any fixes found during smoke test, then tag**

```bash
git add -p
git commit -m "fix: csv import smoke test fixes"
```
