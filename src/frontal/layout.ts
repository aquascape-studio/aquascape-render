/**
 * Pure, deterministic instance layout for FrontalTank.
 *
 * `layoutPlant()` turns (SpeciesLook, PlantVisual) into leaf instances written
 * into an `InstanceBuffer` — one bucket ("layer") per leaf shape plus a
 * "stem" bucket. Each instance is a column-major 4×4 matrix + sRGB colour.
 * Leaf geometry convention (see geometry.ts): base at the origin, length
 * along +Z (0..1), width along X (−0.5..0.5), thickness along +Y (face
 * normal). The layout chooses for each leaf an outward direction D (tilted
 * ~35° upward) and a face normal N biased towards the viewer, so from the
 * front camera you see leaf faces rather than edge-on slivers.
 *
 * No three.js dependency: this runs in unit tests and on every timeline tick
 * (≈30×/s), writing straight into reusable typed arrays.
 */
import type { LeafShape, PlantVisual, SpeciesLook } from "../contract.js";
import { hexToRgb, healthTint, mixRgb, YOUNG_GREEN, type RGB } from "./color.js";
import { hashString, rand, srand } from "./rng.js";

export type LayerKey = LeafShape | "stem";
export const LEAF_SHAPES: readonly LeafShape[] = [
  "needle",
  "linear",
  "lanceolate",
  "ovate",
  "round",
  "strap",
  "cordate",
  "moss",
];
export const LAYER_KEYS: readonly LayerKey[] = [...LEAF_SHAPES, "stem"];

export type RenderQuality = "high" | "low";

export interface LayoutOptions {
  quality: RenderQuality;
  /** substrate surface height under the plant (visual slope), cm */
  baseY: number;
  /** water surface height (floating plants), cm */
  waterY: number;
  /** keep leaf tips inside the glass: |x| ≤ halfW, |z| ≤ halfD */
  bounds?: { halfW: number; halfD: number };
}

/** Hard caps per plant so one huge carpet can't blow the frame budget. */
export const MAX_LEAVES_PER_PLANT = { high: 9000, low: 3000 } as const;

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// Instance buffer

export class InstanceLayer {
  count = 0;
  matrices: Float32Array;
  colors: Float32Array;
  constructor(capacity = 256) {
    this.matrices = new Float32Array(capacity * 16);
    this.colors = new Float32Array(capacity * 3);
  }
  get capacity(): number {
    return this.colors.length / 3;
  }
  reserve(n: number): void {
    if (n <= this.capacity) return;
    let cap = this.capacity;
    while (cap < n) cap *= 2;
    const m = new Float32Array(cap * 16);
    m.set(this.matrices.subarray(0, this.count * 16));
    const c = new Float32Array(cap * 3);
    c.set(this.colors.subarray(0, this.count * 3));
    this.matrices = m;
    this.colors = c;
  }
}

export class InstanceBuffer {
  readonly layers: Record<LayerKey, InstanceLayer>;
  constructor() {
    const l = {} as Record<LayerKey, InstanceLayer>;
    for (const k of LAYER_KEYS) l[k] = new InstanceLayer();
    this.layers = l;
  }
  reset(): void {
    for (const k of LAYER_KEYS) this.layers[k].count = 0;
  }
  total(): number {
    let t = 0;
    for (const k of LAYER_KEYS) t += this.layers[k].count;
    return t;
  }

