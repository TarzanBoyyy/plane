# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import csv
from io import StringIO

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework import status

from plane.db.models import (
    Issue,
    IssueComment,
    IssueSequence,
    Label,
    Project,
    ProjectMember,
    State,
)


@pytest.fixture
def import_project(db, workspace, create_user):
    project = Project.objects.create(
        name="Import Project",
        identifier="IMP",
        workspace=workspace,
        created_by=create_user,
    )
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    State.objects.create(
        name="Backlog",
        color="#60646C",
        group="backlog",
        default=True,
        project=project,
        workspace=workspace,
    )
    return project


def _csv_file(rows):
    output = StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=["Name", "State Name", "Priority", "Labels", "Comments"],
        quoting=csv.QUOTE_ALL,
    )
    writer.writeheader()
    writer.writerows(rows)
    return SimpleUploadedFile(
        "issues.csv",
        output.getvalue().encode("utf-8"),
        content_type="text/csv",
    )


@pytest.mark.contract
class TestImportIssuesEndpoint:
    def get_import_url(self, workspace_slug):
        return f"/api/workspaces/{workspace_slug}/import-issues/"

    @pytest.mark.django_db
    def test_import_allocates_issue_sequences(self, session_client, workspace, import_project):
        response = session_client.post(
            self.get_import_url(workspace.slug),
            {
                "project_id": str(import_project.id),
                "file": _csv_file(
                    [
                        {"Name": "First imported issue", "State Name": "Backlog", "Priority": "high"},
                        {"Name": "Second imported issue", "State Name": "Backlog", "Priority": "low"},
                    ]
                ),
            },
            format="multipart",
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data["imported"] == 2

        imported_issues = list(Issue.objects.filter(project=import_project).order_by("sequence_id"))
        assert [issue.sequence_id for issue in imported_issues] == [1, 2]
        assert IssueSequence.objects.filter(project=import_project).count() == 2

    @pytest.mark.django_db
    def test_import_accepts_decoded_json_list_cells(self, session_client, workspace, import_project):
        response = session_client.post(
            self.get_import_url(workspace.slug),
            {
                "project_id": str(import_project.id),
                "file": _csv_file(
                    [
                        {
                            "Name": "Issue with metadata",
                            "State Name": "Backlog",
                            "Priority": "medium",
                            "Labels": '["Bug"]',
                            "Comments": '[{"comment":"Needs review","created_by":"Test User"}]',
                        }
                    ]
                ),
            },
            format="multipart",
        )

        assert response.status_code == status.HTTP_200_OK
        issue = Issue.objects.get(project=import_project, name="Issue with metadata")
        assert Label.objects.filter(project=import_project, name="Bug").exists()
        assert issue.labels.filter(name="Bug").exists()
        assert IssueComment.objects.filter(issue=issue, comment_stripped="Needs review").exists()

    @pytest.mark.django_db
    def test_import_escapes_comment_html(self, session_client, workspace, import_project):
        response = session_client.post(
            self.get_import_url(workspace.slug),
            {
                "project_id": str(import_project.id),
                "file": _csv_file(
                    [
                        {
                            "Name": "Issue with unsafe comment",
                            "State Name": "Backlog",
                            "Priority": "medium",
                            "Comments": '[{"comment":"<script>alert(1)</script>"}]',
                        }
                    ]
                ),
            },
            format="multipart",
        )

        assert response.status_code == status.HTTP_200_OK
        comment = IssueComment.objects.get(issue__name="Issue with unsafe comment")
        assert "<script>" not in comment.comment_html
        assert "&lt;script&gt;alert(1)&lt;/script&gt;" in comment.comment_html
