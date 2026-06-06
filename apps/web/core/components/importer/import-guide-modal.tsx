/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";

const CSV_COLUMNS = [
  { name: "Name", required: "Yes", format: "Plain text, the issue title" },
  { name: "State Name", required: "No", format: "Must match an existing state in the project" },
  { name: "Priority", required: "No", format: "`urgent` / `high` / `medium` / `low` / `none`" },
  { name: "Assignees", required: "No", format: 'JSON array of full names: `["John Doe"]`' },
  { name: "Labels", required: "No", format: 'JSON array: `["Bug", "Frontend"]` and auto-created if missing' },
  { name: "Start Date", required: "No", format: "`YYYY-MM-DD`, `MM/DD/YYYY`, or `DD-MM-YYYY`" },
  { name: "Target Date", required: "No", format: "Same formats as Start Date" },
  { name: "Is Draft", required: "No", format: "`true` or `false` (default: `false`)" },
  { name: "Parent", required: "No", format: "Identifier of the parent issue in the same file: `PROJ-5`" },
  { name: "Description Html", required: "No", format: "HTML string: `<p>My description</p>`" },
  { name: "Cycles", required: "No", format: 'JSON array of existing cycle names: `["Sprint 1"]`' },
  { name: "Modules", required: "No", format: 'JSON array of existing module names: `["Auth Module"]`' },
  { name: "Comments", required: "No", format: '`[{"comment": "text", "created_by": "John Doe"}]`' },
  { name: "Links", required: "No", format: '`[{"url": "https://...", "title": "Title"}]`' },
  { name: "Relations", required: "No", format: '`[{"type": "relates_to", "issue": "PROJ-1"}]`' },
] as const;

const RELATION_TYPES = ["duplicate", "relates_to", "blocked_by", "start_before", "finish_before", "implemented_by"];

const CSV_TIPS = [
  "Only `Name` is required, rows without it are skipped.",
  "File must be UTF-8 encoded, max 10 MB.",
  "Labels are auto-created. States, Cycles, and Modules must already exist.",
  "`Parent` and `Relations` must reference issues in the same file.",
  'In Excel, wrap JSON cells in quotes and double inner quotes, for example `"[""Bug""]"`.',
] as const;

const CSV_TEMPLATE = `Name,State Name,Priority,Assignees,Labels,Start Date,Target Date,Is Draft,Parent,Description Html,Cycles,Modules,Comments,Links,Relations
Implement user authentication,In Progress,high,"[""John Doe""]","[""Backend"",""Auth""]",2026-06-01,2026-06-30,false,,<p>JWT-based auth for all API endpoints.</p>,"[""Sprint 1""]","[""Auth Module""]","[{""comment"": ""Started"", ""created_by"": ""John Doe""}]","[{""url"": ""https://example.com"", ""title"": ""Spec""}]","[]"
Fix login page bug,Todo,urgent,"[""Jane Smith""]","[""Bug"",""Frontend""]",2026-06-05,2026-06-10,false,,<p>Login button unresponsive on mobile.</p>,"[]","[]","[]","[]","[{""type"": ""relates_to"", ""issue"": ""PROJ-1""}]"
Write API documentation,Todo,medium,"[""John Doe""]","[""Docs""]",2026-06-10,2026-07-01,false,,<p>OpenAPI spec documentation.</p>,"[""Sprint 2""]","[""Docs Module""]","[]","[]","[]"
Draft new onboarding flow,Backlog,low,"[]","[""UX""]",,,true,,<p>Draft improved onboarding UX.</p>,"[]","[]","[]","[]","[]"`;

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

function InlineCode({ children }: { children: string }) {
  return <code className="font-mono rounded bg-layer-3 px-1 py-0.5 text-12 text-accent-primary">{children}</code>;
}

export function ImportGuideModal({ isOpen, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(CSV_TEMPLATE);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.TOP} width={EModalWidth.XXXXL}>
      <div className="flex max-h-[80vh] flex-col">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-subtle px-5 py-4">
          <h3 className="text-base font-medium text-primary">CSV Import Guide</h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-tertiary transition-colors hover:bg-layer-3 hover:text-secondary"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-5 rounded-lg border border-subtle bg-layer-2">
            <div className="flex items-center justify-between border-b border-subtle px-4 py-2.5">
              <span className="text-13 font-medium text-secondary">Sample CSV template</span>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 rounded border border-subtle px-2.5 py-1 text-12 text-secondary transition-colors hover:bg-layer-3"
              >
                {copied ? (
                  <>
                    <Check className="text-green-500 size-3" />
                    <span className="text-green-500">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="size-3" />
                    <span>Copy template</span>
                  </>
                )}
              </button>
            </div>
            <div className="overflow-x-auto px-4 py-3">
              <pre className="font-mono text-11 leading-relaxed whitespace-pre text-tertiary">{CSV_TEMPLATE}</pre>
            </div>
          </div>

          <div className="space-y-5 text-13 text-secondary">
            <section className="space-y-2">
              <h4 className="text-sm font-medium text-primary">Column reference</h4>
              <div className="overflow-x-auto rounded-lg border border-subtle">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-layer-2">
                      <th className="border border-subtle px-2 py-1.5 text-left text-13 font-medium text-secondary">
                        Column
                      </th>
                      <th className="border border-subtle px-2 py-1.5 text-left text-13 font-medium text-secondary">
                        Required
                      </th>
                      <th className="border border-subtle px-2 py-1.5 text-left text-13 font-medium text-secondary">
                        Format
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {CSV_COLUMNS.map((column) => (
                      <tr key={column.name}>
                        <td className="border border-subtle px-2 py-1.5 text-secondary">
                          <InlineCode>{column.name}</InlineCode>
                        </td>
                        <td className="border border-subtle px-2 py-1.5 text-secondary">{column.required}</td>
                        <td className="border border-subtle px-2 py-1.5 text-secondary">
                          <InlineCode>{column.format}</InlineCode>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="space-y-2">
              <h4 className="text-sm font-medium text-primary">Relation types</h4>
              <p>
                {RELATION_TYPES.map((type, index) => (
                  <span key={type}>
                    <InlineCode>{type}</InlineCode>
                    {index < RELATION_TYPES.length - 1 ? " · " : ""}
                  </span>
                ))}
              </p>
            </section>

            <section className="space-y-2">
              <h4 className="text-sm font-medium text-primary">Tips</h4>
              <ul className="ml-5 list-disc space-y-2">
                {CSV_TIPS.map((tip) => (
                  <li key={tip}>
                    <InlineCode>{tip}</InlineCode>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>

        <div className="flex flex-shrink-0 justify-end border-t border-subtle px-5 py-3">
          <button
            onClick={onClose}
            className="rounded border border-subtle px-4 py-1.5 text-13 text-secondary transition-colors hover:bg-layer-3"
          >
            Close
          </button>
        </div>
      </div>
    </ModalCore>
  );
}
