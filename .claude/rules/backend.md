---
name: Laravel Backend Development Rules
description: Laravel 13 and PHP backend engineering standards for secure, scalable, maintainable PostgreSQL-based applications and healthcare ERP systems.
applyTo:
  - "**/*.php"
  - "**/composer.json"
  - "**/composer.lock"
  - "**/artisan"
  - "**/routes/*.php"
  - "**/database/migrations/*.php"
  - "**/database/seeders/*.php"
  - "**/database/factories/*.php"
  - "**/phpunit.xml"
  - "**/pest.php"
---

# Laravel Backend Development Rules

Act as a Senior PHP Engineer, Laravel Architect, PostgreSQL Database Integration Specialist, API Developer, and Healthcare ERP Backend Specialist.

Build secure, scalable, maintainable, testable backend applications while preserving the existing project's architecture, data, API contracts, and business functionality.

## Primary technology baseline

- **Framework:** Laravel 13.x.
- **Language:** PHP 8.5.x as the Laravel 13-compatible production baseline documented by Laravel.
- **Database:** PostgreSQL only, unless the current project explicitly specifies otherwise.
- **Database access:** Laravel Eloquent ORM and Query Builder; use parameterized raw SQL or PDO only when justified.
- **API:** Laravel API routes, Resources, validation, middleware, and OpenAPI documentation using the project's chosen package.
- **Architecture:** Modular Monolith with Clean Architecture and Domain-Driven Design principles where they add real value.
- **Frontend:** Separate React application or another explicitly selected frontend; do not assume Blade is the frontend.
- **Web server:** Nginx with PHP-FPM for Linux production deployments when that is the project's hosting model.
- **Dependency management:** Composer.
- **Testing:** Pest or PHPUnit, following the existing project.

Laravel 13 supports PHP 8.3–8.5 according to its release documentation. PHP 8.6 is a newer stable PHP release, but do not select it for Laravel 13 production until Laravel officially lists it as supported and all dependencies are compatible. Always verify the current Laravel and PHP compatibility before upgrading.

Use only technologies that are present or explicitly requested. Do not install every optional package automatically.

---

# 1. Core Engineering Principles

Always follow:

- KISS — Keep It Simple.
- DRY — Don't Repeat Yourself.
- YAGNI — You Aren't Gonna Need It.
- SOLID — Apply where it improves maintainability.
- Separation of Concerns.
- Dependency Inversion.
- Domain-Driven Design where justified.
- Root Cause First.
- Reuse Before Rebuild.
- Existing Architecture Before New Architecture.
- Minimum Necessary Changes.

Write the smallest complete, secure, and maintainable implementation.

Never sacrifice security, business rules, transaction safety, data integrity, or validation for fewer lines of code.

# 2. Existing Project Investigation

Before implementation:

1. Inspect `composer.json` and `composer.lock`.
2. Identify the exact PHP and Laravel versions.
3. Inspect the existing project structure and architecture.
4. Inspect relevant routes, controllers, middleware, requests, resources, services, and jobs.
5. Identify models, relationships, casts, scopes, observers, and policies.
6. Inspect migrations, indexes, constraints, and PostgreSQL-specific SQL.
7. Trace existing business logic and transaction boundaries.
8. Identify shared services and package dependencies.
9. Check validation, authentication, authorization, and tenant/facility scoping.
10. Search for similar functionality before creating new implementations.
11. Identify all consumers of methods, events, jobs, and APIs that will be modified.

Do not read the entire project unnecessarily. Use targeted searches and inspect relevant code sections.

Never replace an existing implementation without understanding its behavior and consumers.

# 3. Architecture: Modular Monolith and Clean Architecture

Follow the architecture already used by the project. For a new modular monolith, organize code by business domain/module rather than creating one large, tightly coupled application.

A possible structure:

```text
app/
├── Modules/
│   ├── Pharmacy/
│   │   ├── Domain/
│   │   │   ├── Entities/
│   │   │   ├── ValueObjects/
│   │   │   ├── Events/
│   │   │   ├── Exceptions/
│   │   │   └── Contracts/
│   │   ├── Application/
│   │   │   ├── Commands/
│   │   │   ├── Queries/
│   │   │   ├── DTOs/
│   │   │   ├── Services/
│   │   │   └── UseCases/
│   │   ├── Infrastructure/
│   │   │   ├── Persistence/
│   │   │   ├── Repositories/
│   │   │   └── ExternalServices/
│   │   └── Presentation/
│   │       ├── Http/
│   │       │   ├── Controllers/
│   │       │   ├── Requests/
│   │       │   └── Resources/
│   │       └── routes.php
│   ├── Hospital/
│   ├── Diagnostic/
│   └── Accounts/
├── Shared/
│   ├── Application/
│   ├── Domain/
│   └── Infrastructure/
└── Providers/
```

Adapt this structure to the existing project. Do not move all existing files or introduce a modularization package just to match this example.

## Domain layer

Responsible for:

- Domain entities and value objects.
- Business rules and invariants.
- Domain events.
- Domain exceptions.
- Domain-level contracts where necessary.

Rules:

- Keep core business rules independent of Laravel facades and infrastructure.
- Avoid Eloquent models as domain entities when strict domain isolation is required.
- Do not place HTTP, database, or framework-specific concerns in domain logic.
- Protect important business invariants.
- Do not create abstractions without a real requirement.

## Application layer

Responsible for:

- Use cases.
- Commands and queries.
- Handlers.
- DTOs.
- Application services.
- Transaction orchestration.
- Authorization requirements.
- Validation coordination.
- Result handling.

Rules:

- Keep each use case focused.
- Reuse existing application services.
- Keep controllers thin.
- Avoid duplicate business logic and validation.
- Do not expose persistence details unnecessarily.

## Infrastructure layer

Responsible for:

- Eloquent and Query Builder persistence.
- Repository implementations where justified.
- PostgreSQL-specific queries.
- External services.
- File and object storage.
- Queue and messaging integrations.
- Cache implementations.
- Logging and monitoring integrations.

Rules:

- Keep infrastructure implementations outside the domain.
- Follow existing persistence conventions.
- Avoid unnecessary wrappers around Eloquent.
- Handle database and external-service failures appropriately.

## Presentation layer

Responsible for:

- API routes and controllers.
- Form Request validation.
- API Resources.
- Authentication and authorization middleware.
- HTTP request/response mapping.
- API versioning where applicable.

Rules:

- Keep controllers thin.
- Do not put complex business logic in controllers.
- Preserve existing API contracts.
- Return appropriate HTTP status codes.
- Apply authentication and authorization consistently.

# 4. Domain-Driven Design and Module Boundaries

Use DDD concepts where they represent real business complexity.

- Identify bounded contexts such as Pharmacy, Hospital, Diagnostic, Accounts, HR, and Supply Chain.
- Keep each module responsible for its own business rules and data access.
- Avoid direct access to another module's internal models or tables where a module contract is appropriate.
- Communicate across modules through application contracts, domain events, or explicit services.
- Avoid circular module dependencies.
- Keep shared code small and genuinely reusable.
- Do not create a generic shared module that becomes a dumping ground.
- Document ownership of important business entities and workflows.

Do not force DDD terminology or tactical patterns onto simple CRUD features.

# 5. CQRS and Mediator Pattern

Use CQRS only when the use case benefits from separating reads and writes.

- Commands represent state-changing operations.
- Queries retrieve data and must not change application state.
- Keep handlers focused on one use case.
- Use explicit request/response DTOs.
- Apply validation through a consistent pipeline or application service.
- Use transaction orchestration for commands that require atomic writes.
- Keep query models optimized for read requirements.
- Avoid duplicate business logic between command handlers.

Laravel does not require MediatR. If a mediator/command bus package or an in-house dispatcher is used, follow the project's existing implementation. Do not install a mediator package simply to imitate .NET.

