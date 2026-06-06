# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import json
from datetime import datetime

from django.db import connection, transaction
from django.db.models import Max
from django.utils import timezone
from django.utils.html import escape, strip_tags
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
    IssueSequence,
    Label,
    Project,
    State,
)
from plane.utils.porters.formatters import CSVFormatter
from plane.utils.uuid import convert_uuid_to_integer

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
    if not value or not value.strip():
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(value.strip(), fmt).date()
        except ValueError:
            continue
    return None


def _parse_json_list(value):
    if isinstance(value, list):
        return value
    if not value or not str(value).strip():
        return []
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, list) else []
    except (json.JSONDecodeError, TypeError):
        # Fallback: treat semicolon-separated string as list
        return [item.strip() for item in str(value).split(";") if item.strip()]


def _clean_description_html(value):
    """Accept raw HTML from description_html column."""
    if not value or not str(value).strip():
        return ""
    return str(value).strip()


def _prepare_issues_for_bulk_create(project, issues):
    last_sequence = (
        IssueSequence.objects.filter(project=project).aggregate(largest=Max("sequence"))["largest"] or 0
    )
    state_ids = {issue.state_id for issue in issues if issue.state_id is not None}
    largest_sort_order_by_state = {
        state_id: Issue.objects.filter(project=project, state_id=state_id).aggregate(largest=Max("sort_order"))[
            "largest"
        ]
        for state_id in state_ids
    }

    completed_at = timezone.now()
    for issue in issues:
        last_sequence += 1
        issue.sequence_id = last_sequence
        issue.description_stripped = (
            None if issue.description_html in ("", None) else strip_tags(issue.description_html)
        )

        if issue.state and issue.state.group == "completed":
            issue.completed_at = completed_at
        else:
            issue.completed_at = None

        if issue.state_id is not None:
            largest_sort_order = largest_sort_order_by_state.get(issue.state_id)
            if largest_sort_order is not None:
                issue.sort_order = largest_sort_order + 10000
            largest_sort_order_by_state[issue.state_id] = issue.sort_order

    return [
        IssueSequence(issue=issue, sequence=issue.sequence_id, project=project, workspace=project.workspace)
        for issue in issues
    ]


