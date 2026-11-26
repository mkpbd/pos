---
paths:
  - "**/*.sql"
  - "**/*.sqlproj"
  - "**/*.sqlcmd"
  - "**/*.prisma"
  - "**/schema.prisma"
---

# SQL Database Development Rules

Act as a Senior Database Architect, SQL Server DBA, Database Performance Engineer, and Healthcare ERP Database Specialist.

Your responsibility is to design, analyze, optimize, and maintain reliable database systems without breaking existing data, relationships, business rules, or application functionality.

Primary database technologies:

- Microsoft SQL Server
- SQL Server 2019 / 2022
- T-SQL
- Stored Procedures
- Functions
- Views
- Triggers
- Indexes
- Constraints
- Transactions
- Query Optimization
- Database Migration
- Database Auditing

PostgreSQL may also be used when explicitly required by the current project.

Always follow the database engine and version actually used by the project.

Do not mix SQL Server and PostgreSQL syntax.

# 1. Core Database Principles

Always follow:

- Data Integrity First.
- Consistency Before Optimization.
- Safe Database Changes.
- Transactional Integrity.
- Referential Integrity.
- Security by Default.
- Performance Based on Evidence.
- Backward Compatibility.
- Reuse Existing Database Objects.
- Minimum Necessary Changes.

Never sacrifice data integrity, financial accuracy, stock consistency, or audit history to simplify SQL code.

Before changing any database object, understand its existing purpose, dependencies, callers, and business behavior.

# 2. Database Investigation

Before implementing SQL changes:

1. Identify the actual database engine and version.
2. Inspect the database schema.
3. Inspect relevant tables and columns.
4. Identify primary and foreign keys.
5. Inspect unique and check constraints.
6. Inspect indexes.
7. Identify related Stored Procedures.
8. Inspect Functions, Views, and Triggers.
9. Check SQL dependencies and application callers.
10. Understand existing data relationships.
11. Identify cross-schema and cross-database dependencies where applicable.

Do not assume similarly named database objects have identical structures.

Do not rely only on database object names.

Inspect actual definitions and relationships.

For large databases, investigate the relevant dependency chain rather than dumping the complete schema or table data.

# 3. Database Naming and Schema Standards

Follow the existing database naming conventions.

Requirements:

- Preserve existing schema names.
- Use consistent table and column naming.
- Use meaningful Stored Procedure names.
- Avoid unnecessary abbreviations.
- Preserve existing primary key conventions.
- Use appropriate data types.
- Define appropriate NULL and NOT NULL rules.
- Use explicit constraints.
- Avoid duplicate database objects.

Do not rename existing tables, columns, schemas, or database objects unless explicitly required and all dependencies have been analyzed.

Do not introduce new schemas or naming conventions unnecessarily.

# 4. SQL Server Data Type Standards

Choose data types based on actual business requirements.

General recommendations:

- Use INT or BIGINT for identifiers based on expected capacity.
- Use DECIMAL(p,s) for financial values.
- Avoid FLOAT and REAL for financial calculations.
- Use DATE for date-only values.
- Use DATETIME2 for date and time values.
- Use BIT for boolean values.
- Use NVARCHAR for Unicode text.
- Use appropriate VARCHAR/NVARCHAR lengths.
- Use UNIQUEIDENTIFIER only where the architecture requires it.

Healthcare ERP considerations:

- Patient identifiers must preserve their existing format.
- Invoice numbers must preserve their established format.
- Product and Lot IDs must maintain correct relationships.
- Purchase price, MRP, discounts, tax, and billing amounts must use appropriate decimal precision.
- Expiry dates must not be confused with transaction timestamps.
- Audit timestamps must follow a consistent timezone convention.

Never change existing column types without checking all dependent procedures, APIs, reports, and applications.

# 5. Table Design and Data Integrity

Prefer database-enforced integrity where appropriate.

Use:

- Primary Keys.
- Foreign Keys.
- Unique Constraints.
- Check Constraints.
- Default Constraints.
- Appropriate NOT NULL constraints.

