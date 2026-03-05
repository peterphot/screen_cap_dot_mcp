# Decisions: Click/Hover Visual Indicator Utility (PP-44)

## D-CLARIFY-001: Requirements provided via Linear ticket PP-44
- **Who decided**: user
- **What**: All requirements specified directly in ticket with explicit acceptance criteria
- **Why**: Ticket includes full design spec, file paths, function signatures, and test expectations
- **Alternatives**: Could have run interactive clarification
- **Context**: User provided ticket PP-44 with comprehensive spec and plan reference

## D-ORCH-001: Scale assessment — SMALL
- **Who decided**: claude
- **What**: Classified as SMALL (2 tasks): one test file + one implementation file
- **Why**: Single module with two exported functions, straightforward CSS-in-JS injection pattern
- **Alternatives**: MEDIUM (if cdp-helpers integration was in scope — that is PP-45)
- **Context**: PP-44 is scoped to the utility module only

## D-ORCH-002: Orchestration pattern — STANDARD
- **Who decided**: claude
- **What**: Using STANDARD sequential pattern
- **Why**: Only 2 dependent tasks (test then implement)
- **Alternatives**: PARALLEL or COUNCIL (not applicable for this size)

## D-IMPL-001: PageLike interface instead of Puppeteer Page type
- **Who decided**: claude
- **What**: Defined a minimal `PageLike` interface requiring only `evaluate()`
- **Why**: Avoids tight coupling to Puppeteer types; makes testing trivial with a plain mock object; matches how the page parameter will be used in cdp-helpers.ts (via `ensurePage()`)
- **Alternatives**: Import and use `Page` type from puppeteer-core directly
- **Context**: The module only needs `page.evaluate()`, so a minimal interface is sufficient

## D-IMPL-002: Single injection function with type parameter
- **Who decided**: claude
- **What**: Both `showClickIndicator` and `showHoverIndicator` delegate to a shared `injectIndicator` function with a type parameter ("click" or "hover")
- **Why**: Avoids code duplication; the indicators only differ in colors, sizes, and duration
- **Alternatives**: Two separate injection functions (more duplication, harder to maintain)