class ImportIssuesEndpoint(BaseAPIView):
    parser_classes = [MultiPartParser]

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug):
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

        try:
            content = uploaded_file.read().decode("utf-8-sig")
        except UnicodeDecodeError:
            return Response({"error": "Could not decode file as UTF-8."}, status=status.HTTP_400_BAD_REQUEST)

        rows = CSVFormatter().decode(content)
        if not rows:
            return Response({"imported": 0, "skipped": 0, "errors": []}, status=status.HTTP_200_OK)

        states = {s.name.lower(): s for s in State.objects.filter(project=project)}
        default_state = (
            State.objects.filter(project=project, default=True).first()
            or State.objects.filter(project=project).first()
        )

        issues_to_create = []
        skipped = 0
        row_errors = []
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

            # Support both state_name (export format) and state_group (custom format)
            state_name = (row.get("state_name") or row.get("state_group") or "").strip().lower()
            state = states.get(state_name, default_state)

            is_draft_raw = (row.get("is_draft") or "false").strip().lower()
            is_draft = is_draft_raw in ("true", "1", "yes")

            description_html = _clean_description_html(row.get("description_html"))

            issue = Issue(
                project=project,
                workspace=workspace,
                name=name,
                priority=priority,
                state=state,
                description_html=description_html,
                start_date=_parse_date(row.get("start_date")),
                target_date=_parse_date(row.get("target_date")),
                is_draft=is_draft,
                created_by=request.user,
            )
            issues_to_create.append(issue)
            row_by_index[len(issues_to_create) - 1] = row

        with transaction.atomic():
            if connection.vendor == "postgresql":
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_advisory_xact_lock(%s)", [convert_uuid_to_integer(project.id)])
            issue_sequences_to_create = _prepare_issues_for_bulk_create(project, issues_to_create)
            Issue.objects.bulk_create(issues_to_create, batch_size=100)
            IssueSequence.objects.bulk_create(issue_sequences_to_create, batch_size=100)

        created_issues = issues_to_create

        identifier_map = {
            f"{project.identifier}-{issue.sequence_id}": issue
            for issue in created_issues
        }
        issue_by_pos = {i: issue for i, issue in enumerate(created_issues)}

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
        relation_pairs = []
        parent_pairs = []

        for pos, row in row_by_index.items():
            issue = issue_by_pos.get(pos)
            if issue is None:
                continue

            for name_raw in _parse_json_list(row.get("assignees")):
                user = members_by_name.get(str(name_raw).strip().lower())
                if user:
                    assignees_to_create.append(
                        IssueAssignee(issue=issue, assignee=user, project=project, workspace=workspace)
                    )

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
                        IssueLabel(issue=issue, label=label, project=project, workspace=workspace)
                    )

            for comment_data in _parse_json_list(row.get("comments")):
                if not isinstance(comment_data, dict):
                    continue
                comment_text = str(comment_data.get("comment") or "").strip()
                if not comment_text:
                    continue
                actor = members_by_name.get(str(comment_data.get("created_by") or "").strip().lower()) or request.user
                comments_to_create.append(
                    IssueComment(
                        issue=issue,
                        comment_html=f"<p>{escape(comment_text)}</p>",
                        comment_stripped=comment_text,
                        comment_json={},
                        actor=actor,
                        project=project,
                        workspace=workspace,
                    )
                )

            for link_data in _parse_json_list(row.get("links")):
                if not isinstance(link_data, dict):
                    continue
                url = str(link_data.get("url") or "").strip()
                if url:
                    links_to_create.append(
                        IssueLink(
                            issue=issue,
                            url=url,
                            title=str(link_data.get("title") or "")[:255],
                            project=project,
                            workspace=workspace,
                        )
                    )

            if _CYCLES_AVAILABLE:
                for cycle_name in _parse_json_list(row.get("cycles")):
                    cycle_name = str(cycle_name).strip()
                    if cycle_name:
                        try:
                            cycle = Cycle.objects.get(name=cycle_name, project=project)
                            cycle_issues_to_create.append(
                                CycleIssue(issue=issue, cycle=cycle, project=project, workspace=workspace)
                            )
                        except Cycle.DoesNotExist:
                            pass

            if _MODULES_AVAILABLE:
                for module_name in _parse_json_list(row.get("modules")):
                    module_name = str(module_name).strip()
                    if module_name:
                        try:
                            module = Module.objects.get(name=module_name, project=project)
                            module_issues_to_create.append(
                                ModuleIssue(issue=issue, module=module, project=project, workspace=workspace)
                            )
                        except Module.DoesNotExist:
                            pass

            parent_identifier = (row.get("parent") or "").strip()
            if parent_identifier:
                parent_pairs.append((issue, parent_identifier))

            for rel_data in _parse_json_list(row.get("relations")):
                if not isinstance(rel_data, dict):
                    continue
                rel_type = str(rel_data.get("type") or "").strip()
                rel_identifier = str(rel_data.get("issue") or "").strip()
                if rel_type and rel_identifier:
                    relation_pairs.append((issue, rel_identifier, rel_type))

        IssueAssignee.objects.bulk_create(assignees_to_create, ignore_conflicts=True, batch_size=100)
        IssueLabel.objects.bulk_create(labels_to_create, ignore_conflicts=True, batch_size=100)
        IssueLink.objects.bulk_create(links_to_create, batch_size=100)

        for comment in comments_to_create:
            comment.save()

        if _CYCLES_AVAILABLE:
            CycleIssue.objects.bulk_create(cycle_issues_to_create, ignore_conflicts=True, batch_size=100)
        if _MODULES_AVAILABLE:
            ModuleIssue.objects.bulk_create(module_issues_to_create, ignore_conflicts=True, batch_size=100)

        parents_to_update = []
        for issue, parent_identifier in parent_pairs:
            parent_issue = identifier_map.get(parent_identifier)
            if parent_issue:
                issue.parent = parent_issue
                parents_to_update.append(issue)
        if parents_to_update:
            Issue.objects.bulk_update(parents_to_update, ["parent"], batch_size=100)

        VALID_RELATION_TYPES = {
            "duplicate",
            "relates_to",
            "blocked_by",
            "start_before",
            "finish_before",
            "implemented_by",
        }
        relations_to_create = []
        for issue, rel_identifier, rel_type in relation_pairs:
            related = identifier_map.get(rel_identifier)
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

        return Response(
            {"imported": len(created_issues), "skipped": skipped, "errors": row_errors},
            status=status.HTTP_200_OK,
        )