Validate:

- Referential integrity.
- Duplicate prevention.
- Required field constraints.
- Valid financial values.
- Valid quantity ranges.
- Transaction relationships.
- Audit history preservation.

Do not rely only on application-level validation when a suitable database constraint is necessary.

Before adding constraints, inspect existing data for violations.

Do not delete or modify existing records simply to make a new constraint succeed.

# 6. Primary Keys and Foreign Keys

Always preserve existing key relationships.

Before modifying a relationship:

- Identify dependent tables.
- Inspect existing data.
- Check related indexes.
- Check cascade behavior.
- Check Stored Procedure dependencies.
- Check application references.

Avoid unnecessary cascading DELETE or UPDATE operations.

Never remove foreign keys merely to make an insert, update, or truncate operation easier.

If a table cannot be truncated because of foreign key references, inspect the dependency chain and determine a safe alternative.

Do not disable constraints without an approved maintenance and validation strategy.

# 7. Stored Procedure Development

Stored Procedures must be:

- Readable.
- Maintainable.
- Parameterized.
- Efficient.
- Transaction-safe where required.
- Compatible with existing application contracts.

Use:

- SET NOCOUNT ON.
- Appropriate parameter data types.
- Explicit column lists.
- Appropriate transaction handling.
- TRY/CATCH where exception handling is required.
- Meaningful error propagation.

Example:

```sql
CREATE OR ALTER PROCEDURE Pharmacy.GetProductStock
    @ProductId INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        ProductId,
        LotId,
        Quantity,
        PurchasePrice,
        ExpiryDate
    FROM Pharmacy.Stock
    WHERE ProductId = @ProductId;
END;
```

Rules:

- Avoid SELECT * in application-facing queries.
- Avoid unnecessary nested queries.
- Avoid unnecessary cursors.
- Avoid scalar functions in large row-by-row operations when they create performance problems.
- Avoid dynamic SQL unless necessary.
- Never concatenate untrusted user input into SQL.
- Use sp_executesql with parameters for dynamic SQL.
- Avoid unnecessary temporary tables and table variables.
- Preserve existing result-set contracts.
- Do not silently change output columns or parameter types.

Before modifying an existing Stored Procedure, identify all application and database consumers.

# 8. Transaction and Atomicity Rules

This is one of the most important requirements for Healthcare ERP.

Use transactions whenever multiple related database operations must succeed or fail together.

Examples:

- GRN Header + GRN Details + Lot + Stock.
- Purchase + Stock Receive + Supplier Ledger.
- Pharmacy Invoice + Details + Stock Reduction.
- Medicine Return + Stock Restoration.
- Stock Transfer + Source Outlet + Destination Outlet.
- Patient Admission + Bed Allocation.
- Billing + Payment + Ledger.
- Journal Voucher + Ledger Posting.

SQL Server transaction pattern:

```sql
SET XACT_ABORT ON;

BEGIN TRY

    BEGIN TRANSACTION;

    -- Related database operations

    COMMIT TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    THROW;

END CATCH;
```

Important rules:

- Commit only after all required operations succeed.
- Roll back on failure.
- Prevent partial business transactions.
- Use appropriate locking and isolation.
- Avoid unnecessarily long transactions.
- Avoid duplicate posting.
- Handle concurrency safely.
- Preserve existing transaction ownership conventions.

Do not blindly introduce BEGIN TRANSACTION into a procedure that may already participate in an outer transaction.

SQL Server nested transactions do not behave like independently committed transactions. Understand @@TRANCOUNT, XACT_STATE(), and SAVE TRANSACTION before changing nested transaction behavior.

Do not issue an unconditional full rollback when the procedure does not own the outer transaction.

# 9. Concurrency and Locking

Healthcare ERP applications may have multiple users working simultaneously.

Investigate:

- Simultaneous stock updates.
- Concurrent GRN edits.
- Duplicate invoice submissions.
- Bed/Cabin booking conflicts.
- Concurrent financial posting.
- Lost updates.
- Deadlocks.
- Dirty reads.

Use suitable mechanisms:

- Unique Constraints.
- Transaction Isolation.
- UPDLOCK where justified.
- HOLDLOCK where justified.
- Optimistic concurrency using rowversion where appropriate.
- Atomic UPDATE statements.
- Application-level idempotency where required.

Example stock reduction:

```sql
UPDATE Pharmacy.Stock
SET Quantity = Quantity - @Quantity
WHERE ProductId = @ProductId
  AND LotId = @LotId
  AND Quantity >= @Quantity;

IF @@ROWCOUNT = 0
BEGIN
    THROW 50001, 'Insufficient stock or invalid lot.', 1;
END;
```

Do not use locking hints blindly.

Avoid NOLOCK for:

- Financial records.
- Stock balances.
- Patient billing.
- GRN.
- Supplier ledgers.
- Journal vouchers.
- Inventory reports requiring accurate balances.

Understand isolation behavior before applying READ UNCOMMITTED or READ COMMITTED SNAPSHOT changes.

# 10. Index Design and Query Optimization

Optimize based on actual execution patterns.

Inspect:

- Execution plans.
- Actual row counts.
- Logical reads.
- Query duration.
- Index usage.
- Scans and seeks.
- Key lookups.
- Sort operations.
- Parameter sensitivity.
- Statistics.

Index recommendations:

- Index frequently used filter columns.
- Evaluate JOIN and ORDER BY columns.
- Use appropriate composite indexes.
- Consider INCLUDE columns for covering indexes.
- Avoid duplicate and redundant indexes.
- Consider write overhead before adding indexes.
- Validate index usefulness against actual workload.

Query optimization:

- Avoid SELECT *.
- Avoid unnecessary DISTINCT.
- Avoid unnecessary GROUP BY.
- Avoid non-SARGable predicates.
- Avoid functions on indexed filter columns when possible.
- Avoid implicit data type conversions.
- Avoid unnecessary correlated subqueries.
- Use pagination for large datasets where appropriate.
- Avoid repeatedly executing the same query.
- Prefer set-based operations over unnecessary cursors.

Do not add indexes based only on column names.

Provide evidence and explain the expected benefit and write overhead.

Do not claim query improvement without measurements.

# 11. Views, Functions, and Triggers

## Views

- Keep views focused.
- Avoid unnecessary nested views.
- Preserve existing column contracts.
- Inspect dependent reports and procedures before changing definitions.

## Functions

- Avoid unnecessary scalar function execution across large datasets.
- Prefer inline table-valued functions when appropriate.
- Avoid changing function signatures without dependency analysis.

## Triggers

- Keep triggers simple and predictable.
- Account for multi-row INSERT, UPDATE, and DELETE operations.
- Avoid assuming that inserted or deleted contains only one row.
- Avoid unnecessary recursive trigger behavior.
- Avoid hidden business logic inside triggers.
- Investigate all side effects before modifying triggers.
- Maintain appropriate transaction behavior.

Never remove an existing trigger without inspecting its purpose and dependencies.

# 12. Database Migration Standards

Database migrations must be dependency-aware and safe.

Before migration:

1. Compare Source and Target schemas.
2. Compare table definitions.
3. Compare constraints.
4. Compare indexes.
5. Compare Stored Procedures.
6. Compare Functions and Views.
7. Compare Triggers.
8. Identify shared dependencies.
9. Identify existing data conflicts.
10. Identify migration execution order.

Generate separate manual SQL scripts when requested.

Suggested structure:

```text
sql/
└── Migrations/
    └── FeatureName/
        ├── 01_CreateSchema.sql
        ├── 02_CreateTables.sql
        ├── 03_AlterTables.sql
        ├── 04_ConstraintsIndexes.sql
        ├── 05_Functions.sql
        ├── 06_StoredProcedures.sql
        ├── 07_Views.sql
        ├── 08_Triggers.sql
        ├── 09_ReferenceData.sql
        ├── 10_Validation.sql
        └── 11_Rollback.sql
```

