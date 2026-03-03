# Requirements: PP-11 — ref-store module

## Overview
Create `src/ref-store.ts` — a module-level `Map<string, number>` mapping ref IDs ("e1", "e2", ...) to backendNodeId. This is the leaf module with zero dependencies that all other Phase 2 work builds on.

## Requirements

### R1: allocateRef(backendNodeId: number): string
- Assigns next sequential ref "eN" (e1, e2, e3, ...)
- Stores mapping from ref string to backendNodeId
- Returns the allocated ref string

### R2: resolveRef(ref: string): number | undefined
- Looks up backendNodeId for a given ref string
- Returns the backendNodeId if found
- Returns `undefined` if ref is stale or invalid

### R3: clearRefs(): void
- Resets the internal map (clears all mappings)
- Resets the counter back to 0
- Called on each snapshot and on navigation

### R4: hasRefs(): boolean
- Returns true if any refs have been allocated
- Returns false if no refs exist (or after clearRefs)

## Acceptance Criteria
- [AC1] `allocateRef` produces sequential "e1", "e2", "e3" refs
- [AC2] `resolveRef` correctly maps ref -> backendNodeId
- [AC3] `clearRefs` resets counter to 0 and clears all mappings
- [AC4] All unit tests pass

## Edge Cases
- Resolving an unknown/non-existent ref returns undefined
- After clearRefs, previously allocated refs are no longer resolvable
- After clearRefs, next allocation starts from "e1" again
- hasRefs returns false initially and after clearRefs

## In Scope / Out of Scope
- **In Scope**: The 4 exported functions, module-level state, unit tests
- **Out of Scope**: Integration with snapshot or navigation (will be done in subsequent tickets)

## Technical Constraints
- Module pattern: module-level singleton (not a class)
- Zero dependencies
- Named exports
- TypeScript strict mode, target ES2022, module NodeNext

## Test Plan (from ticket)
1. Test allocation produces sequential "e1", "e2", "e3"
2. Test resolve returns correct backendNodeId
3. Test resolve returns undefined for unknown ref
4. Test clearRefs resets counter and map
5. Test hasRefs returns correct boolean

Status: COMPLETED
