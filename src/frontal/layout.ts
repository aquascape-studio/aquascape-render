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
import { hashString, rand } from "./rng.js";

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
// Cached per-leaf randoms

/** Random channels drawn per leaf record. */
const CH = 12;

/**
 * Per-plant table of per-leaf random numbers. A leaf's randoms depend only on
 * (plant seed, stream, ordinal), never on the plant's current size, so they
 * are drawn once and reused on every re-layout while the timeline scrubs —
 * re-layout becomes pure arithmetic over Float32Arrays instead of ~12 hash
 * evaluations per leaf.
 */
export class LeafRandoms {
  readonly seed: number;
  private tables = new Map<number, Float32Array>();
  private filled = new Map<number, number>();
  /** size-independent carpet leaf templates (see layoutCarpet) */
  carpet: CarpetTemplate | undefined;
  constructor(seed: number) {
    this.seed = seed >>> 0;
  }
  /** Table for `stream` with at least `n` records; record i channel ch at [i*CH+ch]. */
  get(stream: number, n: number): Float32Array {
    let t = this.tables.get(stream);
    const have = this.filled.get(stream) ?? 0;
    if (t && have >= n) return t;
    if (!t || t.length < n * CH) {
      let cap = Math.max(16, t ? t.length / CH : 16);
      while (cap < n) cap *= 2;
      const nt = new Float32Array(cap * CH);
      if (t) nt.set(t.subarray(0, have * CH));
      t = nt;
      this.tables.set(stream, t);
    }
    const base = stream * 0x10000;
    for (let i = have; i < n; i++) {
      const o = i * CH;
      for (let ch = 0; ch < CH; ch++) t[o + ch] = rand(this.seed, base + i, ch);
    }
    this.filled.set(stream, n);
    return t;
  }
  /** number of random records drawn so far (all streams) */
  drawn(): number {
    let n = 0;
    for (const v of this.filled.values()) n += v;
    return n;
  }
}

// ---------------------------------------------------------------------------
// Per-form layout

const nrm: number[] = [0, 0, 0];
const col: RGB = [0, 0, 0];

