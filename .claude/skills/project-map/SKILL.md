---
name: project-map
description: Build, query, and refresh a persistent codebase architecture/dependency map using Codebase Memory MCP when available. Useful for large .NET, Angular, React, Blazor, SQL Server, and multi-repository ERP migrations.
argument-hint: "[index|refresh|impact|cross-repo|status]"
---

# Project Map

Use Codebase Memory MCP for persistent structural mapping when the server is connected. Do not invent tool names; inspect the tools exposed by the connected MCP and use the corresponding indexing, graph-search, dependency, call-path, and cross-repository tools.

## Index mode
- Confirm the repository root before indexing.
- Inspect `.gitignore` and identify generated, binary, backup, export, upload, log, secret, and patient-data directories.
- Do not index `.env`, credentials, connection strings, SQL backups, production data exports, patient-identifiable files, `bin`, `obj`, `node_modules`, `dist`, `.vs`, logs, or temporary build outputs.
- If sensitive data may exist inside the repository, ask the user to confirm the exclusions before indexing.
- Index the current repository only. For additional repositories, ask for/verify each exact path and index them separately.
- Report indexed root, coverage/count if exposed, exclusions, errors, and skipped files.

## Refresh mode
- Check whether the repository is already indexed.
- Refresh only the affected repository after code changes; do not trigger a full index unnecessarily.
- Confirm that the refreshed graph reflects the relevant changed files.

## Impact mode
- Identify the target symbol/file/API/database object.
- Query callers, references, dependencies, related tests, and affected modules using graph tools.
- Verify important graph edges against source code and database definitions before changing anything.
- Return a concise impact list, not a complete graph dump.

## Cross-repository mode
- Map each explicitly named repository independently.
- Trace frontend API calls to backend endpoints, handlers/services, data models, and SQL calls where source evidence exists.
- Distinguish proven links from inferred/unresolved links.
- Do not assume runtime database dependencies are fully visible from source indexing.

## Status mode
- Report indexed repositories, index freshness/status, last refresh if available, and indexing errors.

## Token efficiency
- Ask targeted graph queries.
- Return relevant paths, symbols, and edge types only.
- Do not dump all nodes/edges into the chat.
- Reuse a current index; refresh selectively.

## Safety
- Never index actual patient records, credentials, `.env` files, backups, or production exports.
- Never edit source code or databases as part of mapping.
- Treat graph output as navigation evidence, not unquestionable truth.
