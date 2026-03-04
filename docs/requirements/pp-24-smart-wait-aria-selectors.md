# Requirements: PP-24 Fix smart wait to use ARIA-based selectors

## Status: IN_PROGRESS

## Summary

Replace the 6 framework-specific CSS selectors in `src/util/wait-strategies.ts` with ARIA-based selectors that work across any web application. Add short-circuit logic to skip waiting when no loading indicators are present.

## Requirements

### REQ-1: Replace selectors with ARIA-based alternatives

Replace `LOADING_SELECTORS` array with a single combined ARIA + generic selector:

```typescript
const LOADING_SELECTOR = [
  '[role="progressbar"]',
  '[aria-busy="true"]',
  '[aria-label*="loading" i]',
  '[aria-label*="spinner" i]',
  '[class*="skeleton" i]',
  '[class*="loading" i]',
  '[class*="spinner" i]',
].join(", ");
```

**Acceptance criteria:**
- No framework-specific selectors (`.MuiLinearProgress-root`, `.ant-spin`, etc.)
- Uses ARIA attributes (`role`, `aria-busy`, `aria-label`)
- Case-insensitive class matching via `i` flag

### REQ-2: Short-circuit logic

Add a quick probe before the wait loop:
1. `const hasLoading = await page.$(LOADING_SELECTOR);`
2. If null (no loading indicator), skip directly to `waitForNetworkIdle`
3. If found, wait for it to disappear with `waitForSelector(LOADING_SELECTOR, { hidden: true })`
4. Then wait for network idle

**Acceptance criteria:**
- Fast return when no loading indicators present
- Still waits for disappearance when indicators are found

### REQ-3: Reduce probe timeout

Reduce `SELECTOR_PROBE_TIMEOUT` from 2000ms to 500ms.

**Acceptance criteria:**
- Probe timeout is 500ms (not 2000ms)

## Edge Cases

- No loading indicators on page: should fast-path to network idle
- All loading indicators disappear before probe: should proceed quickly
- Loading indicator appears and disappears during wait: handled by waitForSelector hidden
- Page crash during wait: error should propagate (not swallowed)

## In Scope / Out of Scope

### In Scope
- Replacing selectors in `src/util/wait-strategies.ts`
- Adding short-circuit logic to `smartWait()`
- Updating tests in `src/__tests__/wait-strategies.test.ts`
- Reducing probe timeout from 2000ms to 500ms

### Out of Scope
- Changing any other files
- Adding new dependencies
- Modifying the `SmartWaitResult` interface
- Changing network idle behavior