interface Ctx {
  buf: InstanceBuffer;
  look: SpeciesLook;
  pal: Palette;
  rnd: LeafRandoms;
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
  bias: number, jx: number, jz: number, v: number,
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
  faceNormal(dx, dy, dz, bias, jx, jz, nrm);
  leafColor(c.pal, youth, ao, v, col);
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

/**
 * Leaf direction for stem plants: azimuth squashed towards the picture plane
 * (|z| reduced) so no leaf points straight at / away from the front camera
 * and reads as an edge-on sliver; elevation ≈ 35° up.
 */
function stemLeafDir(elev: number, az: number, out: number[]): number[] {
  let hx = Math.cos(az);
  let hz = Math.sin(az) * 0.72;
  const hl = Math.hypot(hx, hz) || 1;
  hx /= hl; hz /= hl;
  const ce = Math.cos(elev);
  out[0] = ce * hx;
  out[1] = Math.sin(elev);
  out[2] = ce * hz;
  return out;
}

/** Visual leaf width floor: rounded, readable leaves — never matchsticks. */
function visualWidth(L: number, W: number): number {
  return Math.max(W, L * 0.3, 0.12);
}

interface Shoot {
  bx: number; by: number; bz: number;
  /** unit lean direction in the horizontal plane */
  lx: number; lz: number;
  /** lean slope (horizontal cm per vertical cm) and extra curvature */
  slope: number; bend: number;
  len: number;
  /** leaf size multiplier */
  scale: number;
  /** phyllotaxy phase */
  phase: number;
}

const SHOOT_SEGMENTS = 3;

/** One stem shoot: curved stem + leaves in natural phyllotaxy. */
function growShoot(c: Ctx, sh: Shoot, stream: number, internode: number, perNode: number, L: number, W: number, stemW: number): boolean {
  const { look } = c;
  // stem body as a few straight segments along the curve
  for (let sgi = 0; sgi < SHOOT_SEGMENTS; sgi++) {
    if (c.emitted >= c.cap) return false;
    const h0 = (sh.len * sgi) / SHOOT_SEGMENTS - (sgi === 0 ? 0.4 : 0);
    const h1 = (sh.len * (sgi + 1)) / SHOOT_SEGMENTS;
    const o0 = sh.slope * h0 + (sh.bend * h0 * h0) / sh.len;
    const o1 = sh.slope * h1 + (sh.bend * h1 * h1) / sh.len;
    const x0 = sh.bx + sh.lx * o0, z0 = sh.bz + sh.lz * o0, y0 = sh.by + h0;
    const dx = sh.lx * (o1 - o0), dz = sh.lz * (o1 - o0), dy = h1 - h0;
    const w = stemW * (1 - 0.35 * (sgi / SHOOT_SEGMENTS));
    c.buf.add("stem", x0, y0, z0, dx, dy, dz, 0, 0, 1, Math.hypot(dx, dy, dz) * 1.02, w, c.pal.stem);
    c.emitted++;
  }
  const nodes = Math.max(1, Math.floor(sh.len / internode));
  const t = c.rnd.get(stream, nodes * perNode);
  const growth = 0.8 + 0.2 * c.health;
  const alternate = perNode === 1;
  for (let k = 1; k <= nodes; k++) {
    // slightly irregular internodes
    const h = Math.min(sh.len, (k + (t[(k - 1) * perNode * CH + 7]! - 0.5) * 0.45) * internode);
    const f = h / sh.len;
    const apex = smoothstep(1.0, 0.78, f); // 1 below the apex, 0 at the tip
    const taper = 0.72 + 0.28 * smoothstep(0, 0.3, f);
    // decussate (opposite pairs turned 90° per node, offset 45° so no pair
    // faces the camera), whorls offset by half a step, alternate = golden angle
    const nodeAz = alternate
      ? sh.phase + k * 2.39996
      : sh.phase + Math.PI / 4 + k * (Math.PI / perNode);
    const off = sh.slope * h + (sh.bend * h * h) / sh.len;
    const sx = sh.bx + sh.lx * off;
    const sy = sh.by + h;
    const sz = sh.bz + sh.lz * off;
    for (let j = 0; j < perNode; j++) {
      const o = ((k - 1) * perNode + j) * CH;
      // low health: old (lower) leaves drop first
      const keep = c.thin + (1 - c.thin) * Math.min(1, f * 1.4) * 0.6;
      if (t[o]! > keep) continue;
      const az = nodeAz + (j * 2 * Math.PI) / perNode + (t[o + 1]! - 0.5) * 0.8;
      // ≈35° up along the stem, closing into an upright bud at the apex;
      // generous jitter so stems read as soft leafy columns, not fern fronds
      const elev = (30 + 42 * (1 - apex) + (t[o + 2]! - 0.5) * 24) * DEG;
      stemLeafDir(elev, az, dir);
      const size = (0.3 + 0.7 * apex) * taper * (0.75 + 0.5 * t[o + 3]!) * growth * sh.scale;
      const px = sx + dir[0]! * stemW * 0.5;
      const pz = sz + dir[2]! * stemW * 0.5;
      const youth = Math.max(1 - apex, f * 0.6);
      // lower leaves and leaves facing away sit in soft shade
      const ao = 0.5 + 0.35 * f + 0.15 * (0.5 + 0.5 * dir[2]!);
      if (!emitLeaf(c, look.leafShape, px, sy, pz, dir[0]!, dir[1]!, dir[2]!, 0.62,
        (t[o + 4]! - 0.5) * 0.3, (t[o + 5]! - 0.5) * 0.2, t[o + 6]! * 2 - 1,
        L * size, W * size, youth, ao)) return false;
    }
  }
  return true;
}

function layoutStem(c: Ctx): void {
  const { look, H, S } = c;
  const dens = look.leafDensity;
  let nStems = clamp(Math.round(1 + (S / 1.1) * (0.7 + 0.6 * dens)), 1, 28);
  if (c.low) nStems = Math.max(1, Math.round(nStems * 0.6));
  const clusterR = S * 0.36;
  const L = look.leafLengthCm;
  const W = visualWidth(L, look.leafWidthCm);
  let internode = clamp(L * 0.3, 0.2, 1.6) / (0.75 + 0.5 * dens);
  if (c.low) internode *= 1.3;
  const perNode = look.arrangement === "whorled" ? 4 : look.arrangement === "alternate" ? 1 : 2;
  const stemW = clamp(0.06 + W * 0.16, 0.07, 0.32);
  const st = c.rnd.get(0, nStems);
  const maxH = Math.max(1, c.waterY - c.y - 0.8);
  const sh: Shoot = { bx: 0, by: 0, bz: 0, lx: 0, lz: 0, slope: 0, bend: 0, len: 0, scale: 1, phase: 0 };

  for (let s = 0; s < nStems; s++) {
    const o = s * CH;
    const ang = s * 2.39996 + (st[o + 1]! - 0.5) * 0.8;
    const rr = clusterR * Math.sqrt((s + 0.5) / nStems) * (0.75 + 0.5 * st[o + 2]!);
    const sx = c.x + Math.cos(ang) * rr;
    const sz = c.z + Math.sin(ang) * rr;
    const hs = Math.min(H * (s === 0 ? 1 : 0.62 + 0.38 * st[o + 3]!), maxH);
    const lean = (4 + 12 * st[o + 4]!) * DEG * (rr / (clusterR || 1) + 0.3);
    sh.bx = sx; sh.by = c.y - 0.3; sh.bz = sz;
    sh.lx = Math.cos(ang); sh.lz = Math.sin(ang);
    sh.slope = Math.tan(lean);
    sh.bend = (st[o + 5]! - 0.35) * 0.18;
    sh.len = hs + 0.3;
    sh.scale = 1;
    sh.phase = st[o + 6]! * 0.5;
    if (!growShoot(c, sh, 1 + s * 2, internode, perNode, L, W, stemW)) return;
    // bushy side shoot (trimmed stems branch) — fills gaps between stems
    if (hs > 5 && st[o + 7]! < 0.35 + 0.4 * dens) {
      const hb = hs * (0.3 + 0.3 * st[o + 8]!);
      const off = sh.slope * hb + (sh.bend * hb * hb) / sh.len;
      const side = st[o + 9]! < 0.5 ? 1 : -1;
      const a2 = ang + side * (0.6 + 0.6 * st[o + 10]!);
      sh.bx = sx + sh.lx * off; sh.by = c.y - 0.3 + hb; sh.bz = sz + sh.lz * off;
      sh.lx = Math.cos(a2); sh.lz = Math.sin(a2) * 0.6;
      const ll = Math.hypot(sh.lx, sh.lz) || 1;
      sh.lx /= ll; sh.lz /= ll;
      sh.slope = Math.tan(lean + 14 * DEG);
      sh.bend = 0.05;
      sh.len = Math.min((hs - hb) * (0.6 + 0.3 * st[o + 11]!), maxH - hb);
      sh.scale = 0.9;
      sh.phase += 0.7;
      if (sh.len > internode * 2 && !growShoot(c, sh, 2 + s * 2, internode, perNode, L, W, stemW * 0.8)) return;
    }
  }
}

/** Carpet template record layout (per leaf, size-independent). */
const T_UX = 0, T_UZ = 1, T_HF = 2, T_X = 3, T_N = 6, T_D = 9, T_SIZE = 12, T_THIN = 13, T_YOUTH = 14, T_AO = 15, T_V = 16;
const TS = 17;

interface CarpetTemplate {
  key: string;
  n: number;
  rec: Float32Array;
  /** cached sRGB colours for `colorHealth` */
  col: Float32Array;
  colN: number;
  colorHealth: number;
}

const basisOut: number[] = new Array(9).fill(0);

/** Orthonormal leaf basis (X, N, D) exactly as InstanceBuffer.add builds it. */
function leafBasis(dx: number, dy: number, dz: number, nx: number, ny: number, nz: number, out: number[]): void {
  const dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl; dy /= dl; dz /= dl;
  const dot = nx * dx + ny * dy + nz * dz;
  nx -= dot * dx; ny -= dot * dy; nz -= dot * dz;
  let nl = Math.hypot(nx, ny, nz);
  if (nl < 1e-4) {
    nx = -dy; ny = dx; nz = 0;
    nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-4) { nx = 0; ny = dz; nz = -dy; nl = Math.hypot(ny, nz) || 1; }
  }
  nx /= nl; ny /= nl; nz /= nl;
  out[0] = ny * dz - nz * dy; out[1] = nz * dx - nx * dz; out[2] = nx * dy - ny * dx;
  out[3] = nx; out[4] = ny; out[5] = nz;
  out[6] = dx; out[7] = dy; out[8] = dz;
}