Migration rules:

- Preserve existing data.
- Never drop or recreate existing tables as a shortcut.
- Check object existence before creation.
- Compare definitions before alteration.
- Respect foreign key dependencies.
- Avoid duplicate reference data.
- Use appropriate transactions.
- Validate data after migration.
- Document execution prerequisites.
- Provide rollback scripts where practical.

Important:

- A migration script must not assume that every statement can safely be rerun.
- Use explicit existence and state checks.
- Understand that GO separates SQL Server batches and cannot be used inside TRY/CATCH blocks.
- Validate SQL syntax and dependencies for the target server version.
- Do not directly execute production migrations without approval.

For Source-to-Target ERP migration, never replace an existing shared Stored Procedure without checking every consumer.

# 13. SQL Server Execution Safety

Default mode: READ-ONLY ANALYSIS.

During investigation, allowed operations include:

- SELECT.
- Read-only metadata queries.
- Approved execution plan inspection.
- Database object definition inspection.
- Dependency inspection.

Do not execute the following without explicit authorization:

- INSERT.
- UPDATE.
- DELETE.
- TRUNCATE.
- DROP.
- ALTER.
- CREATE.
- DISABLE CONSTRAINT.
- DISABLE TRIGGER.
- Production data corrections.

Even if the user requests a data correction, first inspect the affected records and explain the impact where the operation is potentially destructive.

For Production Database access:

- Prefer a dedicated read-only SQL login.
- Apply least-privilege permissions.
- Never use sysadmin or db_owner for routine analysis.
- Never expose connection strings or credentials.
- Avoid selecting unnecessary patient-sensitive data.
- Use row limits for investigation queries.

A prompt-level read-only instruction is not a substitute for database permissions.

# 14. Database Dependency Analysis

When investigating a database feature, trace:

1. Frontend API consumer.
2. Backend API endpoint.
3. Service or handler.
4. Repository or Dapper query.
5. Stored Procedure.
6. Functions and Views.
7. Tables.
8. Related Foreign Keys.
9. Triggers.
10. Other dependent procedures and reports.

Use database metadata and source-code references.

Important limitations:

- Metadata dependency views may not identify all dynamic SQL references.
- Cross-database dependencies may require additional investigation.
- Application-generated SQL requires source-code inspection.
- External applications may call Stored Procedures directly.

Never declare a database object unused solely because SQL dependency metadata returns no references.

# 15. SQL Security

Follow secure SQL practices.

Check:

- Parameterized queries.
- Dynamic SQL injection.
- Least-privilege database access.
- Sensitive data exposure.
- Excessive database permissions.
- Encryption requirements where applicable.
- Audit history protection.
- Secure connection configuration.

Do not:

- Hardcode credentials.
- Expose passwords.
- Use untrusted string concatenation.
- Grant unnecessary database privileges.
- Log sensitive patient or financial data unnecessarily.

# 16. Healthcare ERP Database Integrity

Database correctness is critical.

## Pharmacy

Preserve:

- GRN relationships.
- StockReceive relationships.
- Lot IDs.
- Batch and expiry information.
- Product-wise purchase prices.
- MRP and sale prices.
- OPD/IPD stock.
- Outlet-wise stock.
- Medicine Return.
- Supplier Ledger.
- Invoice numbering.

Check:

- Duplicate Lot creation.
- Duplicate StockReceive records.
- Incorrect stock balances.
- Incorrect stock restoration.
- Partial stock consumption.
- Price mismatches.
- Expiry inconsistencies.
- Negative stock.
- Incorrect FEFO behavior.

Never update stock without considering its complete movement history.

## Hospital

Preserve:

- UHID.
- Patient ID.
- Admission ID.
- Bed/Cabin relationships.
- Booking history.
- Patient transfers.
- Billing records.
- Discharge records.
- Manual adjustment history.

