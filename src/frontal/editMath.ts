/**
 * Pure maths for FrontalTank drag editing (contract 1.2.0). No three.js, no
 * DOM — unit-tested and shared by the WebGL controller and the halo.
 *
 *  • footprintContains — hardscape footprint ellipse test (public export)
 *  • clampToGlass      — positions kept 1 cm inside the glass
 *  • dragScale / dragPosition — screen drag → tank x/z in the fixed front view
 *  • plantPickShape / pickTarget — screen-space hit testing incl. the
 *    44 css px minimum hit target (22 px radius around the item centre)
 *  • DragSession       — start / move / end / cancel state machine
 */
import type { EditMoveEvent, EditTarget, HardscapeVisual, PlantVisual, SpeciesLook } from "../contract.js";
import { substrateHeight } from "./layout.js";
import { fitCamera, frontGlassRect, projectPoint, type Rect, type TankGeom } from "./tank.js";

// ---------------------------------------------------------------------------
// Footprint

/**
 * True when (x, z) lies inside h's footprint ellipse grown by `marginCm`
 * (default 0). Ellipse centred at (h.x, h.z), half-axes sizeCm[0]/2 along the
 * stone's local x and sizeCm[2]/2 along its local z, rotated by rotationY
 * (three.js convention: local (lx, lz) → world (lx·cos + lz·sin, −lx·sin + lz·cos)).
 * The margin grows both half-axes by `marginCm` (a negative margin shrinks).
 */
export function footprintContains(h: HardscapeVisual, x: number, z: number, marginCm = 0): boolean {
  const m = Number.isFinite(marginCm) ? marginCm : 0;
  const a = Math.abs(h.sizeCm[0]) / 2 + m;
  const b = Math.abs(h.sizeCm[2]) / 2 + m;
  if (!(a > 0) || !(b > 0)) return false;
  const dx = x - h.x;
  const dz = z - h.z;
  const r = Number.isFinite(h.rotationY) ? h.rotationY : 0;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  // inverse rotation: world → local
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  return (lx / a) ** 2 + (lz / b) ** 2 <= 1 + 1e-12;
}

// ---------------------------------------------------------------------------
// Clamping + drag mapping

/** Distance kept between an item's position and the glass (contract 1.2.0). */
export const GLASS_INSET_CM = 1;

export interface TankSize {
  w: number;
  d: number;
}

/** Clamp a position `inset` cm inside the glass (|x| ≤ w/2 − inset, |z| ≤ d/2 − inset). */
export function clampToGlass(t: TankSize, x: number, z: number, inset = GLASS_INSET_CM): { x: number; z: number } {
  const hx = Math.max(0, t.w / 2 - inset);
  const hz = Math.max(0, t.d / 2 - inset);
  const cx = Number.isNaN(x) ? 0 : x;
  const cz = Number.isNaN(z) ? 0 : z;
  return { x: Math.min(hx, Math.max(-hx, cx)), z: Math.min(hz, Math.max(-hz, cz)) };
}

/** Fraction of the visible tank height that maps onto the full tank depth. */
export const DEPTH_DRAG_FRACTION = 0.4;

export interface DragScale {
  /** cm of x per css px of horizontal pointer motion */
  cmPerPxX: number;
  /** cm of z per css px of vertical pointer motion (screen down = +z, front) */
  cmPerPxZ: number;
}

/**
 * Drag scale for the fixed front camera: dragging across the visible tank
 * width (projected front glass) moves the full width; dragging over 40% of
 * the visible tank height moves the full depth.
 */
export function dragScale(t: TankSize, glass: Rect): DragScale {
  return {
    cmPerPxX: t.w / Math.max(1, glass.width),
    cmPerPxZ: t.d / Math.max(1, glass.height * DEPTH_DRAG_FRACTION),
  };
}

/**
 * Proposed position after dragging by (dxPx, dyPx) css px from the pointer-down
 * point, starting at `origin`. Screen up (dyPx < 0) moves towards the back
 * glass (−z). Clamped 1 cm inside the glass.
 */
export function dragPosition(
  t: TankSize,
  scale: DragScale,
  origin: { x: number; z: number },
  dxPx: number,
  dyPx: number,
): { x: number; z: number } {
  return clampToGlass(t, origin.x + dxPx * scale.cmPerPxX, origin.z + dyPx * scale.cmPerPxZ);
}

// ---------------------------------------------------------------------------
// Picking

/** Below this projected size (css px) an item gets a radius hit target. */
export const MIN_HIT_PX = 44;
export const HIT_RADIUS_PX = MIN_HIT_PX / 2;

