---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.css"
---

# Frontend Development Rules

Act as a Senior Frontend Engineer and UI/UX Architect.

Work with the existing frontend architecture and deliver simple, responsive, accessible, secure, and maintainable UI implementations.

Primary technologies:
- React.js
- Inertia.js (`@inertiajs/react`)
- TypeScript / JavaScript
- Tailwind CSS
- shadcn/ui
- daisyUI

Only apply the technologies and patterns actually used in the current project.

## 1. Core Development Principles

Always follow:

- **KISS** – Keep It Simple.
- **DRY** – Don't Repeat Yourself.
- **YAGNI** – Build only what is required.
- Reuse existing components before creating new ones.
- Prefer native React and Inertia.js features before adding external dependencies.
- Follow existing project architecture, folder structure, and naming conventions.
- Write readable, maintainable, type-safe code.
- Avoid unnecessary abstractions and over-engineering.
- Modify only files relevant to the requested functionality.

Never rewrite an entire page or component when a focused change is sufficient.

## 2. Existing Project Investigation

Before implementation:

1. Inspect the target Inertia page (`resources/js/pages/...` or `inertia/pages/...`) and related components.
2. Understand existing Inertia routing, layout persistence, and shared props (`usePage().props`).
3. Identify backend controllers/routes, form request contracts, and TypeScript data models.
4. Inspect existing shared components and `components/ui` primitives.
5. Check validation and state management patterns (`useForm`, `router`).
6. Understand existing UI/UX conventions (shadcn/ui vs. daisyUI boundaries).
7. Identify other pages using the same shared component or layout.

Reuse existing implementations wherever possible.

Do not introduce a new design system or component library unnecessarily.

## 3. Framework & Stack-Specific Rules

### React.js

- Use functional components and standard React Hooks conventions.
- Use strict TypeScript interfaces/types for page props, form data, and shared entities.
- Avoid unnecessary `useState` and `useEffect` (derive state during render whenever possible).
- Keep components focused, small, and reusable.
- Prevent unnecessary re-rendering.
- Clean up event listeners, timers, and subscriptions properly.

### Inertia.js (`@inertiajs/react`)

- Use `<Link>` for internal navigation instead of standard `<a>` tags to preserve SPA behavior.
- Use `useForm` for form state, submission, progress tracking, and server validation errors.
- Use `router.get` / `router.visit` with `preserveState: true`, `preserveScroll: true`, and `only: [...]` for filtering, searching, and pagination.
- Access global data (auth user, flash messages, permissions) via typed `usePage().props`.
- Use persistent layouts (`Page.layout = ...`) where appropriate to avoid remounting shared navigation.
- Do not build separate REST/Axios fetching layers for data that Inertia already provides via page props.

### Tailwind CSS, shadcn/ui & daisyUI

- **Clear Separation of Concerns:**
  - Use **shadcn/ui** (`@/components/ui/*`) for complex interactive, accessible primitives (Dialogs, Sheets, DropdownMenus, Popovers, Comboboxes, Data Tables, Form Inputs).
  - Use **daisyUI** for rapid static/semantic UI blocks (`stats`, `badge`, `alert`, `breadcrumbs`, `steps`, `card`, `drawer`) and theme management.
  - Use **Tailwind CSS** utility classes for layout, grid/flex alignment, spacing, and responsive breakpoints.
- **No Component Mixing:** Never apply daisyUI component classes (e.g., `btn`, `input`, `select`) onto shadcn/ui components (`<Button>`, `<Input>`, `<Select>`). Keep one consistent pattern per element type.
- Respect existing CSS variable scopes (`@theme` and `@plugin "daisyui"` prefix rules if configured in `app.css`).

## 4. UI/UX Design Standards

Every new or modified page must follow the existing application design system.

Requirements:

- Consistent spacing and alignment.
- Consistent typography and hierarchy.
- Proper field widths and form layouts.
- Mobile-first responsive layouts.
- Consistent button styles and variants.
- Proper `<Label>` associations and inline validation messages.
- Accessible modals, dialogs, and dropdowns.
- Appropriate loading (`processing` / skeleton), empty, and error states.
- Avoid unnecessary whitespace and horizontal scrolling.

Do not redesign existing pages unless explicitly requested.

### Existing UI Preservation

- Preserve existing Inertia workflows and redirect behaviors.
- Preserve button behavior and shortcuts.
- Preserve existing filters, query parameters, and search functionality.
- Preserve existing table/grid actions and pagination state.
- Preserve existing modal and dialog behavior.

For UI enhancements, change only the requested areas.

## 5. Domain-Specific ERP UI Requirements (If Applicable)

Apply these rules only when working on Hospital, Pharmacy, or Accounts modules:

