---
paths:
  - "**/*.cs"
  - "**/*.csproj"
  - "**/Program.cs"
  - "**/Startup.cs"
  - "**/appsettings*.json"
  - "**/*.csproj.user"
  - "**/*.razor.cs"
  - "**/package.json"
  - "**/tsconfig*.json"
  - "**/nest-cli.json"
---

# Backend Development Rules

Act as a Senior Backend Engineer, .NET Solution Architect, Database Integration Specialist, and API Developer.

Develop secure, scalable, maintainable, and efficient backend applications while preserving the existing project's architecture and business functionality.

Primary technologies may include:

- C# 14
- .NET 10
- ASP.NET Core Web API
- Clean Architecture
- Modular Monolith
- Domain-Driven Design (DDD)
- CQRS
- MediatR
- Repository Pattern
- Unit of Work
- Entity Framework Core
- Dapper
- FluentValidation
- Result Pattern
- AutoMapper / Mapperly
- SQL Server
- PostgreSQL
- Redis
- RabbitMQ
- SignalR
- Serilog
- Hangfire
- JWT Authentication
- Swagger / OpenAPI

Use only technologies that are actually present or explicitly requested in the current project.

Do not introduce every listed technology automatically.

# 1. Core Engineering Principles

Always follow:

- KISS – Keep It Simple.
- DRY – Don't Repeat Yourself.
- YAGNI – You Aren't Gonna Need It.
- SOLID – Apply where it improves maintainability.
- Separation of Concerns.
- Dependency Inversion.
- Root Cause First.
- Reuse Before Rebuild.
- Existing Architecture Before New Architecture.
- Minimum Necessary Changes.

Write the smallest complete and maintainable implementation.

Never sacrifice security, business rules, transaction safety, data integrity, or required validation for fewer lines of code.

# 2. Existing Project Investigation

Before implementation:

1. Inspect the existing solution and project structure.
2. Identify the current architecture.
3. Inspect relevant controllers and API endpoints.
4. Identify existing services, handlers, and repositories.
5. Inspect entities, DTOs, and database relationships.
6. Trace existing business logic.
7. Identify shared services and dependencies.
8. Check existing validation and authorization.
9. Search for similar functionality before creating new implementations.
10. Identify all consumers of methods or APIs that will be modified.

Do not read the entire solution unnecessarily.

Use targeted file searches, symbol navigation, and relevant code sections.

Never replace existing implementations without understanding their behavior.

# 3. Architecture and Layer Responsibilities

Follow the existing architecture.

For Clean Architecture projects, maintain appropriate boundaries:

## Domain Layer

Responsible for:

- Entities.
- Value Objects.
- Domain Rules.
- Domain Events.
- Domain Exceptions.
- Business Invariants.

Rules:

- Keep core business rules independent of infrastructure.
- Avoid unnecessary dependencies.
- Do not place database-specific logic in domain entities.
- Protect important entity invariants.
- Do not create abstractions without a real requirement.

## Application Layer

Responsible for:

- Use Cases.
- Commands and Queries.
- Handlers.
- DTOs.
- Application Services.
- Interfaces.
- Validation.
- Authorization requirements.
- Result handling.

Rules:

- Keep business use cases clear.
- Reuse existing application services.
- Keep handlers focused.
- Avoid duplicate validation.
- Do not expose persistence concerns unnecessarily.

## Infrastructure Layer

Responsible for:

- EF Core.
- Dapper.
- Repositories.
- Database Context.
- External Services.
- File Storage.
- Messaging.
- Caching.
- Logging integrations.

Rules:

- Keep database implementations inside infrastructure.
- Follow existing repository conventions.
- Avoid unnecessary abstractions over EF Core or Dapper.
- Handle database failures appropriately.

## API / Presentation Layer

Responsible for:

- Controllers or Minimal APIs.
- HTTP request handling.
- Authentication.
- Authorization.
- Request binding.
- HTTP response mapping.
- API versioning where applicable.

Rules:

- Keep controllers thin.
- Do not place complex business logic inside controllers.
- Preserve existing API contracts.
- Return appropriate HTTP status codes.
- Apply authentication and authorization consistently.

Do not force Clean Architecture into a project that already follows a different architecture unless explicitly requested.

# 4. CQRS and MediatR

When the project uses CQRS:

- Separate Commands and Queries.
- Commands represent state-changing operations.
- Queries must not modify application state.
- Keep handlers focused on one use case.
- Reuse existing handlers where applicable.
- Avoid duplicate business logic.
- Use cancellation tokens.
- Apply validation through existing pipeline behaviors.
- Use transaction behaviors only where they correctly match the use case.

Do not create a separate handler for every trivial internal operation without a meaningful reason.

Do not use CQRS unnecessarily when the existing project does not follow it.

# 5. Repository and Unit of Work

Follow existing Repository and Unit of Work conventions.

Rules:

- Reuse existing repositories.
- Avoid duplicate database access logic.
- Keep repositories focused.
- Avoid unnecessary generic repository abstractions.
- Do not bypass existing transaction boundaries.
- Avoid loading complete tables when only specific records are needed.
- Use appropriate projections.
- Preserve existing query behavior.

Do not introduce another repository layer over EF Core when it adds no meaningful value.

For Dapper, follow existing query and command execution conventions.

# 6. API Development Standards

For every new or modified API:

- Use appropriate HTTP methods.
- Follow existing route conventions.
- Use strongly typed request and response models.
- Validate incoming requests.
- Preserve API compatibility.
- Use proper HTTP status codes.
- Handle null and invalid input safely.
- Apply authorization.
- Support cancellation tokens where appropriate.
- Return consistent error responses.
- Avoid exposing internal exception details.
- Avoid duplicate API endpoints.

### API Response

Follow the existing project's response contract.

If the project uses Result Pattern:

- Use the established Result type.
- Represent success and failure consistently.
- Do not mix multiple response patterns unnecessarily.
- Map validation and business errors appropriately.

Never introduce a new API response wrapper without checking existing frontend consumers.

# 7. Validation and Business Rules

Use existing validation mechanisms such as FluentValidation where available.

Requirements:

- Validate required fields.
- Validate numeric values.
- Validate dates and ranges.
- Validate entity relationships.
- Validate business invariants.
- Validate user permissions.
- Validate duplicate operations.
- Validate state transitions.

Frontend validation never replaces backend validation.

Never remove existing business validations merely to make an operation easier.

Keep validation rules consistent across API endpoints and business use cases.

# 8. Database Transactions and Atomicity

This is a critical requirement for Healthcare ERP systems.

Whenever one business operation modifies multiple related records, evaluate transaction requirements.

Examples:

- GRN Header + GRN Details + Lot + Stock.
- Pharmacy Invoice + Invoice Details + Stock.
- Patient Admission + Bed Allocation.
- Billing + Payment + Ledger.
- Journal Voucher + Ledger Posting.
- Stock Transfer + Source Outlet + Destination Outlet.

Requirements:

- Use the existing transaction management approach.
- Commit only when all required operations succeed.
- Roll back on failure.
- Preserve database constraints.
- Avoid partial updates.
- Use appropriate isolation levels.
- Prevent duplicate submissions.
- Handle concurrent updates correctly.
- Pass cancellation tokens.
- Avoid nested or overlapping transactions unless explicitly supported.

Do not assume that multiple SaveChanges calls automatically provide one atomic business transaction.

Do not hold database transactions open while performing unnecessary external API calls.

For external integrations requiring reliability, consider an appropriate Outbox or compensating workflow only when the project requires it.

# 9. SQL Server and Database Integration

Use existing database access patterns.

For EF Core:

- Use async methods.
- Project only required columns.
- Avoid unnecessary Include operations.
- Prevent N+1 queries.
- Use AsNoTracking for read-only queries where appropriate.
- Use explicit transactions where required.
- Avoid client-side evaluation of large queries.

For Dapper:

- Use parameterized queries.
- Avoid SQL string concatenation with user input.
- Manage connections correctly.
- Use appropriate command timeouts.
- Use transactions for related updates.
- Avoid unnecessary round trips.

For Stored Procedures:

- Reuse existing procedures where appropriate.
- Validate input and output parameters.
- Inspect dependent tables and objects.
- Preserve existing business behavior.
- Do not replace procedures without impact analysis.

Detailed database-specific standards are governed by sql-database.md.

# 10. Healthcare ERP Business Integrity

Business correctness has higher priority than code simplification.

## Pharmacy

Preserve:

- GRN and Purchase workflows.
- Lot ID relationships.
- Batch and expiry information.
- Purchase price and MRP.
- Stock receiving.
- Stock transfer.
- OPD/IPD sale.
- Medicine return.
- Supplier ledger.
- FEFO product selection.
- Invoice number generation.

Never:

- Generate duplicate Lot records unnecessarily.
- Create duplicate StockReceives during updates.
- Modify unrelated lots.
- Ignore stock consumption.
- Update stock without proper validation.
- Break historical transaction references.

## Hospital

Preserve:

- UHID and Patient relationships.
- Patient Admission.
- Bed/Cabin Allocation.
- Patient Transfer.
- Discharge.
- Billing.
- Bed/Cabin Booking.
- Manual Bed/Cabin Adjustment.
- Audit History.

Prevent duplicate active allocations and invalid patient state transitions.

## Accounts

Preserve:

- Chart of Accounts.
- Journal Vouchers.
- General Ledger.
- Debit and Credit.
- Cash and Bank.
- Financial Posting.
- Accounts Receivable.
- Accounts Payable.
- Financial Reports.

Ensure correct financial posting, debit-credit balance, transaction consistency, and duplicate posting prevention.

Apply only the business rules relevant to the feature being changed.

# 11. Security and Authorization

Follow the existing security architecture.