  /**
   * Append one instance. D = length direction, N ≈ face normal (will be
   * orthogonalised against D). Scale: X,Y by `width`, Z by `length`.
   */
  add(
    layer: LayerKey,
    px: number, py: number, pz: number,
    dx: number, dy: number, dz: number,
    nx: number, ny: number, nz: number,
    length: number, width: number,
    color: RGB,
  ): void {
    const L = this.layers[layer];
    L.reserve(L.count + 1);
    // normalise D
    let dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    // N ⟂ D
    const dot = nx * dx + ny * dy + nz * dz;
    nx -= dot * dx; ny -= dot * dy; nz -= dot * dz;
    let nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-4) {
      // D parallel to requested normal: pick any perpendicular
      nx = -dy; ny = dx; nz = 0;
      nl = Math.hypot(nx, ny, nz);
      if (nl < 1e-4) { nx = 0; ny = dz; nz = -dy; nl = Math.hypot(ny, nz) || 1; }
    }
    nx /= nl; ny /= nl; nz /= nl;
    // X = N × D
    const xx = ny * dz - nz * dy;
    const xy = nz * dx - nx * dz;
    const xz = nx * dy - ny * dx;
    const m = L.matrices;
    const o = L.count * 16;
    m[o] = xx * width; m[o + 1] = xy * width; m[o + 2] = xz * width; m[o + 3] = 0;
    m[o + 4] = nx * width; m[o + 5] = ny * width; m[o + 6] = nz * width; m[o + 7] = 0;
    m[o + 8] = dx * length; m[o + 9] = dy * length; m[o + 10] = dz * length; m[o + 11] = 0;
    m[o + 12] = px; m[o + 13] = py; m[o + 14] = pz; m[o + 15] = 1;
    const c = L.colors;
    const co = L.count * 3;
    c[co] = color[0]; c[co + 1] = color[1]; c[co + 2] = color[2];
    L.count++;
  }
}

// ---------------------------------------------------------------------------
// Orientation + colour helpers

/** Viewer-facing bias direction: towards the camera (+z) and a bit up. */
const VIEW_W: [number, number, number] = [0, 0.55, 0.835];

/** Face normal for a leaf pointing along D: blend of "natural" (up ⟂ D) and viewer-facing. */
function faceNormal(dx: number, dy: number, dz: number, bias: number, jx: number, jz: number, out: number[]): number[] {
  // natural normal: up projected ⟂ D
  let ux = -dy * dx, uy = 1 - dy * dy, uz = -dy * dz;
  let ul = Math.hypot(ux, uy, uz);
  if (ul < 1e-4) { ux = 0; uy = 0; uz = 1; ul = 1; }
  ux /= ul; uy /= ul; uz /= ul;
  out[0] = ux * (1 - bias) + VIEW_W[0] * bias + jx;
  out[1] = uy * (1 - bias) + VIEW_W[1] * bias;
  out[2] = uz * (1 - bias) + VIEW_W[2] * bias + jz;
  return out;
}

interface Palette {
  base: RGB;
  deep: RGB;
  young: RGB;
  tip: RGB | null;
  stem: RGB;
}

function makePalette(look: SpeciesLook, health = 1): Palette {
  const base = hexToRgb(look.colorHex);
  const deep: RGB = [base[0] * 0.62, base[1] * 0.68, base[2] * 0.62];
  const young = mixRgb(base, YOUNG_GREEN, 0.5);
  const tip = look.tipColorHex ? hexToRgb(look.tipColorHex) : null;
  const stem = mixRgb(base, [0.62, 0.72, 0.45], 0.4);
  // health tint is (nearly) affine, so apply it once to the palette instead
  // of per leaf — keeps the per-update cost low while scrubbing.
  return {
    base: healthTint(base, health),
    deep: healthTint(deep, health),
    young: healthTint(young, health),
    tip: tip ? healthTint(tip, health) : null,
    stem: healthTint(stem, health),
  };
}

/**
 * Leaf colour. `youth` 0 = old/deep, 1 = young tip. `ao` 0..1 darkening for
 * buried leaves. `v` ∈ [-1,1] per-instance variation. Palette is already
 * health-tinted (see makePalette).
 */
export function leafColor(p: Palette, youth: number, ao: number, v: number, out: RGB): RGB {
  const y = youth < 0 ? 0 : youth > 1 ? 1 : youth;
  mixRgb(p.deep, p.base, smoothstep(0, 0.5, y), tmpC);
  mixRgb(tmpC, p.young, smoothstep(0.45, 1, y) * 0.9, tmpC);
  if (p.tip) mixRgb(tmpC, p.tip, smoothstep(0.35, 0.95, y) * 0.92, tmpC);
  const a = (0.55 + 0.45 * (ao < 0 ? 0 : ao > 1 ? 1 : ao)) * (1 + v * 0.09);
  out[0] = tmpC[0] * a * (1 - v * 0.03);
  out[1] = tmpC[1] * a;
  out[2] = tmpC[2] * a * (1 + v * 0.05);
  return out;
}