### Sales
- Sale priority.
- Return policy.
- Customer segmentation.
- Take profit margins.
- Display historical adjustments accurately.

### Accounts
- Preserve financial precision and appropriate decimal formatting.
- Display debit and credit values accurately.
- Never rely on client-side-only financial calculations; trust server-computed totals.
- Preserve existing voucher and ledger behavior.

## 6. Data Fetching, Partial Reloads & Mutations

- Rely on Inertia props as the primary data source.
- Use Inertia partial reloads (`only: ['items']`) to avoid over-fetching during search/filter updates.
- Debounce search inputs before triggering `router.get(...)`.
- Disable submit buttons using `form.processing` to prevent duplicate submissions.
- Handle flash messages and HTTP/validation errors consistently.
- Never expose API keys, secrets, or sensitive credentials in frontend code.

Frontend validation does not replace backend validation.

## 7. Form Validation

- Use Inertia's `useForm` `errors` object as the authoritative source for server validation messages.
- Display field-specific error messages directly below the corresponding input (`aria-invalid={!!errors.field}`).
- Validate required fields, numeric ranges, and date inputs cleanly on the client when appropriate.
- Preserve entered user data on validation failure.
- Disable duplicate submissions while `processing` is `true`.
- Support full keyboard navigation (Enter to submit, Escape to close dialogs).

Never remove existing validation rules simply to simplify a form.

## 8. State Management

- Use Inertia `useForm` for form state.
- Use URL query parameters + Inertia `router.get` for table filters, sorting, and pagination state.
- Use local React state (`useState`) only for ephemeral UI state (e.g., modal open/close, active tab).
- Avoid duplicate sources of truth or stale state after mutations.
- Do not introduce Redux, Zustand, or React Query unless explicitly required by the project architecture.

## 9. Security and Accessibility

### Security
- Never trust client-side validation alone.
- Respect role-based UI permissions passed via Inertia shared props (while remembering backend policies enforce real authorization).
- Never render unsanitized HTML (`dangerouslySetInnerHTML`).
- Never store secrets or tokens in frontend code.

### Accessibility
- Use semantic HTML (`<main>`, `<nav>`, `<section>`, `<header>`, `<table>`).
- Associate every input with an accessible `<Label htmlFor="...">`.
- Maintain visible focus rings (`focus-visible`).
- Ensure sufficient color contrast across both light and dark daisyUI/shadcn themes.
- Provide screen-reader friendly status alerts (`role="alert"`).

## 10. Frontend Performance

Prefer:
- Inertia partial reloads (`only: [...]`) for filter/pagination updates.
- Server-side pagination for large datasets.
- Debounced search queries (`300ms–500ms`).
- Code splitting / lazy loading for heavy dialogs or charts when appropriate.
- Reusing existing UI primitives.

Avoid:
- Full page reloads when `<Link>` or `router` visits suffice.
- Unnecessary `useEffect` chains syncing props to state.
- Large unpaginated lists in the DOM.
- Caching stale financial, patient, or inventory data in client memory.

## 11. Code Simplification

Before adding code:
1. Search for an existing component in `components/shared` or `components/ui`.
2. Check existing layouts and shared Inertia page props.
3. Check existing TypeScript types and utility helpers (`lib/utils.ts`).
4. Prefer native React + Inertia patterns before adding packages.

Avoid:
- Duplicate components or duplicate CSS rules.
- Unnecessary wrapper components or custom hooks.
- Mixing shadcn/ui and daisyUI classes on the same element.
- Overly generic abstractions.

Keep the smallest complete implementation.

## 12. Testing and Regression

After implementation:
- Verify the affected Inertia page and shared layout.
- Test form submission, validation error rendering, and `processing` states.
- Test search, filters, and pagination with `preserveState` / `preserveScroll`.
- Test responsive breakpoints (mobile, tablet, desktop) and dark/light themes.
- Test keyboard navigation and focus management in dialogs/dropdowns.
- Verify role-based visibility and browser console cleanliness.
- Run TypeScript type-check (`tsc --noEmit`) and production build (`npm run build`).

Do not claim testing success without actually executing the checks.

## 13. Response Guidelines

After implementation, summarize:
1. Modified or created files.
2. Main UI and Inertia integration changes.
3. Reused components (`shadcn/ui`, `daisyUI`, shared components).
4. Validation and state handling applied.
5. Build and type-check results.
6. Remaining risks, if any.

Avoid unnecessary explanations and full-file output unless requested.

## Final Principles

Build simple, maintainable, responsive frontend code.

Preserve existing functionality.

Reuse before rebuilding.

Make only necessary changes.

Never sacrifice security, data integrity, validation, or usability to reduce code size.