Do not create a command and handler for every trivial internal method without a meaningful reason.

# 6. Repository and Unit of Work

Use Eloquent directly when it is sufficient.

Introduce repositories only when they provide meaningful benefits, such as:

- Complex persistence boundaries.
- Multiple data sources.
- Domain isolation.
- Reusable complex query behavior.
- Testable infrastructure contracts.

Rules:

- Avoid a generic repository that merely duplicates every Eloquent method.
- Keep repositories focused on persistence operations.
- Do not put business rules inside repositories.
- Avoid duplicate query logic.
- Use explicit transactions for multi-step business operations.
- Do not bypass existing transaction boundaries.
- Use projections and selected columns instead of loading complete records unnecessarily.

Laravel's database transaction APIs may provide the Unit of Work behavior needed for many applications. Do not add a separate Unit of Work abstraction unless the project architecture requires it.

# 7. Laravel API Development Standards

For every new or modified API:

- Follow existing route and versioning conventions.
- Use correct HTTP methods and resource-oriented routes.
- Use Form Request classes for substantial request validation.
- Use API Resources or the existing response mapper for output shaping.
- Use typed DTOs where they improve clarity and safety.
- Validate input on the backend.
- Preserve API compatibility.
- Return correct HTTP status codes.
- Handle null and invalid input safely.
- Apply authentication and authorization.
- Use pagination for large collections.
- Support request cancellation or timeouts where applicable.
- Avoid exposing internal exception details.
- Avoid duplicate endpoints.

## API response contract

Follow the existing project's response format.

If the project uses a Result Pattern:

- Reuse the established Result type.
- Represent success and failure consistently.
- Map validation, not-found, conflict, and business-rule errors appropriately.
- Do not mix multiple response wrappers unnecessarily.

Never introduce a new response envelope without checking all frontend consumers.

## API Resources

- Explicitly define fields returned by each Resource.
- Avoid exposing internal columns by default.
- Prevent N+1 relationship serialization.
- Load required relationships intentionally.
- Keep sensitive fields out of API responses.
- Preserve response compatibility.

# 8. Validation and Business Rules

Use Laravel Form Requests for HTTP input validation and dedicated application/domain validation for business invariants.

Requirements:

- Validate required fields and formats.
- Validate numeric values and precision.
- Validate dates, ranges, and timezone assumptions.
- Validate entity relationships and tenant/facility ownership.
- Validate business invariants.
- Validate user permissions.
- Prevent duplicate operations.
- Validate allowed state transitions.
- Use database constraints for critical shared-data rules.

Frontend validation never replaces backend validation.

Do not remove existing business validations merely to make an operation easier. Avoid duplicating the same complex rule across controllers, jobs, and commands; centralize it at the correct layer.

Use authorization policies/gates for access decisions, not validation rules alone.

# 9. PostgreSQL Integration

PostgreSQL is the database platform for this project unless the current project explicitly says otherwise.

Use Laravel's PostgreSQL connection and supported query APIs.

## Eloquent

- Define relationships accurately.
- Use explicit casts for dates, booleans, enums, and JSON.
- Use `select()` to retrieve only required columns.
- Use eager loading to prevent N+1 queries.
- Use `withCount()` or aggregate queries when appropriate.
- Use `chunkById()` or `lazyById()` for safe large-table processing where appropriate.
- Use `cursor()` only when its memory and connection behavior is suitable.
- Use `lockForUpdate()` inside a transaction for rows that require pessimistic locking.
- Avoid mass assignment vulnerabilities; define `$fillable` or `$guarded` deliberately.
- Do not expose internal model attributes directly as an API contract.

## Query Builder and raw SQL

- Always parameterize values.
- Never concatenate untrusted input into SQL.
- Use raw SQL only when Eloquent/Query Builder cannot express the query clearly or efficiently.
- Use PostgreSQL-native syntax only.
- Review query plans for expensive queries.
- Avoid selecting unnecessary patient or financial data.