/**
 * Carpets / moss are the bulk of the instances (thousands per plant), and
 * apart from the overall radius / height / health nothing about a carpet leaf
 * changes while the timeline scrubs. Per leaf we therefore cache a template
 * (unit offset, height factor, orthonormal basis, size factor, colour params,
 * colour) and re-layout is a scale + copy.
 */
function layoutCarpet(c: Ctx, moss: boolean): void {
  const { look, H, S } = c;
  const R = S / 2;
  const area = Math.PI * R * R;
  const L = look.leafLengthCm;
  const W = look.leafWidthCm;
  const per = (moss ? 1.6 : 1.5) * (0.4 + 0.6 * look.leafDensity) / Math.max(0.02, L * W);
  const n = Math.min(c.cap, Math.round(area * per * (c.low ? 0.4 : 1)));
  const layer: LayerKey = moss ? "moss" : look.leafShape;
  // clump count depends on S; it is part of the template key for moss
  const clumps = moss ? 4 + Math.round(S * 0.8) : 0;
  const tkey = `${lookIdOf(look)}|${moss ? clumps : "c"}`;
  let tp = c.rnd.carpet;
  if (!tp || tp.key !== tkey) {
    tp = { key: tkey, n: 0, rec: new Float32Array(0), col: new Float32Array(0), colN: 0, colorHealth: -1 };
    c.rnd.carpet = tp;
  }
  if (tp.n < n) {
    const t = c.rnd.get(0, n);
    const ct = moss ? c.rnd.get(1, clumps) : t;
    if (tp.rec.length < n * TS) {
      const cap = Math.max(64, Math.ceil(n * 1.25));
      const nr = new Float32Array(cap * TS);
      nr.set(tp.rec.subarray(0, tp.n * TS));
      tp.rec = nr;
      const nc = new Float32Array(cap * 3);
      nc.set(tp.col.subarray(0, tp.colN * 3));
      tp.col = nc;
    }
    const rec = tp.rec;
    for (let i = tp.n; i < n; i++) {
      const o = i * CH;
      const q = i * TS;
      let ux: number, uz: number, dome: number;
      if (moss) {
        const ci = Math.min(clumps - 1, Math.floor(t[o + 1]! * clumps)) * CH;
        const cr = 0.7 * Math.sqrt(ct[ci + 2]!);
        const ca = ct[ci + 3]! * Math.PI * 2;
        const cs = 0.25 + 0.2 * ct[ci + 4]!;
        const r = cs * Math.sqrt(t[o + 2]!);
        const a = t[o + 3]! * Math.PI * 2;
        ux = Math.cos(ca) * cr + Math.cos(a) * r;
        uz = Math.sin(ca) * cr + Math.sin(a) * r;
        const local = Math.sqrt(Math.max(0, 1 - (r / cs) ** 2));
        const global = Math.sqrt(Math.max(0, 1 - (Math.hypot(ux, uz) / 1.05) ** 2));
        dome = local * (0.5 + 0.5 * global);
      } else {
        const u = Math.sqrt(t[o + 2]!);
        const a = t[o + 3]! * Math.PI * 2;
        ux = Math.cos(a) * u;
        uz = Math.sin(a) * u;
        // soft-edged mound with a little undulation
        dome = Math.sqrt(Math.max(0, 1 - u * u)) * (0.85 + 0.15 * Math.sin(a * 3 + (c.rnd.seed & 255)));
      }
      const layerT = Math.sqrt(t[o + 4]!);
      const elev = (moss ? 10 + 70 * t[o + 5]! : 22 + 40 * t[o + 5]!) * DEG;
      dirFrom(elev, t[o + 6]! * Math.PI * 2, dir);
      faceNormal(dir[0]!, dir[1]!, dir[2]!, moss ? 0.3 : 0.45, (t[o + 9]! - 0.5) * 0.3, (t[o + 10]! - 0.5) * 0.2, nrm);
      leafBasis(dir[0]!, dir[1]!, dir[2]!, nrm[0]!, nrm[1]!, nrm[2]!, basisOut);
      rec[q + T_UX] = ux;
      rec[q + T_UZ] = uz;
      rec[q + T_HF] = dome * (0.3 + 0.7 * layerT);
      for (let k = 0; k < 9; k++) rec[q + T_X + k] = basisOut[k]!;
      rec[q + T_SIZE] = (0.95 + 0.6 * t[o + 7]!) * (0.65 + 0.35 * dome);
      rec[q + T_THIN] = t[o]!;
      rec[q + T_YOUTH] = layerT * dome;
      rec[q + T_AO] = 0.25 + 0.75 * layerT * (0.4 + 0.6 * dome);
      rec[q + T_V] = t[o + 8]! * 2 - 1;
    }
    tp.n = n;
  }
  // colours: recomputed only when health moves by > 1/128
  const hq = Math.round(c.health * 128) / 128;
  if (tp.colorHealth !== hq) {
    tp.colN = 0;
    tp.colorHealth = hq;
  }
  if (tp.colN < n) {
    const pal = makePalette(look, hq);
    for (let i = tp.colN; i < n; i++) {
      const q = i * TS;
      leafColor(pal, tp.rec[q + T_YOUTH]!, tp.rec[q + T_AO]!, tp.rec[q + T_V]!, col);
      tp.col[i * 3] = col[0]; tp.col[i * 3 + 1] = col[1]; tp.col[i * 3 + 2] = col[2];
    }
    tp.colN = n;
  }

  const healthSize = 0.85 + 0.15 * c.health;
  const Ly = c.buf.layers[layer];
  const room = Math.min(n, c.cap - c.emitted);
  if (room <= 0) return;
  Ly.reserve(Ly.count + room);
  const m = Ly.matrices;
  const cc = Ly.colors;
  const rec = tp.rec;
  const b = c.bounds;
  const thin = c.thin;
  for (let i = 0; i < n; i++) {
    if (c.emitted >= c.cap) return;
    const q = i * TS;
    if (rec[q + T_THIN]! > thin) continue;
    let px = c.x + rec[q + T_UX]! * R;
    let pz = c.z + rec[q + T_UZ]! * R;
    const py = c.y + H * rec[q + T_HF]! - 0.1;
    const size = rec[q + T_SIZE]! * healthSize;
    const len = L * size;
    const wid = W * size;
    if (b) {
      if (px < -b.halfW) px = -b.halfW; else if (px > b.halfW) px = b.halfW;
      if (pz < -b.halfD) pz = -b.halfD; else if (pz > b.halfD) pz = b.halfD;
    }
    const o = Ly.count * 16;
    m[o] = rec[q + T_X]! * wid; m[o + 1] = rec[q + T_X + 1]! * wid; m[o + 2] = rec[q + T_X + 2]! * wid; m[o + 3] = 0;
    m[o + 4] = rec[q + T_N]! * wid; m[o + 5] = rec[q + T_N + 1]! * wid; m[o + 6] = rec[q + T_N + 2]! * wid; m[o + 7] = 0;
    m[o + 8] = rec[q + T_D]! * len; m[o + 9] = rec[q + T_D + 1]! * len; m[o + 10] = rec[q + T_D + 2]! * len; m[o + 11] = 0;
    m[o + 12] = px; m[o + 13] = py; m[o + 14] = pz; m[o + 15] = 1;
    const co = Ly.count * 3;
    cc[co] = tp.col[i * 3]!; cc[co + 1] = tp.col[i * 3 + 1]!; cc[co + 2] = tp.col[i * 3 + 2]!;
    Ly.count++;
    c.emitted++;
  }
}