/** Screen-space pick shape of one item. */
export interface PickShape {
  target: EditTarget;
  /** projected bounds, css px */
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** projected centre, css px */
  cx: number;
  cy: number;
  /** "ellipse" = inscribed ellipse of the bounds (flat ground covers) */
  shape: "rect" | "ellipse";
  /** world z used for front-to-back ordering (larger = nearer the viewer) */
  z: number;
  /** only the small-target radius rule applies (direct hits come from elsewhere, e.g. a raycast) */
  radiusOnly?: boolean | undefined;
}

export interface PickHit {
  target: EditTarget;
  /** world z of the hit; larger wins */
  z: number;
  /** 0 for a direct hit, else screen distance to the item centre */
  dist: number;
}

function projectBox(
  g: TankGeom,
  width: number,
  height: number,
  x0: number, x1: number, y0: number, y1: number, z0: number, z1: number,
): { left: number; top: number; right: number; bottom: number } {
  const cam = fitCamera(g, width / Math.max(1, height));
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) {
    const [sx, sy] = projectPoint(cam, width, height, x, y, z);
    if (sx < left) left = sx;
    if (sx > right) right = sx;
    if (sy < top) top = sy;
    if (sy > bottom) bottom = sy;
  }
  return { left, top, right, bottom };
}

/** Plant forms laid out flat on the bed (picked by their projected footprint ellipse). */
function isGroundCover(look: SpeciesLook | undefined): boolean {
  const f = look?.growthForm;
  return f === "carpeting" || f === "moss" || f === "floating";
}

/**
 * Screen-space pick shape of a plant clump: the projected box
 * [x ± spread/2] × [base, base + height] × [z ± spread/2]; flat ground
 * covers use the inscribed ellipse so they don't swallow clicks on things
 * standing behind them.
 */
export function plantPickShape(
  g: TankGeom,
  width: number,
  height: number,
  p: PlantVisual,
  look: SpeciesLook | undefined,
): PickShape {
  const r = Math.max(0.5, p.spreadCm || 0) / 2;
  const H = Math.max(0.3, p.heightCm || 0);
  let y0: number;
  let y1: number;
  if (look?.growthForm === "floating") {
    y0 = g.waterY - 0.6;
    y1 = g.waterY;
  } else {
    y0 = substrateHeight(g.profile, p.x, p.z) + (p.y || 0);
    // the layout caps growth just under the water surface; so does the hit box
    y1 = Math.max(y0 + 0.3, Math.min(y0 + H, g.waterY - 0.8));
  }
  const ground = isGroundCover(look);
  const zr = ground ? r : r * 0.6; // upright clumps: stems sit within ~0.36 spread
  const b = projectBox(g, width, height, p.x - r, p.x + r, y0, y1, p.z - zr, p.z + zr);
  return {
    target: { kind: "plant", id: p.id },
    ...b,
    cx: (b.left + b.right) / 2,
    cy: (b.top + b.bottom) / 2,
    shape: ground ? "ellipse" : "rect",
    z: p.z,
  };
}

/**
 * Screen-space pick shape of a hardscape piece from its footprint ellipse
 * (axis-aligned bounds of the rotated ellipse) and visible height. Used for
 * hover and the small-target rule; precise stone hits come from a raycast.
 */
export function hardscapePickShape(
  g: TankGeom,
  width: number,
  height: number,
  h: HardscapeVisual,
  visibleTopY: number,
): PickShape {
  const a = h.sizeCm[0] / 2;
  const c = h.sizeCm[2] / 2;
  const cos = Math.cos(h.rotationY);
  const sin = Math.sin(h.rotationY);
  const ex = Math.hypot(a * cos, c * sin);
  const ez = Math.hypot(a * sin, c * cos);
  const bed = substrateHeight(g.profile, h.x, h.z);
  const b = projectBox(g, width, height, h.x - ex, h.x + ex, bed, Math.max(bed + 0.2, visibleTopY), h.z - ez, h.z + ez);
  return {
    target: { kind: "hardscape", id: h.id },
    ...b,
    cx: (b.left + b.right) / 2,
    cy: (b.top + b.bottom) / 2,
    shape: "rect",
    z: h.z,
  };
}

