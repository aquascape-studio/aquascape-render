/**
 * Per-piece hardscape geometry cache (contract 1.3.0, key extended in 1.4.0).
 *
 * Key = id + seed + kind + woodStyle + role + sizeCm (0.1 cm) + quality +
 * resolved lean side (root wood only; "auto" resolves from the sign of x).
 * x / z / rotationY / buriedFrac are placement only (applied on the parent
 * group), so they never rebuild geometry. Changing one piece's shape inputs
 * rebuilds only that piece; its previous geometry is disposed.
 *
 * 1.4.1: every geometry built for a shape key is also remembered in a small
 * module-level shape store (LRU, CPU data only). The pure helpers
 * (hardscapeExtent → clampHardscapeXZ, hardscapeSurfaceY, hardscapeAnchors)
 * read their vertices from there, so they never rebuild a piece the renderer
 * already built, and the renderer clones a shape a helper built first.
 */
import type * as THREE from "three";
import type { HardscapeVisual } from "../contract.js";
import { makeStoneGeometry } from "./geometry.js";
import type { RenderQuality } from "./layout.js";
import { leanSideOf, makeWoodGeometry, woodStyleOf } from "./wood.js";

const r01 = (v: number) => Math.round((Number.isFinite(v) ? Math.abs(v) : 0) * 10);

/** Resolved lean side as a key fragment ("-" unless root wood). */
function leanKey(h: HardscapeVisual): string {
  return h.kind === "wood" && woodStyleOf(h.woodStyle) === "root" ? (leanSideOf(h) < 0 ? "L" : "R") : "-";
}

/** Shape key of a piece without its id (shared by identical shapes). */
export function hardscapeShapeKey(h: HardscapeVisual, quality: RenderQuality): string {
  const style = h.kind === "wood" ? woodStyleOf(h.woodStyle) : "-";
  const role = h.kind === "wood" ? "-" : (h.role ?? "-");
  return `${h.seed >>> 0}|${h.kind}|${style}|${role}|${r01(h.sizeCm[0])}|${r01(h.sizeCm[1])}|${r01(h.sizeCm[2])}|${quality}|${leanKey(h)}`;
}

/** Shape key of one piece (placement-independent; x matters only via the resolved lean side). */
export function hardscapeGeometryKey(h: HardscapeVisual, quality: RenderQuality): string {
  return `${h.id}|${hardscapeShapeKey(h, quality)}`;
}

/** Build a piece's geometry from its (rounded) shape inputs. */
export function buildHardscapeGeometry(h: HardscapeVisual, quality: RenderQuality): THREE.BufferGeometry {
  const size: [number, number, number] = [r01(h.sizeCm[0]) / 10, r01(h.sizeCm[1]) / 10, r01(h.sizeCm[2]) / 10];
  if (h.kind === "wood") return makeWoodGeometry(size, h.seed, h.woodStyle, quality, leanSideOf(h));
  return quality === "high" ? makeStoneGeometry(size, h.seed, h.role) : makeStoneGeometry(size, h.seed, h.role, 48, 32);
}

// ---------------------------------------------------------------------------
// Shape store (1.4.1)

/** Shapes remembered (one per shape key, i.e. per distinct piece shape). */
export const SHAPE_STORE_MAX = 32;
const shapes = new Map<string, THREE.BufferGeometry>();
/** Geometries the shape store had to build itself (store misses). */
export const shapeStoreStats = { builds: 0 };

/** Remember a built geometry for its shape key (CPU arrays only; never rendered from here). */
export function rememberShape(key: string, geo: THREE.BufferGeometry): void {
  shapes.delete(key);
  shapes.set(key, geo);
  if (shapes.size > SHAPE_STORE_MAX) shapes.delete(shapes.keys().next().value!);
}

/** A remembered geometry for this shape key, or undefined. */
export function peekShape(key: string): THREE.BufferGeometry | undefined {
  const g = shapes.get(key);
  if (g) {
    shapes.delete(key);
    shapes.set(key, g);
  }
  return g;
}

/** Forget every remembered shape (tests / benchmarks). */
export function clearShapeStore(): void {
  shapes.clear();
}

/**
 * Read-only geometry of h's shape (built once per shape key, then shared).
 * Callers must not dispose or mutate it; only its CPU arrays are used.
 */
export function shapeGeometry(h: HardscapeVisual, quality: RenderQuality): THREE.BufferGeometry {
  const key = hardscapeShapeKey(h, quality);
  const hit = peekShape(key);
  if (hit) return hit;
  const geo = buildHardscapeGeometry(h, quality);
  shapeStoreStats.builds++;
  rememberShape(key, geo);
  return geo;
}

interface Entry {
  key: string;
  geo: THREE.BufferGeometry;
}

export class HardscapeGeometryCache {
  private byId = new Map<string, Entry>();
  /** geometries built so far (cache misses) */
  builds = 0;

  constructor(private readonly build: (h: HardscapeVisual, q: RenderQuality) => THREE.BufferGeometry = buildHardscapeGeometry) {}

  /** Geometry for `h`; rebuilds (and disposes the old one) only when its key changed. */
  get(h: HardscapeVisual, quality: RenderQuality): THREE.BufferGeometry {
    const key = hardscapeGeometryKey(h, quality);
    const e = this.byId.get(h.id);
    if (e && e.key === key) return e.geo;
    const shapeKey = hardscapeShapeKey(h, quality);
    const known = this.build === buildHardscapeGeometry ? peekShape(shapeKey) : undefined;
    // a shape a pure helper already built is cloned (this cache owns and disposes its geometry)
    const geo = known ? known.clone() : this.build(h, quality);
    if (!known) rememberShape(shapeKey, geo);
    this.builds++;
    e?.geo.dispose();
    this.byId.set(h.id, { key, geo });
    return geo;
  }

  /** Drop pieces that are no longer present. */
  retain(ids: Iterable<string>): void {
    const keep = new Set(ids);
    for (const [id, e] of this.byId) {
      if (!keep.has(id)) {
        e.geo.dispose();
        this.byId.delete(id);
      }
    }
  }

  get size(): number {
    return this.byId.size;
  }

  dispose(): void {
    for (const e of this.byId.values()) e.geo.dispose();
    this.byId.clear();
  }
}
