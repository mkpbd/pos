---
name: regression-summary
description: Run and summarize targeted regression checks for the files and dependencies changed in the current task.
disable-model-invocation: true
---
# Targeted Regression Summary

1. Read the changed-file list and identify direct consumers and impacted modules.
2. Run the narrowest relevant unit/integration tests first.
3. Build only the affected project(s); run the full solution build only when the change crosses shared boundaries.
4. Redirect verbose output to `.claude/reports/logs/` and inspect only errors, warnings, failed tests, and relevant excerpts.
5. Do not run deployment, database migration, seeding, or destructive commands.
6. Report exact commands, exit codes, pass/fail counts, failing test names, and untested areas.
7. Do not infer that an untested module is safe.