/** Hit test one shape at (px, py): direct hit, small-target radius hit, or null. */
export function hitShape(s: PickShape, px: number, py: number): PickHit | null {
  const w = s.right - s.left;
  const h = s.bottom - s.top;
  let inside: boolean;
  if (s.radiusOnly) {
    inside = false;
  } else if (s.shape === "ellipse") {
    const rx = Math.max(1e-6, w / 2);
    const ry = Math.max(1e-6, h / 2);
    inside = ((px - s.cx) / rx) ** 2 + ((py - s.cy) / ry) ** 2 <= 1;
  } else {
    inside = px >= s.left && px <= s.right && py >= s.top && py <= s.bottom;
  }
  if (inside) return { target: s.target, z: s.z, dist: 0 };
  if (Math.min(w, h) < MIN_HIT_PX) {
    const d = Math.hypot(px - s.cx, py - s.cy);
    if (d <= HIT_RADIUS_PX) return { target: s.target, z: s.z, dist: d };
  }
  return null;
}

/**
 * Choose among hits: the front-most item (largest z) wins; ties (within
 * 0.25 cm) go to the direct / closest hit.
 */
export function chooseHit(hits: readonly PickHit[]): EditTarget | null {
  let best: PickHit | null = null;
  for (const h of hits) {
    if (!best || h.z > best.z + 0.25 || (Math.abs(h.z - best.z) <= 0.25 && h.dist < best.dist)) best = h;
  }
  return best ? best.target : null;
}

/** Screen-space pick over shapes (plus optional precomputed hits, e.g. raycast). */
export function pickTarget(shapes: readonly PickShape[], px: number, py: number, extra: readonly PickHit[] = []): EditTarget | null {
  const hits: PickHit[] = [...extra];
  for (const s of shapes) {
    const h = hitShape(s, px, py);
    if (h) hits.push(h);
  }
  return chooseHit(hits);
}

/** Projected front glass for a canvas of width × height (re-exported for the controller). */
export function visibleGlass(g: TankGeom, width: number, height: number): Rect {
  return frontGlassRect(g, width, height);
}

// ---------------------------------------------------------------------------
// Drag session

/** Pointer travel (css px) before a press becomes a drag ("start"). */
export const DRAG_SLOP_PX = 4;

export type DragState = "pressed" | "dragging" | "ended" | "cancelled";

/**
 * One press → drag → release/cancel. Emits contract events; never moves
 * anything itself. `cancel()` reports the ORIGINAL position (unclamped, so
 * the caller can restore it exactly).
 */
export class DragSession {
  state: DragState = "pressed";
  last: { x: number; z: number };
  constructor(
    readonly target: EditTarget,
    readonly origin: { x: number; z: number },
    readonly startPx: { x: number; y: number },
    readonly tank: TankSize,
    readonly scale: DragScale,
    readonly slopPx = DRAG_SLOP_PX,
  ) {
    this.last = clampToGlass(tank, origin.x, origin.z);
  }

  private at(px: number, py: number): { x: number; z: number } {
    return dragPosition(this.tank, this.scale, this.origin, px - this.startPx.x, py - this.startPx.y);
  }

  /**
   * Pointer moved. Returns the events to emit now ("start" once the slop is
   * exceeded, then "move"). Callers throttle "move" to one per frame by only
   * forwarding the latest.
   */
  move(px: number, py: number): EditMoveEvent[] {
    if (this.state === "pressed") {
      if (Math.hypot(px - this.startPx.x, py - this.startPx.y) < this.slopPx) return [];
      this.state = "dragging";
      const start: EditMoveEvent = { target: this.target, phase: "start", x: this.last.x, z: this.last.z };
      this.last = this.at(px, py);
      return [start, { target: this.target, phase: "move", x: this.last.x, z: this.last.z }];
    }
    if (this.state !== "dragging") return [];
    this.last = this.at(px, py);
    return [{ target: this.target, phase: "move", x: this.last.x, z: this.last.z }];
  }

  /** Pointer released. "end" only if a drag actually started. */
  end(px?: number, py?: number): EditMoveEvent | null {
    if (this.state !== "dragging") {
      if (this.state === "pressed") this.state = "ended";
      return null;
    }
    this.state = "ended";
    if (px !== undefined && py !== undefined) this.last = this.at(px, py);
    return { target: this.target, phase: "end", x: this.last.x, z: this.last.z };
  }

  /** Escape / pointercancel. "cancel" with the ORIGINAL x/z, only if dragging. */
  cancel(): EditMoveEvent | null {
    if (this.state !== "dragging") {
      if (this.state === "pressed") this.state = "cancelled";
      return null;
    }
    this.state = "cancelled";
    return { target: this.target, phase: "cancel", x: this.origin.x, z: this.origin.z };
  }

  get active(): boolean {
    return this.state === "pressed" || this.state === "dragging";
  }
}
