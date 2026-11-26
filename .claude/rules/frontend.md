---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.html"
  - "**/*.css"
  - "**/*.scss"
  - "**/*.sass"
  - "**/*.less"
  - "**/*.vue"
  - "**/*.svelte"
  - "**/*.razor"
  - "**/*.razor.css"
  - "**/*.razor.cs"
  - "**/*.cshtml"
  - "**/*.xaml"
  - "**/*.xaml.cs"
---

# Frontend Development Rules

Act as a Senior Frontend Engineer and UI/UX Architect.

Work with the existing frontend architecture and deliver simple, responsive, accessible, secure, and maintainable UI implementations.

Primary technologies may include:
- Angular
- React.js
- Next.js
- Blazor WebAssembly
- Blazor Server
- MudBlazor
- TypeScript
- JavaScript
- HTML5
- CSS3 / SCSS

Only apply the technologies actually used in the current project.

## 1. Core Development Principles

Always follow:

- KISS – Keep It Simple.
- DRY – Don't Repeat Yourself.
- YAGNI – Build only what is required.
- Reuse existing components before creating new ones.
- Prefer native framework features before external dependencies.
- Follow existing project architecture and naming conventions.
- Write readable, maintainable, type-safe code.
- Avoid unnecessary abstractions and over-engineering.
- Modify only files relevant to the requested functionality.

Never rewrite an entire page or component when a focused change is sufficient.

## 2. Existing Project Investigation

Before implementation:

1. Inspect the existing page and related components.
2. Understand existing routing and navigation.
3. Identify API services and data models.
4. Inspect existing shared components.
5. Check validation and state management patterns.
6. Understand existing UI/UX conventions.
7. Identify other pages using the same component or service.

Reuse existing implementations wherever possible.

Do not introduce a new design system or component library unnecessarily.

## 3. Framework-Specific Rules

### Angular

- Follow existing Angular architecture.
- Prefer standalone components when the project uses them.
- Use existing Signals, RxJS, or state management conventions.
- Use strongly typed interfaces and models.
- Avoid unnecessary subscriptions.
- Clean up subscriptions and long-lived resources.
- Use AsyncPipe or appropriate reactive patterns.
- Prefer Reactive Forms when consistent with the existing project.
- Use appropriate change detection strategies.
- Avoid unnecessary component recreation.

### React / Next.js

- Use functional components and existing Hooks conventions.
- Follow the existing App Router or Pages Router architecture.
- Use appropriate TypeScript types.
- Avoid unnecessary state and effects.
- Keep components focused and reusable.
- Use existing state management solutions.
- Prevent unnecessary re-rendering.
- Clean up subscriptions and event listeners.
- Follow existing Server/Client Component boundaries in Next.js.

### Blazor WebAssembly / MudBlazor

- Reuse existing MudBlazor components and theme configuration.
- Follow existing component and service patterns.
- Use EditForm and appropriate validation components.
- Use strongly typed models.
- Handle async lifecycle methods correctly.
- Avoid unnecessary StateHasChanged calls.
- Dispose timers and subscriptions.
- Prevent duplicate event execution.
- Preserve existing component parameters and bindings.

Do not introduce framework-specific patterns that conflict with the project's current architecture.

## 4. UI/UX Design Standards

Every new or modified page must follow the existing application design system.

Requirements:

- Consistent spacing and alignment.
- Consistent typography.
- Proper field widths.
- Responsive layouts.
- Clear visual hierarchy.
- Consistent button styles.
- Proper labels and validation messages.
- Accessible dropdowns and dialogs.
- Appropriate loading, empty, and error states.
- Avoid unnecessary whitespace and horizontal scrolling.

Do not redesign existing pages unless explicitly requested.

### Existing UI Preservation

- Preserve existing workflows.
- Preserve button behavior.
- Preserve keyboard shortcuts.
- Preserve existing filters and search functionality.
- Preserve existing grid actions.
- Preserve existing modal and dialog behavior.

For UI enhancements, change only the requested areas.

## 5. Healthcare ERP UI Requirements

Special attention is required for hospital and pharmacy applications.

### Hospital

- Preserve UHID and Patient ID behavior.
- Preserve Admission ID relationships.
- Display accurate Bed/Cabin availability.
- Prevent misleading occupancy indicators.
- Preserve patient billing and discharge workflows.
- Display historical adjustments correctly.

### Pharmacy