const tmpC: RGB = [0, 0, 0];
export { makePalette };

// ---------------------------------------------------------------------------
// Per-form layout

const nrm: number[] = [0, 0, 0];
const col: RGB = [0, 0, 0];

interface Ctx {
  buf: InstanceBuffer;
  look: SpeciesLook;
  pal: Palette;
  seed: number;
  x: number;
  y: number;
  z: number;
  H: number;
  S: number;
  health: number;
  thin: number;
  low: boolean;
  cap: number;
  emitted: number;
  waterY: number;
  bounds: { halfW: number; halfD: number } | null;
}

function emitLeaf(
  c: Ctx, layer: LayerKey,
  px: number, py: number, pz: number,
  dx: number, dy: number, dz: number,
  bias: number, idx: number,
  length: number, width: number,
  youth: number, ao: number,
): boolean {
  if (c.emitted >= c.cap) return false;
  if (c.bounds) {
    const bw = c.bounds.halfW, bd = c.bounds.halfD;
    px = clamp(px, -bw, bw);
    pz = clamp(pz, -bd, bd);
    if (Math.abs(px + dx * length) > bw) dx = -dx;
    if (Math.abs(pz + dz * length) > bd) dz = -dz;
  }
  faceNormal(dx, dy, dz, bias, srand(c.seed, idx, 21) * 0.15, srand(c.seed, idx, 22) * 0.1, nrm);
  leafColor(c.pal, youth, ao, srand(c.seed, idx, 23), col);
  c.buf.add(layer, px, py, pz, dx, dy, dz, nrm[0]!, nrm[1]!, nrm[2]!, length, width, col);
  c.emitted++;
  return true;
}

function dirFrom(elev: number, az: number, out: number[]): number[] {
  const ce = Math.cos(elev);
  out[0] = ce * Math.cos(az);
  out[1] = Math.sin(elev);
  out[2] = ce * Math.sin(az);
  return out;
}

const dir: number[] = [0, 0, 0];

function layoutStem(c: Ctx): void {
  const { look, seed, H, S } = c;
  const dens = look.leafDensity;
  let nStems = clamp(Math.round(1 + (S / 1.3) * (0.6 + 0.6 * dens)), 1, 24);
  if (c.low) nStems = Math.max(1, Math.round(nStems * 0.6));
  const clusterR = S * 0.34;
  const L = look.leafLengthCm;
  const W = look.leafWidthCm;
  let internode = clamp(L * 0.34, 0.22, 2.0) / (0.7 + 0.5 * dens);
  if (c.low) internode *= 1.3;
  const perNode = look.arrangement === "whorled" ? 4 : look.arrangement === "alternate" ? 1 : 2;
  const growth = 0.8 + 0.2 * c.health;
  const stemW = clamp(0.1 + W * 0.25, 0.1, 0.5);

  for (let s = 0; s < nStems; s++) {
    const sIdx = s * 4096;
    const ang = s * 2.39996 + srand(seed, sIdx, 1) * 0.4;
    const rr = clusterR * Math.sqrt((s + 0.5) / nStems) * (0.75 + 0.5 * rand(seed, sIdx, 2));
    const sx = c.x + Math.cos(ang) * rr;
    const sz = c.z + Math.sin(ang) * rr;
    const hs = Math.min(H * (s === 0 ? 1 : 0.7 + 0.3 * rand(seed, sIdx, 3)), Math.max(1, c.waterY - c.y - 0.8));
    const lean = (3 + 10 * rand(seed, sIdx, 4)) * DEG * (rr / (clusterR || 1) + 0.3);
    const ldx = Math.sin(lean) * Math.cos(ang);
    const ldy = Math.cos(lean);
    const ldz = Math.sin(lean) * Math.sin(ang);
    if (c.emitted < c.cap) {
      c.buf.add("stem", sx, c.y - 0.5, sz, ldx, ldy, ldz, 0, 0, 1, hs + 0.5, stemW, c.pal.stem);
      c.emitted++;
    }
    const nodes = Math.max(1, Math.floor(hs / internode));
    const phase0 = rand(seed, sIdx, 5) * Math.PI;
    for (let k = 1; k <= nodes; k++) {
      const h = k * internode;
      const f = h / hs;
      const apex = smoothstep(1.0, 0.72, f); // 1 below the apex, 0 at tip
      const nodeAz =
        perNode === 1 ? phase0 + k * 2.39996 : phase0 + k * (Math.PI / perNode) + k * 0.12;
      for (let j = 0; j < perNode; j++) {
        const idx = sIdx + k * 8 + j;
        // low health: old (lower) leaves drop first
        const keep = c.thin + (1 - c.thin) * Math.min(1, f * 1.4) * 0.6;
        if (rand(seed, idx, 0) > keep) continue;
        const az = nodeAz + (j * 2 * Math.PI) / perNode + srand(seed, idx, 6) * 0.3;
        const elev = (35 + 42 * (1 - apex) + srand(seed, idx, 7) * 10) * DEG;
        dirFrom(elev, az, dir);
        const size = (0.32 + 0.68 * apex) * (0.95 + 0.35 * rand(seed, idx, 8)) * growth;
        const px = sx + ldx * h + dir[0]! * stemW * 0.4;
        const py = c.y + ldy * h;
        const pz = sz + ldz * h + dir[2]! * stemW * 0.4;
        const youth = Math.max(1 - apex, f * 0.55);
        // leaves facing away from viewer & lower ones sit in shade
        const ao = 0.45 + 0.4 * f + 0.15 * (0.5 + 0.5 * Math.sin(az));
        if (!emitLeaf(c, look.leafShape, px, py, pz, dir[0]!, dir[1]!, dir[2]!, 0.55, idx, L * size, W * size, youth, ao)) return;
      }
    }
  }
}