function layoutRosette(c: Ctx): void {
  const { look, H, S } = c;
  const strap = look.leafShape === "strap" || look.leafShape === "linear" || look.leafShape === "needle";
  const crowns = clamp(Math.round(S / 7), 1, 6);
  const L = look.leafLengthCm;
  const W = look.leafWidthCm;
  let perCrown = Math.round(7 + 12 * look.leafDensity);
  if (c.low) perCrown = Math.round(perCrown * 0.7);
  const kt = c.rnd.get(0, crowns);
  for (let k = 0; k < crowns; k++) {
    const ko = k * CH;
    const ca = k * 2.39996 + kt[ko + 1]!;
    const cr = crowns === 1 ? 0 : S * 0.28 * Math.sqrt((k + 0.5) / crowns);
    const cx = c.x + Math.cos(ca) * cr;
    const cz = c.z + Math.sin(ca) * cr;
    const crownH = Math.min(H * (k === 0 ? 1 : 0.75 + 0.25 * kt[ko + 2]!), Math.max(1, c.waterY - c.y - 1));
    const t = c.rnd.get(1 + k, perCrown);
    for (let i = 0; i < perCrown; i++) {
      const o = i * CH;
      const inner = i / perCrown; // later = inner = younger
      const keep = c.thin + (1 - c.thin) * inner;
      if (t[o]! > keep) continue;
      const az = i * 2.39996 + kt[ko + 3]! * 6.28 + (t[o + 4]! * 2 - 1) * 0.25;
      const e0 = strap ? 52 : 28;
      const e1 = strap ? 84 : 66;
      const elev = (e0 + (e1 - e0) * inner + (t[o + 5]! * 2 - 1) * 8) * DEG;
      dirFrom(elev, az, dir);
      const reach = crownH * (0.72 + 0.3 * t[o + 6]!) * (0.8 + 0.2 * inner);
      const len = reach / (0.3 + 0.7 * Math.sin(elev));
      const wScale = clamp(len / L, 0.55, 1.25);
      const youth = inner * 0.9;
      const ao = 0.5 + 0.5 * inner;
      if (!emitLeaf(c, look.leafShape, cx, c.y - 0.2, cz, dir[0]!, dir[1]!, dir[2]!, strap ? 0.7 : 0.5,
        (t[o + 9]! - 0.5) * 0.3, (t[o + 10]! - 0.5) * 0.2, t[o + 8]! * 2 - 1,
        len, W * wScale, youth, ao)) return;
    }
  }
}