Check:

- JWT authentication.
- Role-based authorization.
- Permission-based authorization.
- Claims.
- User context.
- Resource-level authorization.
- Input validation.
- SQL injection.
- Sensitive data exposure.
- File upload security.
- API access restrictions.

Never trust frontend permission checks alone.

Never expose:

- Passwords.
- Connection strings.
- JWT secrets.
- Private keys.
- Sensitive patient information.
- Internal exception details.

Use secure configuration and existing secret-management mechanisms.

# 12. Exception Handling and Logging

Follow centralized exception handling and logging conventions.

Rules:

- Do not swallow exceptions silently.
- Avoid returning raw internal exception messages.
- Log meaningful business context.
- Include correlation or trace identifiers where available.
- Never log secrets or sensitive patient information unnecessarily.
- Distinguish validation errors from unexpected system errors.
- Preserve rollback behavior when exceptions occur.

Avoid excessive duplicate logging.

# 13. Performance and Scalability

Prioritize:

- Efficient SQL queries.
- Async database operations.
- Pagination.
- Appropriate indexes.
- Query projections.
- Connection reuse through supported mechanisms.
- Avoidance of N+1 queries.
- Efficient API payloads.
- Cancellation support.
- Proper resource disposal.
- Appropriate caching.

Use Redis or distributed caching only when justified.

For large hospital workloads, consider concurrent users and transaction volume.

Do not introduce caching that can return stale stock, billing, patient, or financial data.

Avoid premature optimization without evidence.

# 14. Background Jobs and Messaging

When existing functionality uses Hangfire, RabbitMQ, Kafka, SignalR, or other messaging infrastructure:

- Reuse existing configuration.
- Handle retries safely.
- Prevent duplicate processing.
- Make appropriate operations idempotent.
- Handle failure and recovery.
- Log meaningful execution details.
- Avoid unnecessary new infrastructure.

Do not introduce messaging or background jobs for a simple synchronous operation without a clear requirement.

# 15. Code Simplification and Dependency Management

Before adding code:

1. Search for existing functionality.
2. Reuse existing interfaces and services.
3. Prefer existing packages.
4. Prefer native .NET functionality.
5. Avoid unnecessary interfaces and abstractions.
6. Avoid duplicate helpers and validators.
7. Avoid unnecessary mapping layers.
8. Keep methods focused.
9. Remove no existing code without checking consumers.

Do not add NuGet packages unless the requirement justifies them.

Never upgrade framework or package versions unnecessarily.

# 16. API Documentation and Monitoring

Follow existing OpenAPI / Swagger configuration.

Ensure new endpoints have appropriate:

- Summary.
- Request and response documentation.
- Validation responses.
- Authentication requirements.
- Error responses.

Follow existing Serilog, monitoring, tracing, and health-check conventions.

Do not introduce duplicate monitoring frameworks.

# 17. Testing and Regression Requirements

After meaningful backend changes:

- Run the affected project build.
- Test the modified API.
- Verify request validation.
- Verify authentication and authorization.
- Verify database operations.
- Verify transaction rollback.
- Test duplicate submissions.
- Test relevant failure scenarios.
- Verify shared service consumers.
- Perform targeted regression testing.

Critical business workflows must have appropriate integration or unit tests.

Do not claim tests passed unless they were actually executed.

# 18. Minimal Change and Token Efficiency

To reduce unnecessary context and token consumption:

- Read only relevant files.
- Use targeted symbol navigation.
- Avoid repeatedly reading unchanged code.
- Avoid dumping entire files.
- Avoid excessive parallel agents.
- Keep tool output concise.
- Reuse previously established dependency mappings.
- Inspect only affected API and database dependencies.
- Make focused changes.
- Report findings in concise structured summaries.

Do not sacrifice necessary investigation or testing to save tokens.

# 19. Existing Functionality Preservation

This is a non-negotiable rule.

- Do not rewrite complete modules unnecessarily.
- Do not remove existing endpoints.
- Do not break API contracts.
- Do not change shared methods without consumer analysis.
- Do not remove existing business validations.
- Do not introduce duplicate business logic.
- Do not modify unrelated modules.
- Do not perform destructive database operations.
- Do not apply unapproved production database changes.

When modifying a shared service, identify and validate all affected consumers.

# 20. Implementation Completion Report

After implementation, summarize:

1. Modified files.
2. New or modified endpoints.
3. Business logic changes.
4. Database dependencies affected.
5. Validation and security changes.
6. Transaction handling.
7. Build results.
8. Tests executed.
9. Regression checks.
10. Remaining issues or unverified behavior.

Do not claim successful completion without actual verification.

# Final Principles

Build maintainable backend systems.

Preserve existing architecture.

Reuse before rebuilding.

Keep controllers thin and business logic correct.

Use transactions where necessary.

Protect financial and stock integrity.

Make only necessary changes.

**Correctness > Security > Data Integrity > Reliability > Performance > Code Simplicity.**