function layoutCarpet(c: Ctx, moss: boolean): void {
  const { look, seed, H, S } = c;
  const R = S / 2;
  const area = Math.PI * R * R;
  const L = look.leafLengthCm;
  const W = look.leafWidthCm;
  const per = (moss ? 1.6 : 1.5) * (0.4 + 0.6 * look.leafDensity) / Math.max(0.02, L * W);
  const n = Math.round(area * per * (c.low ? 0.4 : 1));
  const layer: LayerKey = moss ? "moss" : look.leafShape;
  const clumps = moss ? 4 + Math.round(S * 0.8) : 0;
  for (let i = 0; i < n; i++) {
    if (rand(seed, i, 0) > c.thin) continue;
    let px: number, pz: number, dome: number;
    if (moss) {
      const ci = Math.floor(rand(seed, i, 1) * clumps);
      const cr = R * 0.7 * Math.sqrt(rand(seed, ci + 50000, 2));
      const ca = rand(seed, ci + 50000, 3) * Math.PI * 2;
      const cs = R * (0.25 + 0.2 * rand(seed, ci + 50000, 4));
      const r = cs * Math.sqrt(rand(seed, i, 2));
      const a = rand(seed, i, 3) * Math.PI * 2;
      const ox = Math.cos(ca) * cr + Math.cos(a) * r;
      const oz = Math.sin(ca) * cr + Math.sin(a) * r;
      px = c.x + ox;
      pz = c.z + oz;
      const local = Math.sqrt(Math.max(0, 1 - (r / cs) ** 2));
      const global = Math.sqrt(Math.max(0, 1 - (Math.hypot(ox, oz) / (R * 1.05)) ** 2));
      dome = local * (0.5 + 0.5 * global);
    } else {
      const r = R * Math.sqrt(rand(seed, i, 2));
      const a = rand(seed, i, 3) * Math.PI * 2;
      px = c.x + Math.cos(a) * r;
      pz = c.z + Math.sin(a) * r;
      // soft-edged mound with a little undulation
      const u = r / R;
      dome = Math.sqrt(Math.max(0, 1 - u * u)) * (0.85 + 0.15 * Math.sin(a * 3 + seed));
    }
    const layerT = Math.sqrt(rand(seed, i, 4));
    const py = c.y + H * dome * (0.3 + 0.7 * layerT) - 0.1;
    const elev = (moss ? 10 + 70 * rand(seed, i, 5) : 22 + 40 * rand(seed, i, 5)) * DEG;
    const az = rand(seed, i, 6) * Math.PI * 2;
    dirFrom(elev, az, dir);
    const size = (0.95 + 0.6 * rand(seed, i, 7)) * (0.65 + 0.35 * dome) * (0.85 + 0.15 * c.health);
    const youth = layerT * dome;
    const ao = 0.25 + 0.75 * layerT * (0.4 + 0.6 * dome);
    if (!emitLeaf(c, layer, px, py, pz, dir[0]!, dir[1]!, dir[2]!, moss ? 0.3 : 0.45, i, L * size, W * size, youth, ao)) return;
  }
}