function layoutEpiphyte(c: Ctx): void {
  const { look, H, S } = c;
  const L = look.leafLengthCm;
  const W = look.leafWidthCm;
  let n = Math.round((5 + S * 1.1) * (0.6 + 0.6 * look.leafDensity));
  if (c.low) n = Math.round(n * 0.7);
  const gs = clamp(H / (L * 1.1), 0.35, 1.15);
  const t = c.rnd.get(0, n + 1);
  const rhAng = (t[n * CH + 1]! * 2 - 1) * 0.6;
  const rhLen = S * 0.5;
  for (let i = 0; i < n; i++) {
    const o = i * CH;
    const keep = c.thin + (1 - c.thin) * (i / n);
    if (t[o]! > keep) continue;
    const u = t[o + 2]! - 0.5;
    const bx = c.x + Math.cos(rhAng) * rhLen * u;
    const bz = c.z + Math.sin(rhAng) * rhLen * u + (t[o + 3]! * 2 - 1) * S * 0.08;
    const size = (0.65 + 0.45 * t[o + 4]!) * gs;
    const len = L * size;
    const lift = Math.pow(t[o + 5]!, 1.5) * Math.max(0, H - len * 0.8) * 0.3;
    const elev = (28 + 36 * t[o + 6]!) * DEG;
    // bias azimuths forward/outward so leaves fan towards the viewer
    const az = Math.PI * 0.5 + (t[o + 7]! * 2 - 1) * Math.PI * 0.85;
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
    const youth = t[o + 8]! * 0.7 + (i / n) * 0.3;
    const ao = 0.55 + 0.45 * (lift / Math.max(1, H));
    if (!emitLeaf(c, look.leafShape, px, py, pz, dir[0]!, dir[1]!, dir[2]!, 0.5,
      (t[o + 9]! - 0.5) * 0.3, (t[o + 10]! - 0.5) * 0.2, t[o + 11]! * 2 - 1,
      len, W * size, youth, ao)) return;
  }
}