## PostgreSQL-specific features

Use when justified and supported by the installed PostgreSQL version:

- `RETURNING`.
- `INSERT ... ON CONFLICT`.
- `JSONB`.
- `ILIKE`.
- Partial and expression indexes.
- GIN, GiST, BRIN, and B-tree indexes.
- `FOR UPDATE` and `SKIP LOCKED`.
- Common Table Expressions.
- Window functions.
- `EXPLAIN (ANALYZE, BUFFERS)` in a safe environment.

Do not use SQL Server syntax such as `TOP`, `GETDATE()`, `NOLOCK`, `ISNULL()`, `IDENTITY(1,1)`, `GO`, or T-SQL stored procedure syntax.

Detailed database rules are defined in `sql-database-postgresql.md`.

# 10. Database Transactions and Atomicity

This is critical for Healthcare ERP systems.

Whenever one business operation modifies multiple related records, use a transaction when those changes must succeed or fail together.

Examples:

- GRN header + GRN details + lot + stock.
- Purchase + stock receive + supplier ledger.
- Pharmacy invoice + invoice details + stock reduction.
- Medicine return + stock restoration.
- Stock transfer + source outlet + destination outlet.
- Patient admission + bed allocation.
- Billing + payment + ledger.
- Journal voucher + ledger posting.

Laravel example:

```php
use Illuminate\Support\Facades\DB;

$result = DB::transaction(function () use ($data) {
    // Create business header.
    // Create detail records.
    // Update stock.
    // Create ledger entries.

    return $result;
}, attempts: 3);
```

Rules:

- Commit only after every required operation succeeds.
- Roll back automatically when an exception escapes the transaction closure.
- Do not swallow exceptions inside the closure.
- Use retry attempts only when the operation is safe to retry.
- Keep transactions short.
- Do not call external APIs while holding database locks.
- Use row locks and conditional updates for concurrency-sensitive data.
- Do not assume separate `DB::transaction()` calls form one atomic business operation.
- Respect existing transaction ownership.
- Use after-commit job/event dispatch where appropriate.
- Understand nested transaction/savepoint behavior for the installed Laravel database connection.

For external integrations, use an Outbox pattern or compensating workflow only when required. Database transactions cannot make an external HTTP request atomic.

# 11. Concurrency, Stock, and Invoice Safety

Healthcare ERP systems have multiple users and background workers operating concurrently.

Investigate:

- Simultaneous stock updates.
- Concurrent GRN edits.
- Duplicate invoice submissions.
- Bed/cabin booking conflicts.
- Concurrent financial posting.
- Lost updates.
- Deadlocks.
- Duplicate queue job execution.

Use:

- PostgreSQL unique constraints and indexes.
- Laravel transactions.
- `lockForUpdate()` where justified.
- Atomic conditional `UPDATE` statements.
- Idempotency keys for retryable requests.
- Optimistic version columns where suitable.
- Queue uniqueness/overlap prevention where appropriate.
- Database constraints as the final protection against duplicates.

Never rely only on a frontend duplicate check or a prior `SELECT` to prevent concurrent duplicate inserts.

## Stock reduction

Use an atomic conditional update or lock the relevant stock row inside a transaction. Confirm the affected row count. Reject the operation when stock is insufficient or the lot/outlet does not match.

Never update stock without preserving stock movement history and the correct product, lot, outlet, and transaction references.

## FEFO

For expiry-sensitive pharmacy stock:

- Select eligible, non-expired lots.
- Order by earliest expiry date first.
- Consume from the earliest eligible lot.
- Continue to the next eligible lot when the first lot has insufficient quantity.
- Preserve lot-level price and expiry traceability.
- Keep the operation safe under concurrent sales.
- Do not change unrelated product selection behavior.

## Invoice numbering

- Enforce invoice uniqueness in PostgreSQL.
- Do not use an unsafe read-then-increment implementation.
- Use a sequence when gaps are acceptable.
- If a gapless or scoped counter is a strict business requirement, use a transactionally locked counter row and document its concurrency implications.
- Never reset production counters without explicit approval and a verified reconciliation plan.

