/**
 * Iwagumi stone roles + bed placement (contract 1.1.0). Pure maths, no
 * three.js, so role ordering and burial are unit-testable.
 */
import type { HardscapeVisual, StoneRole } from "../contract.js";
import { substrateHeight, type SubstrateProfile } from "./layout.js";
import { rand } from "./rng.js";

export interface RoleShape {
  /** fraction of sizeCm[1] the stone actually stands (within its bounding box) */
  heightFrac: number;
  /** 0..1 how much narrower the top is than the base */
  taper: number;
  /** top asymmetry (peak shifted sideways), fraction of half-width */
  peak: number;
  /** total lean in radians (part forward towards the viewer, part sideways) */
  lean: number;
  /** number of softened facet planes */
  facets: number;
  /** soft-min sharpness: higher = crisper facet edges */
  crisp: number;
  /** vertical squash of the dome (1 = round top, < 1 = flatter) */
  dome: number;
}

const DEG = Math.PI / 180;

export const ROLE_SHAPES: Record<StoneRole | "none", RoleShape> = {
  // main stone: tallest, upright, tapering, clear sculptural planes
  oyaishi: { heightFrac: 1.0, taper: 0.42, peak: 0.2, lean: 7 * DEG, facets: 9, crisp: 34, dome: 1 },
  // secondary: a bit lower, broader shoulders
  fukuishi: { heightFrac: 0.84, taper: 0.3, peak: 0.16, lean: 4 * DEG, facets: 8, crisp: 30, dome: 0.95 },
  // support: lower and wider still
  soeishi: { heightFrac: 0.7, taper: 0.2, peak: 0.1, lean: 2.5 * DEG, facets: 8, crisp: 26, dome: 0.85 },
  // scattered: small, low, mostly hidden in the bed
  suteishi: { heightFrac: 0.55, taper: 0.12, peak: 0.05, lean: 0, facets: 7, crisp: 22, dome: 0.7 },
  // generic pebble (no role, 1.0.x behaviour family)
  none: { heightFrac: 1.0, taper: 0.15, peak: 0.08, lean: 0, facets: 6, crisp: 8, dome: 0.9 },
};

export const DEFAULT_BURIED_FRAC = 0.15;

export function roleShape(role: StoneRole | undefined): RoleShape {
  return ROLE_SHAPES[role ?? "none"] ?? ROLE_SHAPES.none;
}

export function buriedFrac(h: Pick<HardscapeVisual, "buriedFrac">): number {
  const b = h.buriedFrac;
  return typeof b === "number" && Number.isFinite(b) ? Math.min(0.6, Math.max(0, b)) : DEFAULT_BURIED_FRAC;
}

export interface StonePlacement {
  /** world y of the stone's lowest point (geometry spans 0..height) */
  bottomY: number;
  /** full stone height (incl. the buried part), cm */
  height: number;
  /** height visible above the local bed at the stone centre, cm */
  visibleHeight: number;
  /** forward (+z, towards the viewer) lean, rad — rotation about x */
  leanX: number;
  /** sideways lean, rad — rotation about z (leans towards the tank centre) */
  leanZ: number;
  /** footprint sample points [x, z] used for the bed test */
  footprint: [number, number][];
}

/**
 * Where a stone sits: its bottom is sunk `buriedFrac × height` below the LOCAL
 * bed at its centre and always below the lowest bed point under its
 * footprint, so on a steep slope it never perches on the uphill side.
 */
export function stonePlacement(h: HardscapeVisual, profile: SubstrateProfile): StonePlacement {
  const shape = h.kind === "wood" ? ROLE_SHAPES.none : roleShape(h.role);
  const [w, sh, d] = h.sizeCm;
  const height = Math.max(0.2, sh * shape.heightFrac);
  const buried = h.kind === "wood" ? 0 : buriedFrac(h);
  const cos = Math.cos(h.rotationY);
  const sin = Math.sin(h.rotationY);
  const footprint: [number, number][] = [[h.x, h.z]];
  let bedMin = Infinity;
  const rx = w * 0.45;
  const rz = d * 0.45;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const lx = Math.cos(a) * rx;
    const lz = Math.sin(a) * rz;
    // three.js rotation about y: x' = x cos + z sin, z' = −x sin + z cos
    const px = h.x + lx * cos + lz * sin;
    const pz = h.z - lx * sin + lz * cos;
    footprint.push([px, pz]);
  }
  for (const [px, pz] of footprint) bedMin = Math.min(bedMin, substrateHeight(profile, px, pz));
  const bedCenter = substrateHeight(profile, h.x, h.z);
  const side = h.x === 0 ? (rand(h.seed >>> 0, 7, 3) < 0.5 ? -1 : 1) : Math.sign(h.x);
  const leanX = shape.lean * 0.45;
  const leanZ = side * shape.lean;
  // tilting raises one edge of the base: sink by that amount too
  const leanSink = Math.sin(Math.abs(leanZ)) * w * 0.5 + Math.sin(leanX) * d * 0.5;
  const bottomY = Math.min(bedCenter - buried * height, bedMin - 0.04 * height - 0.15) - leanSink;
  return {
    bottomY,
    height,
    visibleHeight: bottomY + height - bedCenter,
    leanX: h.kind === "wood" ? 0 : leanX,
    leanZ: h.kind === "wood" ? 0 : leanZ,
    footprint,
  };
}