function layoutFloating(c: Ctx): void {
  const { look, S } = c;
  const R = S / 2;
  const L = look.leafLengthCm;
  const W = look.leafWidthCm;
  const n = Math.min(400, Math.round(Math.PI * R * R * look.leafDensity * 0.9 / Math.max(0.05, L * W) * (c.low ? 0.5 : 1)));
  const t = c.rnd.get(0, n);
  for (let i = 0; i < n; i++) {
    const o = i * CH;
    if (t[o]! > c.thin) continue;
    const r = R * Math.sqrt(t[o + 2]!);
    const a = t[o + 3]! * Math.PI * 2;
    const az = t[o + 4]! * Math.PI * 2;
    dirFrom((4 + 10 * t[o + 5]!) * DEG, az, dir);
    const size = 0.7 + 0.5 * t[o + 6]!;
    if (!emitLeaf(c, look.leafShape, c.x + Math.cos(a) * r, c.waterY - 0.15, c.z + Math.sin(a) * r,
      dir[0]!, dir[1]!, dir[2]!, 0.15, (t[o + 9]! - 0.5) * 0.3, (t[o + 10]! - 0.5) * 0.2, t[o + 8]! * 2 - 1,
      L * size, W * size, t[o + 7]!, 0.9)) return;
  }
}

