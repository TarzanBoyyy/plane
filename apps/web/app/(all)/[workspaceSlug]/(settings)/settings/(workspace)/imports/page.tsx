/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "react-router";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { cn } from "@plane/utils";
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { PageHead } from "@/components/core/page-title";
import { ImportGuide } from "@/components/importer/guide";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { SettingsHeading } from "@/components/settings/heading";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useUserPermissions } from "@/hooks/store/user";
import { ImportsWorkspaceSettingsHeader } from "./header";

function ImportsPage() {
  const { workspaceSlug } = useParams();
  const { workspaceInfoBySlug, allowPermissions } = useUserPermissions();
  const { currentWorkspace } = useWorkspace();

  const workspaceUserInfo = workspaceInfoBySlug(workspaceSlug as string);
  const canPerformWorkspaceMemberActions = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.WORKSPACE
  );
  const pageTitle = currentWorkspace?.name ? `${currentWorkspace.name} - Imports` : undefined;

  // Only short-circuit once we know the user's role for THIS workspace and they lack access.
  // Until then, render the form so the page does not flash an unauthorized state during hydration.
  if (workspaceUserInfo && !canPerformWorkspaceMemberActions) {
    return <NotAuthorizedView section="settings" className="h-auto" />;
  }

  return (
    <SettingsContentWrapper header={<ImportsWorkspaceSettingsHeader />} hugging>
      <PageHead title={pageTitle} />
      <div
        className={cn("flex w-full flex-col gap-y-6", {
          "opacity-60": !canPerformWorkspaceMemberActions,
        })}
      >
        <SettingsHeading
          title="Import issues"
          description="Import issues from a Jira CSV export into one of your projects."
        />
        <ImportGuide disabled={!canPerformWorkspaceMemberActions} />
      </div>
    </SettingsContentWrapper>
  );
}

export default observer(ImportsPage);