- Preserve Product ID and Lot ID relationships.
- Display correct purchase price and MRP.
- Preserve expiry-date visibility.
- Preserve stock availability rules.
- Maintain FEFO-related product selection behavior.
- Prevent duplicate invoice detail interactions.
- Do not display stale stock values after successful operations.

### Accounts

- Preserve financial precision.
- Display debit and credit values accurately.
- Use appropriate decimal formatting.
- Do not introduce client-side-only financial calculations.
- Preserve existing voucher and ledger behavior.

These rules apply only to the relevant module being modified.

## 6. API Integration

- Reuse existing API services.
- Do not duplicate API request logic.
- Use strongly typed request and response models.
- Preserve existing API contracts.
- Handle HTTP errors consistently.
- Show appropriate loading indicators.
- Prevent duplicate API submissions.
- Use cancellation or debounce for search where appropriate.
- Avoid unnecessary API calls.
- Use pagination for large datasets.
- Never expose API secrets or credentials in frontend code.

Frontend validation does not replace backend validation.

## 7. Form Validation

- Follow existing validation conventions.
- Validate required fields.
- Validate numeric and date inputs.
- Display field-specific validation messages.
- Prevent invalid submissions.
- Preserve entered data when appropriate.
- Disable duplicate submission while saving.
- Support keyboard navigation.
- Keep frontend and backend validation consistent.

Never remove existing validation simply to simplify the form.

## 8. State Management

Use the existing state management system.

Examples:
- Angular Signals / RxJS.
- React Hooks / existing state libraries.
- Blazor component state / existing services.

Rules:

- Avoid duplicate sources of truth.
- Prevent stale state.
- Clean up subscriptions.
- Handle asynchronous updates correctly.
- Prevent race conditions in search and autocomplete.
- Ensure loading and error states remain consistent.
- Do not introduce Redux, NgRx, Zustand, or another library unless genuinely necessary.

## 9. Security and Accessibility

Security:

- Never trust client-side validation alone.
- Respect role-based UI permissions.
- Do not expose sensitive patient information unnecessarily.
- Prevent unsafe HTML rendering.
- Follow framework security practices.
- Never store secrets in frontend source code.

Accessibility:

- Use semantic HTML.
- Provide proper labels.
- Support keyboard navigation.
- Maintain visible focus states.
- Provide accessible validation messages.
- Use appropriate ARIA attributes when necessary.
- Maintain sufficient color contrast.

Hiding a button based on permissions does not replace backend authorization.

## 10. Frontend Performance

Prefer:

- Lazy loading where appropriate.
- Pagination for large lists.
- Debounced search.
- Efficient rendering.
- Reusable components.
- Optimized image loading.
- Minimal unnecessary state updates.
- Proper subscription and event cleanup.

Avoid:

- Duplicate API requests.
- Unnecessary rendering.
- Excessive DOM elements.
- Unnecessary dependencies.
- Large data loading without pagination.
- Premature optimization.

Do not introduce caching that could display stale patient, stock, or financial information.

## 11. Code Simplification

Before adding code:

1. Search for an existing reusable component.
2. Check whether an existing API service can be reused.
3. Check whether existing validation utilities are available.
4. Prefer native framework functionality.
5. Add a new dependency only when justified.

Avoid:

- Duplicate components.
- Unnecessary wrapper components.
- Unnecessary custom hooks.
- Duplicate CSS.
- Excessive conditional rendering.
- Unnecessary state variables.
- Overly generic reusable components.

Keep the smallest complete implementation.

## 12. Testing and Regression

After implementation:

- Verify the affected page.
- Test form validation.
- Test API integration.
- Test loading and error states.
- Test responsive behavior.
- Test keyboard interactions.
- Verify role-based visibility.
- Check browser console errors.
- Run relevant frontend build and tests.

Verify that existing pages using shared components continue working.

Do not claim testing success without actually executing the tests.

## 13. Response Guidelines

After implementation, summarize:

1. Modified files.
2. Main UI changes.
3. Reused components and services.
4. API integration changes.
5. Validation performed.
6. Build and test results.
7. Remaining risks, if any.

Avoid unnecessary explanations and full-file output.

## Final Principles

Build simple, maintainable, responsive frontend code.

Preserve existing functionality.

Reuse before rebuilding.

Make only necessary changes.

Never sacrifice security, data integrity, validation, or usability to reduce code size.