/**
 * Lay out one plant into `buf`. Returns the number of instances emitted.
 * Deterministic in (plant.id, look, plant dims, quality). Pass `rnd` (from a
 * LayoutCache) to reuse the plant's per-leaf randoms across calls.
 */
export function layoutPlant(
  buf: InstanceBuffer,
  look: SpeciesLook,
  plant: PlantVisual,
  opts: LayoutOptions,
  rnd?: LeafRandoms,
): number {
  const health = clamp(Number.isFinite(plant.health) ? plant.health : 1, 0, 1);
  const H = Math.max(0.3, plant.heightCm || 0);
  const S = Math.max(0.5, plant.spreadCm || 0);
  const seed = hashString(plant.id);
  const c: Ctx = {
    buf,
    look,
    pal: makePalette(look, health),
    rnd: rnd && rnd.seed === seed ? rnd : new LeafRandoms(seed),
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

// ---------------------------------------------------------------------------
// Layout cache (timeline scrubbing)

interface CacheEntry {
  key: string;
  rnd: LeafRandoms;
  /** cached instances per layer (index into LAYER_KEYS); arrays are reused */
  slices: { m: Float32Array; c: Float32Array; n: number }[];
  gen: number;
}

const lookIds = new WeakMap<SpeciesLook, number>();
let nextLookId = 1;
const before: number[] = [];
function lookIdOf(l: SpeciesLook): number {
  let id = lookIds.get(l);
  if (id === undefined) {
    id = nextLookId++;
    lookIds.set(l, id);
  }
  return id;
}

/**
 * Re-layout cache keyed per plant id:
 *  • exact hit (same species look object, dims, position, health, bed,
 *    quality) → the plant's instances are memcpy'd from the cache;
 *  • miss → the plant is laid out again but reuses its cached per-leaf
 *    randoms (LeafRandoms), which is the expensive, size-independent part.
 * Entries for plants that disappear are dropped on the next `endFrame()`.
 */
export class LayoutCache {
  hits = 0;
  misses = 0;
  private entries = new Map<string, CacheEntry>();
  private gen = 0;

  beginFrame(): void {
    this.gen++;
  }

  endFrame(): void {
    for (const [k, e] of this.entries) if (e.gen !== this.gen) this.entries.delete(k);
  }

  get size(): number {
    return this.entries.size;
  }

  layout(buf: InstanceBuffer, look: SpeciesLook, plant: PlantVisual, opts: LayoutOptions): number {
    const b = opts.bounds;
    const key =
      `${lookIdOf(look)}|${opts.quality}|${plant.x}|${plant.z}|${plant.y}|${plant.heightCm}|${plant.spreadCm}|${plant.health}` +
      `|${opts.baseY}|${opts.waterY}|${b ? `${b.halfW},${b.halfD}` : "-"}`;
    let e = this.entries.get(plant.id);
    if (e && e.key === key) {
      this.hits++;
      e.gen = this.gen;
      let n = 0;
      for (let i = 0; i < LAYER_KEYS.length; i++) {
        const s = e.slices[i]!;
        if (s.n === 0) continue;
        const L = buf.layers[LAYER_KEYS[i]!];
        L.reserve(L.count + s.n);
        L.matrices.set(s.m.subarray(0, s.n * 16), L.count * 16);
        L.colors.set(s.c.subarray(0, s.n * 3), L.count * 3);
        L.count += s.n;
        n += s.n;
      }
      return n;
    }
    this.misses++;
    const seed = hashString(plant.id);
    if (!e || e.rnd.seed !== seed) {
      e = {
        key: "",
        rnd: new LeafRandoms(seed),
        slices: LAYER_KEYS.map(() => ({ m: new Float32Array(0), c: new Float32Array(0), n: 0 })),
        gen: this.gen,
      };
      this.entries.set(plant.id, e);
    }
    for (let i = 0; i < LAYER_KEYS.length; i++) before[i] = buf.layers[LAYER_KEYS[i]!].count;
    const n = layoutPlant(buf, look, plant, opts, e.rnd);
    for (let i = 0; i < LAYER_KEYS.length; i++) {
      const L = buf.layers[LAYER_KEYS[i]!];
      const from = before[i]!;
      const cnt = L.count - from;
      const s = e.slices[i]!;
      s.n = cnt;
      if (cnt <= 0) continue;
      if (s.c.length < cnt * 3) {
        const cap = Math.ceil(cnt * 1.25);
        s.m = new Float32Array(cap * 16);
        s.c = new Float32Array(cap * 3);
      }
      s.m.set(L.matrices.subarray(from * 16, L.count * 16));
      s.c.set(L.colors.subarray(from * 3, L.count * 3));
    }
    e.key = key;
    e.gen = this.gen;
    return n;
  }
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