function layoutRosette(c: Ctx): void {
  const { look, seed, H, S } = c;
  const strap = look.leafShape === "strap" || look.leafShape === "linear" || look.leafShape === "needle";
  const crowns = clamp(Math.round(S / 7), 1, 6);
  const L = look.leafLengthCm;
  const W = look.leafWidthCm;
  let perCrown = Math.round(7 + 12 * look.leafDensity);
  if (c.low) perCrown = Math.round(perCrown * 0.7);
  for (let k = 0; k < crowns; k++) {
    const kIdx = k * 1024;
    const ca = k * 2.39996 + rand(seed, kIdx, 1);
    const cr = crowns === 1 ? 0 : S * 0.28 * Math.sqrt((k + 0.5) / crowns);
    const cx = c.x + Math.cos(ca) * cr;
    const cz = c.z + Math.sin(ca) * cr;
    const crownH = Math.min(H * (k === 0 ? 1 : 0.75 + 0.25 * rand(seed, kIdx, 2)), Math.max(1, c.waterY - c.y - 1));
    for (let i = 0; i < perCrown; i++) {
      const idx = kIdx + i;
      const inner = i / perCrown; // later = inner = younger
      const keep = c.thin + (1 - c.thin) * inner;
      if (rand(seed, idx, 0) > keep) continue;
      const az = i * 2.39996 + rand(seed, kIdx, 3) * 6.28 + srand(seed, idx, 4) * 0.25;
      const e0 = strap ? 52 : 28;
      const e1 = strap ? 84 : 66;
      const elev = (e0 + (e1 - e0) * inner + srand(seed, idx, 5) * 8) * DEG;
      dirFrom(elev, az, dir);
      const reach = crownH * (0.72 + 0.3 * rand(seed, idx, 6)) * (0.8 + 0.2 * inner);
      const len = reach / (0.3 + 0.7 * Math.sin(elev));
      const wScale = clamp(len / L, 0.55, 1.25);
      const youth = inner * 0.9;
      const ao = 0.5 + 0.5 * inner;
      if (!emitLeaf(c, look.leafShape, cx, c.y - 0.2, cz, dir[0]!, dir[1]!, dir[2]!, strap ? 0.7 : 0.5, idx, len, W * wScale, youth, ao)) return;
    }
  }
}

function layoutEpiphyte(c: Ctx): void {
  const { look, seed, H, S } = c;
  const L = look.leafLengthCm;
  const W = look.leafWidthCm;
  let n = Math.round((5 + S * 1.1) * (0.6 + 0.6 * look.leafDensity));
  if (c.low) n = Math.round(n * 0.7);
  const gs = clamp(H / (L * 1.1), 0.35, 1.15);
  const rhAng = srand(seed, 0, 1) * 0.6;
  const rhLen = S * 0.5;
  for (let i = 0; i < n; i++) {
    const keep = c.thin + (1 - c.thin) * (i / n);
    if (rand(seed, i, 0) > keep) continue;
    const t = rand(seed, i, 2) - 0.5;
    const bx = c.x + Math.cos(rhAng) * rhLen * t;
    const bz = c.z + Math.sin(rhAng) * rhLen * t + srand(seed, i, 3) * S * 0.08;
    const size = (0.65 + 0.45 * rand(seed, i, 4)) * gs;
    const len = L * size;
    const lift = Math.pow(rand(seed, i, 5), 1.5) * Math.max(0, H - len * 0.8) * 0.3;
    const elev = (28 + 36 * rand(seed, i, 6)) * DEG;
    // bias azimuths forward/outward so leaves fan towards the viewer
    const az = Math.PI * 0.5 + srand(seed, i, 7) * Math.PI * 0.85;
    dirFrom(elev, az, dir);
    const pet = len * 0.28;
    const px = bx + dir[0]! * pet * 0.6;
    const py = c.y + lift + pet * 0.8;
    const pz = bz + dir[2]! * pet * 0.6;
    if (c.emitted < c.cap) {
      c.buf.add("stem", bx, c.y + lift * 0.3, bz, px - bx, py - c.y - lift * 0.3, pz - bz, 0, 0, 1,
        Math.hypot(px - bx, py - c.y - lift * 0.3, pz - bz), clamp(W * 0.1, 0.1, 0.3), c.pal.stem);
      c.emitted++;
    }
    const youth = rand(seed, i, 8) * 0.7 + (i / n) * 0.3;
    const ao = 0.55 + 0.45 * (lift / Math.max(1, H));
    if (!emitLeaf(c, look.leafShape, px, py, pz, dir[0]!, dir[1]!, dir[2]!, 0.5, i, len, W * size, youth, ao)) return;
  }
}

