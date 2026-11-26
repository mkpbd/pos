---
name: implementation-slice
description: Implement one approved, bounded feature slice using the target project's conventions without broad refactoring.
disable-model-invocation: true
---
# Bounded Implementation Slice

1. Read the approved migration map and the exact files/methods needed for this slice.
2. Confirm current working tree changes and preserve unrelated edits.
3. Reuse target abstractions, validation, authorization, error handling, logging, and transaction patterns.
4. Change the smallest set of files. Do not bulk-copy source files or refactor adjacent modules.
5. For database changes, create ordered manual SQL scripts; never connect to or modify production databases.
6. Add or update focused tests for the changed behavior.
7. Run the narrowest relevant build/test command and summarize output instead of pasting full logs.
8. Update `.claude/reports/<feature>-implementation.md` with changed paths, decisions, tests, and follow-up risks.

Do not claim completion when API, database, UI, or regression portions remain unverified.
