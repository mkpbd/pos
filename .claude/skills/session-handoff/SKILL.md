---
name: session-handoff
description: Create or refresh a concise, verified project handoff in docs/claude/SESSION_STATE.md before ending a substantial task, and restore context when continuing work in a new Claude Code session.
argument-hint: "[save|resume|status]"
---

# Session Handoff

Use `docs/claude/SESSION_STATE.md` as the compact handoff for the active project task.

## Resume mode
1. Read the state file if it exists.
2. Check `git status --short` and inspect relevant changed files.
3. Verify whether listed completed steps are actually present.
4. Identify the first incomplete next step and any blockers.
5. Do not re-run completed discovery unless the source changed or the state is uncertain.
6. Report a concise resume summary before proceeding.

## Save mode
Before finishing a substantial task, update the state file with:
- Project/module and task objective.
- Status: NOT_STARTED, IN_PROGRESS, BLOCKED, or DONE.
- Completed steps (verified only).
- Current work in progress.
- Exact changed file paths and short descriptions.
- SQL objects/scripts changed or prepared; whether scripts were executed.
- Key decisions and constraints.
- Build/test commands and actual results.
- Known risks, blockers, and unverified areas.
- Three to five concrete next steps.

Keep the file concise (normally under 100 lines). Do not copy conversation history, source code, full logs, secrets, connection strings, credentials, or patient-identifiable data. Preserve any other unfinished work already recorded.

## Status mode
Summarize the current state file and compare it with Git status. Flag discrepancies instead of silently rewriting history.

## Safety
- Never claim a test passed unless it ran and passed.
- Never mark a database migration as executed unless confirmed.
- Never overwrite unrelated project notes.
- The state file is not a substitute for Git, tests, or source verification.
