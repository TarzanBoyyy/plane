/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { CustomSearchSelect } from "@plane/ui";
import { useProject } from "@/hooks/store/use-project";
import { ProjectImportService } from "@/services/project/project-import.service";
import { SettingsBoxedControlItem } from "@/components/settings/boxed-control-item";

const projectImportService = new ProjectImportService();

export const ImportForm = observer(function ImportForm() {
  const { workspaceSlug } = useParams();
  const { workspaceProjectIds, getProjectById } = useProject();

  const [projectId, setProjectId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  const options = (workspaceProjectIds ?? []).map((id) => {
    const p = getProjectById(id);
    return {
      value: id,
      query: `${p?.name} ${p?.identifier}`,
      content: (
        <div className="flex items-center gap-2">
          <span className="flex-shrink-0 text-10 text-secondary">{p?.identifier}</span>
          <span className="truncate">{p?.name}</span>
        </div>
      ),
    };
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId) {
      setToast({ type: TOAST_TYPE.ERROR, title: "Error", message: "Please select a project." });
      return;
    }
    if (!fileRef.current?.files?.[0]) {
      setToast({ type: TOAST_TYPE.ERROR, title: "Error", message: "Please select a CSV file." });
      return;
    }
    setLoading(true);
    const formData = new FormData();
    formData.append("project_id", projectId);
    formData.append("file", fileRef.current.files[0]);
    try {
      await projectImportService.importJiraCSV(workspaceSlug as string, formData);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Import started",
        message: "Your Jira CSV is being imported. Issues will appear shortly.",
      });
      setProjectId("");
      setFileName("");
      if (fileRef.current) fileRef.current.value = "";
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Error", message: "Import failed. Please try again." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="rounded-lg border border-subtle bg-layer-2">
        <SettingsBoxedControlItem
          className="rounded-none border-0 border-b"
          title="Target project"
          control={
            <CustomSearchSelect
              value={projectId}
              onChange={(val: string) => setProjectId(val)}
              options={options}
              input
              label={projectId ? (getProjectById(projectId)?.identifier ?? "Select project") : "Select project"}
              optionsClassName="max-w-48 sm:max-w-[532px]"
              placement="bottom-end"
            />
          }
        />
        <SettingsBoxedControlItem
          className="rounded-none border-0 border-b"
          title="Jira CSV file"
          control={
            <div className="flex items-center gap-2">
              <label
                htmlFor="jira-csv-upload"
                className="cursor-pointer rounded border border-subtle px-3 py-1.5 text-13 text-secondary hover:bg-layer-3"
              >
                {fileName || "Choose file"}
              </label>
              <input
                id="jira-csv-upload"
                ref={fileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
              />
            </div>
          }
        />
        <div className="px-4 py-3">
          <Button variant="primary" size="lg" type="submit" loading={loading}>
            {loading ? "Importing..." : "Import"}
          </Button>
        </div>
      </div>
    </form>
  );
});
