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