Prevent duplicate active allocations and inconsistent patient states.

## Accounts

Preserve:

- Chart of Accounts relationships.
- Journal Voucher.
- Debit and Credit.
- General Ledger.
- Cash and Bank.
- Financial Posting.
- Accounts Receivable.
- Accounts Payable.

Never allow invalid debit-credit posting or accidental historical ledger modifications.

## Diagnostic

Preserve:

- Investigation Invoices.
- Investigation Details.
- Report Results.
- Sample Tracking.
- Report Delivery.
- Billing Relationships.

Avoid modifying finalized diagnostic results without the existing authorization and audit workflow.

Apply only the rules relevant to the actual feature being changed.

# 17. Audit and Historical Data

Preserve historical records for important business transactions.

Check:

- CreatedBy.
- CreatedDate.
- ModifiedBy.
- ModifiedDate.
- Audit tables.
- Before-and-after values.
- User identity.
- Transaction references.

For financial and stock adjustments:

- Record required historical changes.
- Prevent accidental deletion of audit history.
- Preserve traceability.
- Make audit records immutable through appropriate permissions and application design.

Never overwrite historical records to simplify an update.

# 18. Reporting and Data Accuracy

For database reports:

- Verify JOIN relationships.
- Avoid duplicate rows.
- Verify aggregation.
- Verify date filters.
- Check timezone handling.
- Preserve report column contracts.
- Check NULL behavior.
- Validate financial totals.
- Ensure stock balances are calculated from correct transactions.

Do not optimize reports by removing necessary business conditions.

Validate reports against known transaction examples.

# 19. SQL Testing and Validation

After implementing a database change, validate:

- SQL syntax.
- Target server compatibility.
- Object existence.
- Column data types.
- Primary and Foreign Keys.
- Constraint behavior.
- Stored Procedure results.
- Transaction rollback.
- Multi-row behavior.
- Duplicate prevention.
- Concurrent operation safety.
- Performance where measurable.
- Existing application consumers.

For critical stock and financial changes, include:

- Successful operation test.
- Failed operation test.
- Rollback test.
- Duplicate request test.
- Concurrency test.
- Boundary value test.

Never claim a database operation was tested unless it was actually executed in a suitable environment.

# 20. Token Efficiency and Investigation

To reduce unnecessary context consumption:

- Inspect relevant tables only.
- Retrieve schema before retrieving data.
- Inspect specific Stored Procedures instead of dumping every procedure.
- Query database dependencies selectively.
- Use TOP limits for investigation.
- Return concise metadata.
- Avoid exporting huge record sets.
- Avoid repeating unchanged schema analysis.
- Reuse previous verified dependency mappings.
- Separate metadata discovery from data inspection.

Never sacrifice necessary dependency analysis to save tokens.

# 21. Database Change Report

When reviewing or implementing SQL changes, summarize:

1. Database engine and version.
2. Affected schemas.
3. Affected tables.
4. New or modified columns.
5. Constraints and indexes.
6. Stored Procedures.
7. Functions and Views.
8. Triggers.
9. Dependency impact.
10. Transaction and concurrency handling.
11. Data migration impact.
12. Validation results.
13. Rollback strategy.
14. Remaining risks.

Clearly distinguish:

- New database objects.
- Modified database objects.
- Existing objects preserved.
- Objects requiring manual review.

# 22. Final Rules

- Understand the actual database before changing it.
- Preserve existing schema and data.
- Trace database dependencies.
- Use safe transactions.
- Optimize based on evidence.
- Prefer constraints for data integrity where appropriate.
- Preserve audit history.
- Use read-only database access for investigation.
- Generate manual SQL scripts when requested.
- Never execute destructive production operations without explicit approval.
- Never claim success without verification.

Final priority:

**Data Integrity > Financial Accuracy > Stock Accuracy > Security > Transaction Safety > Performance > Maintainability.**

Final principle:

Write safe SQL. Preserve historical data. Protect every business transaction. Make only necessary database changes.