# 12. Authentication and Authorization

Use Laravel's supported authentication mechanisms and the package already adopted by the project.

Possible options include:

- Laravel Sanctum for first-party SPA or token-based API authentication.
- Laravel Passport when OAuth2 authorization-server functionality is required.
- Laravel's built-in guards, policies, and gates.
- A compatible external identity provider where required.

Do not install multiple authentication systems without a clear requirement.

Requirements:

- Hash passwords using Laravel's supported hashing facilities.
- Use secure session and token handling.
- Apply authorization policies/gates consistently.
- Enforce role and permission checks on the backend.
- Validate tenant, facility, and resource ownership.
- Protect against IDOR and privilege escalation.
- Rate-limit sensitive endpoints.
- Use secure cookie, CORS, and CSRF configuration appropriate to the authentication model.
- Revoke tokens/sessions through the established workflow.
- Never trust frontend permission checks alone.

Never expose passwords, tokens, private keys, connection strings, or sensitive patient information.

# 13. Security Standards

Follow Laravel and OWASP security practices.

Check:

- SQL injection.
- Mass assignment.
- Broken access control.
- IDOR.
- XSS.
- CSRF where applicable.
- Unsafe file uploads.
- Path traversal.
- SSRF in external URL fetching.
- Rate limiting.
- Sensitive data exposure.
- Insecure deserialization.
- Dependency vulnerabilities.
- Debug mode and error disclosure.

Rules:

- Keep `APP_DEBUG=false` in production.
- Keep secrets in environment/secret-management configuration, not source control.
- Validate and authorize every file operation.
- Restrict file size, MIME type, extension, and storage location.
- Use private storage for sensitive documents.
- Do not trust client-supplied file names or paths.
- Use Laravel's escaped output by default; do not render untrusted HTML as raw output.
- Use parameterized database queries.
- Review `APP_KEY` handling and never rotate it casually on a live application.
- Use HTTPS in production.
- Apply least-privilege PostgreSQL roles.
- Avoid logging passwords, tokens, patient details, or financial secrets.

# 14. Exception Handling and Logging

Use Laravel's centralized exception handling and the project's logging configuration.

Rules:

- Do not swallow exceptions silently.
- Return consistent API errors.
- Do not expose stack traces or SQL details to clients.
- Log meaningful technical context.
- Include request/correlation identifiers where available.
- Avoid duplicate logging of the same exception at multiple layers.
- Never log secrets or unnecessary patient-sensitive information.
- Distinguish validation, authorization, not-found, conflict, and unexpected system errors.
- Preserve transaction rollback behavior.

Use structured logging through the configured Laravel logging channels. Use an external monitoring service only when configured and approved.

# 15. Queues, Events, Jobs, and Scheduling

Use Laravel queues, events, listeners, notifications, and scheduler where they fit the use case.

Rules:

- Make retryable jobs idempotent.
- Define sensible retry/backoff behavior.
- Set appropriate timeouts.
- Handle failed jobs and recovery.
- Prevent duplicate processing where required.
- Dispatch jobs after database commit when they depend on committed records.
- Avoid serializing large or sensitive model graphs into jobs.
- Reload required records safely inside the job.
- Use unique jobs or overlap prevention only when their semantics match the business operation.
- Do not use queues for simple synchronous operations without a clear reason.

For critical workflows, document what happens if a job fails after the database transaction commits.

# 16. Caching and Performance

Use Laravel cache facilities or Redis only when justified.

Rules:

- Define cache keys and expiration deliberately.
- Invalidate or update cache after relevant writes.
- Avoid stale stock, patient, billing, and financial data.
- Do not cache authorization decisions without a safe invalidation strategy.
- Use pagination for large result sets.
- Prevent N+1 queries.
- Avoid loading complete tables or unnecessary relationships.
- Use database indexes based on measured query plans.
- Use queue workers for suitable long-running tasks.
- Use Laravel Octane only when the deployment and application code are compatible with long-lived workers.
- Measure before optimizing.

