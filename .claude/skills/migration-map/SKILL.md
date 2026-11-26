---
name: migration-map
description: Create a focused dependency map before migrating one module between source frontend, source API, and target projects.
disable-model-invocation: true
---
# Module Migration Map

Inputs: module name, source frontend root, source API root, target root.

1. Capture `git status --short` and identify solution/project entry points.
2. Inventory only the named module in Source Frontend, Source API, and Target.
3. Map each feature: menu/route/page → API method/endpoint → request/response DTO → handler/service → repository/SQL query → database objects.
4. Trace shared dependencies only when references show they are required.
5. Compare source and target definitions; mark each item `missing`, `reuse`, `adapt`, `conflict`, or `unknown`.
6. Identify reverse dependencies for every shared target file/database object that may change.
7. Do not edit code or database. Do not dump files or full SQL definitions.
8. Save the concise result to `.claude/reports/<module>-migration-map.md`.

Return only: scope scanned, dependency counts, key conflicts, risks, files/symbols to change, and the next smallest implementation slice.
