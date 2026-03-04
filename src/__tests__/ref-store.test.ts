/**
 * Unit tests for ref-store module (src/ref-store.ts)
 *
 * Tests the module-level Map<string, number> that maps ref IDs ("e1", "e2", ...)
 * to backendNodeId values. This is a pure logic module with zero dependencies.
 *
 * Covers:
 * - allocateRef produces sequential "e1", "e2", "e3" refs
 * - resolveRef returns correct backendNodeId
 * - resolveRef returns undefined for unknown ref
 * - clearRefs resets counter and map
 * - hasRefs returns correct boolean
 * - resolveRefMetadata returns metadata for valid refs
 * - resolveRefMetadata returns undefined for invalid refs
 * - getAllRefs returns a snapshot copy of the map
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  allocateRef,
  resolveRef,
  resolveRefMetadata,
  getAllRefs,
  clearRefs,
  hasRefs,
} from "../ref-store.js";

beforeEach(() => {
  clearRefs();
});

// ── allocateRef() ──────────────────────────────────────────────────────

describe("allocateRef", () => {
  it("produces sequential refs e1, e2, e3", () => {
    const r1 = allocateRef(100);
    const r2 = allocateRef(200);
    const r3 = allocateRef(300);

    expect(r1).toBe("e1");
    expect(r2).toBe("e2");
    expect(r3).toBe("e3");
  });

  it("allocates distinct refs even for duplicate backendNodeIds", () => {
    const r1 = allocateRef(42);
    const r2 = allocateRef(42);
    expect(r1).toBe("e1");
    expect(r2).toBe("e2");
    expect(resolveRef("e1")).toBe(42);
    expect(resolveRef("e2")).toBe(42);
  });

  it("throws RangeError for negative backendNodeId", () => {
    expect(() => allocateRef(-1)).toThrow(RangeError);
    expect(() => allocateRef(-1)).toThrow("Invalid backendNodeId: -1");
  });

  it("throws RangeError for non-integer backendNodeId", () => {
    expect(() => allocateRef(1.5)).toThrow(RangeError);
    expect(() => allocateRef(1.5)).toThrow("Invalid backendNodeId: 1.5");
  });

  it("throws RangeError for NaN backendNodeId", () => {
    expect(() => allocateRef(NaN)).toThrow(RangeError);
    expect(() => allocateRef(NaN)).toThrow("Invalid backendNodeId: NaN");
  });
});

// ── resolveRef() ───────────────────────────────────────────────────────

describe("resolveRef", () => {
  it("returns correct backendNodeId for allocated ref", () => {
    allocateRef(42);
    allocateRef(99);

    expect(resolveRef("e1")).toBe(42);
    expect(resolveRef("e2")).toBe(99);
  });

  it("returns undefined for unknown ref", () => {
    expect(resolveRef("e999")).toBeUndefined();
    expect(resolveRef("bogus")).toBeUndefined();
    expect(resolveRef("")).toBeUndefined();
  });
});

// ── clearRefs() ────────────────────────────────────────────────────────

describe("clearRefs", () => {
  it("resets counter and map", () => {
    allocateRef(10);
    allocateRef(20);

    clearRefs();

    // Previously allocated refs are gone
    expect(resolveRef("e1")).toBeUndefined();
    expect(resolveRef("e2")).toBeUndefined();

    // Counter resets — next allocation starts at e1 again
    const ref = allocateRef(30);
    expect(ref).toBe("e1");
    expect(resolveRef("e1")).toBe(30);
  });
});

// ── hasRefs() ──────────────────────────────────────────────────────────

describe("hasRefs", () => {
  it("returns false when no refs allocated", () => {
    expect(hasRefs()).toBe(false);
  });

  it("returns true after allocating refs", () => {
    allocateRef(1);
    expect(hasRefs()).toBe(true);
  });

  it("returns false after clearRefs", () => {
    allocateRef(1);
    clearRefs();
    expect(hasRefs()).toBe(false);
  });
});

// ── resolveRefMetadata() ──────────────────────────────────────────────

describe("resolveRefMetadata", () => {
  it("returns metadata with backendNodeId for valid ref", () => {
    allocateRef(42);
    allocateRef(99);

    const meta1 = resolveRefMetadata("e1");
    expect(meta1).toEqual({ backendNodeId: 42 });

    const meta2 = resolveRefMetadata("e2");
    expect(meta2).toEqual({ backendNodeId: 99 });
  });

  it("returns undefined for unknown ref", () => {
    expect(resolveRefMetadata("e999")).toBeUndefined();
    expect(resolveRefMetadata("bogus")).toBeUndefined();
    expect(resolveRefMetadata("")).toBeUndefined();
  });

  it("returns undefined after clearRefs", () => {
    allocateRef(42);
    clearRefs();
    expect(resolveRefMetadata("e1")).toBeUndefined();
  });
});

// ── getAllRefs() ───────────────────────────────────────────────────────

describe("getAllRefs", () => {
  it("returns a copy of all ref mappings", () => {
    allocateRef(10);
    allocateRef(20);
    allocateRef(30);

    const snapshot = getAllRefs();

    expect(snapshot).toBeInstanceOf(Map);
    expect(snapshot.size).toBe(3);
    expect(snapshot.get("e1")).toBe(10);
    expect(snapshot.get("e2")).toBe(20);
    expect(snapshot.get("e3")).toBe(30);
  });

  it("returns empty map when no refs allocated", () => {
    const snapshot = getAllRefs();
    expect(snapshot).toBeInstanceOf(Map);
    expect(snapshot.size).toBe(0);
  });

  it("returned map is a snapshot — mutations do not affect internal store", () => {
    allocateRef(42);

    const snapshot = getAllRefs();
    snapshot.set("e999", 999);
    snapshot.delete("e1");

    // Internal store should be unaffected
    expect(resolveRef("e1")).toBe(42);
    expect(resolveRef("e999")).toBeUndefined();
  });
});