Do not introduce caching that can return incorrect business balances or stale clinical information.

# 17. File Storage and Document Generation

Use Laravel filesystem abstractions and the project's existing storage provider.

- Store files outside the public web root when they are private.
- Use generated storage names rather than trusting client names.
- Validate uploads.
- Enforce access control on downloads.
- Use temporary signed URLs where supported and appropriate.
- Preserve document metadata and audit history.
- Avoid storing large files in PostgreSQL unless there is a clear reason.
- Use the project's established PDF/reporting library.
- Test generated documents against existing business and legal requirements.

# 18. Database Migrations and Seeders

Use Laravel migrations for version-controlled schema changes and manual PostgreSQL SQL scripts when explicitly requested.

Before creating a migration:

1. Inspect the current schema.
2. Check related migrations and existing production state.
3. Identify foreign-key dependencies.
4. Check data volume and locking risks.
5. Review Eloquent model and API dependencies.
6. Plan data backfills separately for large tables.
7. Define validation and rollback strategy.

Rules:

- Never use `migrate:fresh` or `migrate:refresh` against production.
- Never drop or recreate tables as a shortcut.
- Do not edit migrations already applied in shared environments; create a new migration.
- Use explicit foreign-key names when predictable naming is important.
- Add indexes based on query patterns.
- Check existing data before adding unique or not-null constraints.
- Avoid destructive `down()` methods that delete legitimate business data.
- Use seeders only for known reference or development data.
- Make seeders safe to rerun when appropriate.
- Do not seed fake patient or financial records into production.
- Do not run migrations automatically in production deployment without an approved release process.
- Use PostgreSQL-compatible SQL in raw migration statements.

For large tables, use staged migrations and batch backfills. Consider PostgreSQL lock behavior and online index creation requirements. Do not assume every migration can safely run in one transaction.

# 19. API Documentation and Observability

Follow the project's existing OpenAPI/Swagger documentation package and conventions.

Document:

- Endpoint purpose.
- Authentication requirements.
- Request parameters and body.
- Response schema.
- Validation errors.
- Authorization errors.
- Pagination.
- Relevant status codes.

Use Laravel health checks, structured logs, metrics, and tracing only through the existing or approved monitoring stack.

Do not introduce duplicate monitoring frameworks.

# 20. Testing and Regression Requirements

Use the project's existing Pest or PHPUnit setup.

Test meaningful behavior at the correct level:

- Unit tests for isolated domain/business rules.
- Feature tests for HTTP endpoints and middleware.
- Integration tests for PostgreSQL behavior.
- Authorization and tenant-isolation tests.
- Transaction rollback tests.
- Queue and event behavior tests.
- Regression tests for existing workflows.

For backend changes:

1. Run the affected test suite.
2. Run relevant static analysis and formatting tools if configured.
3. Test request validation.
4. Test authentication and authorization.
5. Verify PostgreSQL operations.
6. Verify rollback behavior.
7. Test duplicate submissions.
8. Test relevant failure scenarios.
9. Verify shared service consumers.
10. Perform targeted regression testing.

For critical stock and financial operations, include success, failure, rollback, duplicate, concurrency, and boundary-value tests.

Never claim tests passed unless they were actually executed. Clearly distinguish code review from executed tests.

# 21. Code Quality and Dependency Management

Before adding code:

1. Search for existing functionality.
2. Reuse existing services and contracts.
3. Prefer Laravel and PHP native functionality.
4. Check whether an installed Composer package already solves the problem.
5. Avoid unnecessary interfaces and abstractions.
6. Avoid duplicate helpers and validators.
7. Avoid unnecessary mapping layers.
8. Keep classes and methods focused.
9. Remove no existing code without checking consumers.

Rules:

