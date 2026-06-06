/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { ImportForm } from "./import-form";

type Props = {
  disabled?: boolean;
};

export const ImportGuide = observer(function ImportGuide({ disabled = false }: Props) {
  return (
    <div className="flex size-full flex-col gap-y-13">
      <ImportForm disabled={disabled} />
    </div>
  );
});
