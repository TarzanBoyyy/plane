# Plane CSV Import Guide

Use this guide to prepare a CSV file for importing issues into Plane via **Settings → Imports**.

---

## Quick start

Only one column is required — `Name`. Everything else is optional.

```csv
Name
My first issue
My second issue
```

A full sample file is at `docs/superpowers/csv-import-template.csv`.

---

## Column reference

| Column             | Required | Format                                                        |
| ------------------ | -------- | ------------------------------------------------------------- |
| `Name`             | ✅       | Plain text                                                    |
| `State Name`       | no       | Plain text — must match an existing state in the project      |
| `Priority`         | no       | `urgent` / `high` / `medium` / `low` / `none`                 |
| `Assignees`        | no       | JSON array of full names: `["John Doe"]`                      |
| `Labels`           | no       | JSON array of label names: `["Bug", "Frontend"]`              |
| `Start Date`       | no       | `YYYY-MM-DD`, `MM/DD/YYYY`, or `DD-MM-YYYY`                   |
| `Target Date`      | no       | Same formats as Start Date                                    |
| `Is Draft`         | no       | `true` or `false` (default: `false`)                          |
| `Parent`           | no       | Issue identifier of the parent: `PROJ-5`                      |
| `Description Html` | no       | HTML string: `<p>My description</p>`                          |
| `Cycles`           | no       | JSON array of cycle names: `["Sprint 1"]`                     |
| `Modules`          | no       | JSON array of module names: `["Auth Module"]`                 |
| `Comments`         | no       | JSON array: `[{"comment": "text", "created_by": "John Doe"}]` |
| `Links`            | no       | JSON array: `[{"url": "https://...", "title": "Title"}]`      |
| `Relations`        | no       | JSON array: `[{"type": "relates_to", "issue": "PROJ-1"}]`     |

---

## Column rules

### Name

- Required. Rows with an empty `Name` are skipped.

### State Name

- Must exactly match a state name in the target project (case-insensitive).
- Falls back to the project's default state if blank or unmatched.

### Priority

- Accepted values: `urgent`, `high`, `medium`, `low`, `none`.
- Falls back to `none` if blank or invalid.

### Assignees

- JSON array of workspace member full names.
- Names are matched case-insensitively against `first_name + last_name`.
- Unknown names are silently skipped.
- Example: `["John Doe", "Jane Smith"]`
- Empty: `[]` or leave blank.

### Labels

- JSON array of label name strings.
- Labels are **auto-created** if they don't exist in the project.
- Example: `["Bug", "Frontend"]`

### Dates

- Accepted formats: `YYYY-MM-DD`, `MM/DD/YYYY`, `DD-MM-YYYY`.
- Leave blank if not applicable.

### Is Draft

- `true`, `1`, or `yes` → draft issue.
- Anything else → not a draft.

### Parent

- Use the issue identifier of the parent issue (e.g. `PROJ-5`).
- The parent must be another issue **in the same CSV file**.
- Cross-file parent references are not supported.

### Description Html

- Raw HTML accepted: `<p>Text</p>`, `<ul><li>Item</li></ul>`, etc.
- Leave blank for no description.

### Cycles

- JSON array of cycle names that already exist in the project.
- Unknown cycle names are silently skipped.
- Example: `["Sprint 1", "Sprint 2"]`

### Modules

- JSON array of module names that already exist in the project.
- Unknown module names are silently skipped.
- Example: `["Authentication Module"]`

### Comments

- JSON array of comment objects.
- Each object: `{"comment": "text", "created_by": "Full Name"}`
- `created_by` is matched against workspace members. Falls back to the importing user if not found.
- Example:
  ```json
  [{ "comment": "Looks good", "created_by": "John Doe" }]
  ```

### Links

- JSON array of link objects.
- Each object: `{"url": "https://...", "title": "Optional title"}`
- Example:
  ```json
  [{ "url": "https://example.com", "title": "Reference" }]
  ```

### Relations

- JSON array of relation objects.
- Each object: `{"type": "<relation_type>", "issue": "<identifier>"}`
- The `issue` identifier must reference another issue **in the same CSV file**.
- Valid relation types:

| Type             | Meaning                                 |
| ---------------- | --------------------------------------- |
| `duplicate`      | This issue duplicates the other         |
| `relates_to`     | General relationship                    |
| `blocked_by`     | This issue is blocked by the other      |
| `start_before`   | This issue must start before the other  |
| `finish_before`  | This issue must finish before the other |
| `implemented_by` | This issue is implemented by the other  |

- Example:
  ```json
  [{ "type": "blocked_by", "issue": "PROJ-3" }]
  ```

---

## Tips

- **File encoding**: UTF-8 (with or without BOM). Other encodings will fail.
- **File size**: Maximum 10 MB.
- **JSON columns**: Use double-quoted JSON. In Excel, wrap the cell value in quotes and escape inner quotes by doubling them: `"[""Bug""]"`.
- **Empty JSON columns**: Use `[]` or leave the cell blank — both are accepted.
- **State/Cycle/Module names**: Must match exactly (case-insensitive) — no auto-creation except for Labels.
- **Identifiers in Parent/Relations**: Use the format `PROJKEY-N` (e.g. `PROJ-5`). The issue must exist in the same file — cross-file references are not resolved.

---

## Error handling

The importer runs in two passes:

1. **Pass 1** — bulk creates all issues. Rows with a missing `Name` are skipped and reported.
2. **Pass 2** — creates assignees, labels, comments, links, cycles, modules, parents, and relations. Failures in pass 2 (unknown user, missing cycle, etc.) are silently skipped — the issue is still created.

The API response reports how many issues were imported and skipped:

```json
{
  "imported": 42,
  "skipped": 2,
  "errors": [{ "row": 3, "error": "Missing required field: name" }]
}
```