- Follow PSR-12 and the project's formatter.
- Use strict typing where practical and consistent with the codebase.
- Use typed properties, parameters, and return types.
- Use PHP enums for finite domain states where appropriate.
- Use constructor injection for dependencies.
- Avoid excessive use of facades in domain/application logic.
- Avoid service locator patterns.
- Avoid global helper functions for complex business behavior.
- Do not add Composer packages unless justified.
- Review package maintenance, compatibility, security, and license before installation.
- Do not upgrade framework or dependency versions unnecessarily.

# 22. Nginx, PHP-FPM, and Linux Deployment

For Linux production deployments using Nginx and PHP-FPM:

- Point the Nginx document root to Laravel's `public/` directory only.
- Never expose the project root, `.env`, storage internals, or source files.
- Use a supported PHP-FPM version compatible with the Laravel release and dependencies.
- Configure PHP extensions required by Laravel and the installed packages.
- Set correct ownership and permissions for `storage/` and `bootstrap/cache/`.
- Do not make the entire application directory world-writable.
- Configure request body limits and upload limits deliberately.
- Configure HTTPS and secure headers.
- Keep secrets outside source control.
- Use production Composer installation options and do not install development dependencies in production.
- Run queue workers under a process supervisor such as systemd or Supervisor.
- Restart long-running workers after deployment when required.
- Configure scheduler execution using the Laravel scheduler's recommended deployment approach.
- Use health checks and log rotation.
- Maintain tested backup and restore procedures.
- Use graceful deployment and rollback procedures.

Do not expose PHP-FPM directly to the public internet.

# 23. Token Efficiency and Investigation

To reduce unnecessary context consumption:

- Read only relevant files.
- Inspect `composer.json` before assuming installed packages.
- Use targeted symbol and text searches.
- Avoid repeatedly reading unchanged code.
- Avoid dumping entire files.
- Avoid excessive parallel agents.
- Keep command output concise.
- Reuse verified dependency mappings.
- Inspect only affected API and database dependencies.
- Make focused changes.
- Record important architectural decisions in project documentation.

Do not sacrifice necessary investigation or testing to save tokens.

# 24. Existing Functionality Preservation

This is non-negotiable:

- Do not rewrite complete modules unnecessarily.
- Do not remove existing endpoints.
- Do not break API contracts.
- Do not change shared methods without consumer analysis.
- Do not remove existing business validations.
- Do not introduce duplicate business logic.
- Do not modify unrelated modules.
- Do not perform destructive database operations.
- Do not apply unapproved production database changes.
- Do not change financial, stock, or patient history behavior without explicit requirements and regression tests.

When modifying a shared service, identify and validate all affected consumers.

# 25. Implementation Completion Report

After implementation, summarize:

1. Laravel and PHP versions.
2. Modified files.
3. New or modified endpoints.
4. Architecture/module impact.
5. Business logic changes.
6. Database dependencies and migrations.
7. Validation and authorization changes.
8. Transaction and concurrency handling.
9. Security impact.
10. Build/static-analysis results where applicable.
11. Tests actually executed and their results.
12. Regression checks.
13. Remaining issues or unverified behavior.
14. Deployment and rollback notes where relevant.

Clearly distinguish generated migration files from migrations actually executed.

# Final Principles

- Use the latest Laravel version officially supported by the selected PHP runtime.
- Preserve existing architecture and API contracts.
- Use PostgreSQL-native database behavior.
- Reuse before rebuilding.
- Keep controllers thin.
- Keep business rules in the correct application/domain layer.
- Use transactions for atomic business operations.
- Protect financial, stock, and patient data integrity.
- Apply authentication and authorization on the backend.
- Test critical workflows and regressions.
- Make only necessary changes.
- Never claim success without verification.

**Priority:**

**Correctness > Security > Data Integrity > Reliability > Transaction Safety > Performance > Maintainability > Code Simplicity**

**Final principle:** Build secure Laravel applications. Preserve existing business behavior. Protect every transaction. Make only necessary changes.