function layoutFloating(c: Ctx): void {
  const { look, seed, S } = c;
  const R = S / 2;
  const L = look.leafLengthCm;
  const W = look.leafWidthCm;
  const n = Math.min(400, Math.round(Math.PI * R * R * look.leafDensity * 0.9 / Math.max(0.05, L * W) * (c.low ? 0.5 : 1)));
  for (let i = 0; i < n; i++) {
    if (rand(seed, i, 0) > c.thin) continue;
    const r = R * Math.sqrt(rand(seed, i, 2));
    const a = rand(seed, i, 3) * Math.PI * 2;
    const az = rand(seed, i, 4) * Math.PI * 2;
    dirFrom((4 + 10 * rand(seed, i, 5)) * DEG, az, dir);
    const size = 0.7 + 0.5 * rand(seed, i, 6);
    if (!emitLeaf(c, look.leafShape, c.x + Math.cos(a) * r, c.waterY - 0.15, c.z + Math.sin(a) * r,
      dir[0]!, dir[1]!, dir[2]!, 0.15, i, L * size, W * size, rand(seed, i, 7), 0.9)) return;
  }
}

/**
 * Lay out one plant into `buf`. Returns the number of instances emitted.
 * Deterministic in (plant.id, look, plant dims, quality).
 */
export function layoutPlant(buf: InstanceBuffer, look: SpeciesLook, plant: PlantVisual, opts: LayoutOptions): number {
  const health = clamp(Number.isFinite(plant.health) ? plant.health : 1, 0, 1);
  const H = Math.max(0.3, plant.heightCm || 0);
  const S = Math.max(0.5, plant.spreadCm || 0);
  const c: Ctx = {
    buf,
    look,
    pal: makePalette(look, health),
    seed: hashString(plant.id),
    x: plant.x,
    y: opts.baseY + (plant.y || 0),
    z: plant.z,
    H,
    S,
    health,
    thin: 0.3 + 0.7 * health,
    low: opts.quality === "low",
    cap: MAX_LEAVES_PER_PLANT[opts.quality],
    emitted: 0,
    waterY: opts.waterY,
    bounds: opts.bounds ?? null,
  };
  switch (look.growthForm) {
    case "carpeting":
      layoutCarpet(c, look.leafShape === "moss");
      break;
    case "moss":
      layoutCarpet(c, true);
      break;
    case "rosette":
    case "rhizome":
      layoutRosette(c);
      break;
    case "epiphyte":
      layoutEpiphyte(c);
      break;
    case "floating":
      layoutFloating(c);
      break;
    case "stem":
    default:
      layoutStem(c);
  }
  return c.emitted;
}

/** Visual substrate: sloped bed, `front` cm at the front glass rising to `back` at the rear. */
export interface SubstrateProfile {
  front: number;
  back: number;
  depthCm: number;
  widthCm: number;
}

export function substrateHeight(p: SubstrateProfile, x: number, z: number): number {
  const t = clamp(0.5 - z / p.depthCm, 0, 1); // 0 front, 1 back
  const slope = p.front + (p.back - p.front) * smoothstep(0, 1, t);
  // gentle mound towards the centre-left (golden-section-ish), small
  const u = x / p.widthCm;
  const mound = 0.8 * Math.exp(-((u + 0.12) ** 2) / 0.08) * t;
  return slope + mound;
}
