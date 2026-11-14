/**
 * Pure tank geometry, front camera fit, front-glass projection and
 * composition-guide maths for FrontalTank. No three.js dependency so it is
 * unit-testable and shared by the WebGL scene and the HTML guide overlay.
 */
import type { CompositionGuide, FrontalTankProps } from "../contract.js";
import type { SubstrateProfile } from "./layout.js";

export interface TankGeom {
  w: number;
  d: number;
  h: number;
  /** glass floor depth below the substrate surface y=0 at the front glass */
  floor: number;
  waterY: number;
  topY: number;
  profile: SubstrateProfile;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Tank geometry. Without `bed` this is byte-for-byte the 1.0.1 default.
 * With `bed {frontCm, backCm}` (heights above the glass floor at the front /
 * back glass) the front edge thickness becomes `frontCm` and the bed rises by
 * `backCm − frontCm` towards the back. y = 0 stays the substrate surface at
 * the front glass, as in the sim-core coordinate frame.
 */
export function tankGeom(t: FrontalTankProps["tank"], bed?: FrontalTankProps["bed"]): TankGeom {
  const w = Math.max(10, t.widthCm);
  const d = Math.max(8, t.depthCm);
  const h = Math.max(8, t.heightCm);
  let floor = Math.min(4, Math.max(1.5, h * 0.08));
  let back = Math.min(d * 0.2, h * 0.18);
  if (bed && finite(bed.frontCm) && finite(bed.backCm)) {
    floor = clamp(bed.frontCm, 0.5, h * 0.4);
    const backAbs = clamp(bed.backCm, 0.5, h * 0.6);
    back = backAbs - floor;
  }
  const topY = h - floor;
  return {
    w,
    d,
    h,
    floor,
    topY,
    waterY: topY - Math.min(2, h * 0.05),
    profile: { front: 0, back, depthCm: d, widthCm: w },
  };
}

export const CAMERA_FOV = 24;

export interface CameraFit {
  fov: number;
  aspect: number;
  /** camera position; it looks straight down −z */
  x: number;
  y: number;
  z: number;
}

/** Straight-on (contest photo) camera that fits the tank front face plus margin. */
export function fitCamera(g: TankGeom, aspect: number): CameraFit {
  const a = Math.max(0.05, aspect);
  const halfH = (g.h / 2) * 1.12;
  const halfW = (g.w / 2) * (a < 1 ? 1.06 : 1.1);
  const tanV = Math.tan((CAMERA_FOV * Math.PI) / 360);
  const dist = Math.max(halfH / tanV, halfW / (tanV * a));
  const yc = -g.floor + g.h / 2;
  return { fov: CAMERA_FOV, aspect: a, x: 0, y: yc, z: g.d / 2 + dist };
}

/** Project a world point to CSS pixels for a canvas of `width × height`. */
export function projectPoint(cam: CameraFit, width: number, height: number, x: number, y: number, z: number): [number, number] {
  const depth = cam.z - z;
  const tanV = Math.tan((cam.fov * Math.PI) / 360);
  const ndcX = (x - cam.x) / (depth * tanV * cam.aspect);
  const ndcY = (y - cam.y) / (depth * tanV);
  return [((ndcX + 1) / 2) * width, ((1 - ndcY) / 2) * height];
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Projected rectangle of the front glass (outer tank front face), CSS px. */
export function frontGlassRect(g: TankGeom, width: number, height: number): Rect {
  const cam = fitCamera(g, width / Math.max(1, height));
  const [l, t] = projectPoint(cam, width, height, -g.w / 2, g.topY, g.d / 2);
  const [r, b] = projectPoint(cam, width, height, g.w / 2, -g.floor, g.d / 2);
  return { left: l, top: t, width: r - l, height: b - t };
}

/** Focal point (tank cm, front view: x across width from centre, y above substrate y=0) → CSS px. */
export function focalToScreen(g: TankGeom, width: number, height: number, fx: number, fy: number): [number, number] {
  const cam = fitCamera(g, width / Math.max(1, height));
  return projectPoint(cam, width, height, fx, fy, g.d / 2);
}

/** Guide line fractions of the front-glass rectangle (same for x and y). */
export function guideFractions(kind: CompositionGuide | undefined): number[] {
  switch (kind) {
    case "thirds":
      return [1 / 3, 2 / 3];
    case "golden":
      return [0.382, 0.618];
    default:
      return [];
  }
}

export interface GuideLines {
  /** x positions (CSS px) of vertical lines */
  xs: number[];
  /** y positions (CSS px) of horizontal lines */
  ys: number[];
}

export function guideLines(kind: CompositionGuide | undefined, rect: Rect): GuideLines {
  const f = guideFractions(kind);
  return {
    xs: f.map((t) => rect.left + rect.width * t),
    ys: f.map((t) => rect.top + rect.height * t),
  };
}
