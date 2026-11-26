# Persistent Session Continuity

The project uses a persistent session state file:

`docs/claude/SESSION_STATE.md`

## At Every New Session

1. Read the project CLAUDE.md.
2. Check whether docs/claude/SESSION_STATE.md exists.
3. If the previous task is IN_PROGRESS or BLOCKED, read its current state.
4. Check Git status before making changes.
5. Identify completed work, pending work, and current blockers.
6. Continue from the next pending action.
7. Do not repeat completed investigation unnecessarily.

## During Development

Update SESSION_STATE.md after significant milestones:

- Dependency analysis completed.
- Database investigation completed.
- Backend implementation completed.
- Frontend implementation completed.
- Important files modified.
- Testing completed.
- New blockers discovered.

## Before Ending a Task or Session

Update SESSION_STATE.md with:

- Actual completed work.
- Current implementation status.
- Modified file paths.
- Important decisions.
- Database dependencies.
- Build and test results.
- Remaining tasks.
- Exact next steps.

## Memory Efficiency

- Keep SESSION_STATE.md concise.
- Do not copy complete conversation history.
- Do not store full source code.
- Do not store huge SQL or build logs.
- Do not repeat architecture details already documented in CLAUDE.md.
- Do not mark unverified work as completed.
- Preserve previous pending tasks when updating the file.
- Never overwrite unrelated project information.

Use Auto Memory for recurring preferences and corrections.
Use SESSION_STATE.md for active task continuity.
Use Git for actual code change history.

**Important: A new session must continue from verified project state, not assumptions from an old conversation.**