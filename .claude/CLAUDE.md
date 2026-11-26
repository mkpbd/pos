# Project Working Rules

- Keep this file short. Load detailed workflows only through the relevant `/skill-name` command.
- Work only within the requested module and its traced dependencies. Do not scan the whole repository by default.
- Exclude generated folders from discovery: `bin/`, `obj/`, `node_modules/`, `dist/`, `.next/`, `coverage/`, `.git/`, and build output folders.
- Start with `git status --short` and identify the solution/project entry points. Never overwrite unrelated local changes.
- Search symbols and references before opening full files. Read only the relevant methods/regions; do not dump entire large files.
- For migrations, inventory Source Frontend, Source API, and Target separately. Build a concise feature → UI → API → service/handler → SQL dependency map before changing code.
- Compare Source and Target definitions. Never bulk-copy files or blindly replace shared services, routes, DTOs, stored procedures, or database objects.
- Implement one bounded feature slice at a time. Reuse Target architecture and preserve existing public contracts unless a documented change is required.
- Never apply database changes directly. Generate reviewed, ordered, idempotent manual SQL scripts. Do not run destructive SQL or alter production data.
- Use database transactions and preserve audit, financial, stock, and foreign-key integrity where relevant.
- Run targeted tests/builds. Save verbose output to files and return only the exit code, counts, and relevant error lines.
- Store concise working reports under `.claude/reports/` (create the folder when needed). Do not paste full source files, full schemas, or full logs into chat.
- Use a subagent only for a bounded, high-volume read-only task. Normally run one subagent at a time; do not create an agent team for routine work.
- Main response format: findings, affected paths/symbols, changes made, checks run, unresolved risks. Keep it concise.

## Compaction Handoff
When context is getting large, preserve: task goal, source/target roots, completed phases, exact files/symbols changed, key dependency decisions, tests and failures, pending next actions. Do not repeat already-known repository inventory.
