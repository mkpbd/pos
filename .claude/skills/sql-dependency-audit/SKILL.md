---
name: sql-dependency-audit
description: Audit SQL Server dependencies for one named feature or database object before changing schema, stored procedures, stock, billing, or ledger logic.
disable-model-invocation: true
---
# SQL Server Dependency Audit

1. Start with the exact table/procedure/function/view names used by the feature.
2. Inspect relevant SQL files and references; use `sql/Find-ObjectDependencies.sql` as a read-only metadata query after setting its parameters.
3. Trace inbound and outbound foreign keys and static SQL dependencies. Flag dynamic SQL and cross-database references as uncertain.
4. Compare source and target columns, types, nullability, keys, indexes, constraints, and definitions.
5. Check transaction boundaries, concurrency, audit, financial/stock side effects, and callers.
6. Never execute DDL/DML or apply migrations. Produce separate manual scripts only when asked.
7. Save a short report to `.claude/reports/<feature>-sql-impact.md`.

Output: exact object names, dependency direction, source/target differences, potential breakage, validation queries, and unknowns. Never dump full schema output.
