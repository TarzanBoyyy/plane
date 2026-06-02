/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";

export class ProjectImportService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async importJiraCSV(
    workspaceSlug: string,
    data: FormData
  ): Promise<{ message: string; token: string }> {
    return this.post(`/api/workspaces/${workspaceSlug}/import-issues/`, data, {
      headers: { "Content-Type": "multipart/form-data" },
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
