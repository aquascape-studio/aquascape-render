/**
 * Hardscape top surfaces (contract 1.4.0): hardscapeSurfaceY, hardscapeAnchors
 * and the surface field the plant layout uses to sit epiphytes / moss on wood
 * and stones.
 *
 * Exact w.r.t. the rendered mesh: a piece's geometry comes from the same
 * builder as the per-piece render cache (buildHardscapeGeometry), is moved by
 * the same placement transform the renderer applies (outer group: position +
 * lean, inner group: rotationY), and columns are intersected against its
 * actual triangles through a 2D uniform grid. No three.js scene is needed.
 *
 * Frame: x / z are tank coordinates; y is measured above the piece's
 * reference bed plane — the local bed at the piece as if it were flat
 * (stonePlacement().bedRef in the renderer). On a flat bed that is exactly
 * "above the local bed surface" (PlantVisual.y); on a sloped bed the renderer
 * draws attached plants at bedRef + y so they still sit on the mesh.
 */
import * as THREE from "three";
import type { HardscapeVisual, SurfaceAnchor } from "../contract.js";
import { buildHardscapeGeometry, hardscapeShapeKey } from "./hardscapeCache.js";
import type { RenderQuality } from "./layout.js";
import { pieceFrame } from "./stones.js";

export interface SurfaceOpts {
  quality?: "high" | "low" | undefined;
}

/** Minimum normal.y of an anchor (upward-facing surface). */
export const ANCHOR_MIN_NY = 0.35;
/** Anchors closer than this are not returned (tiny surfaces yield fewer than n). */
export const ANCHOR_MIN_SPACING_CM = 0.75;
/** Anchors must be at least this high above the bed (not on buried parts). */
export const ANCHOR_MIN_Y_CM = 0.5;

const TRI_STRIDE = 10; // x0 z0 e1x e1z e2x e2z invDen y0 dy1 dy2

export interface SurfaceHit {
  y: number;
  nx: number;
  ny: number;
  nz: number;
}

/**
 * One placed piece's triangles in the surface frame, binned by x/z for
 * vertical column queries.
 */
export class PieceSurface {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly triCount: number;
  /** transformed vertex positions / normals (frame) */
  readonly pos: Float64Array;
  readonly nor: Float64Array;
  readonly index: Uint32Array;
  /** limb id per triangle (each limb is a closed surface) */
  readonly limb: Uint16Array;
  readonly limbCount: number;
  /** anchor hints (frame) [x, y, z, w]*, wood only */
  readonly hints: Float64Array;
  private tri: Float64Array;
  private cs: number;
  private nx: number;
  private nz: number;
  private cellStart: Int32Array;
  private cellTris: Int32Array;
  private parity: Uint8Array;
  private touched: Int32Array;

  constructor(geo: THREE.BufferGeometry, m: THREE.Matrix4) {
    const P = geo.getAttribute("position") as THREE.BufferAttribute;
    const N = geo.getAttribute("normal") as THREE.BufferAttribute;
    const nv = P.count;
    const e = m.elements;
    const pos = new Float64Array(nv * 3);
    const nor = new Float64Array(nv * 3);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < nv; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      const wx = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
      const wy = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
      const wz = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
      pos[i * 3] = wx; pos[i * 3 + 1] = wy; pos[i * 3 + 2] = wz;
      if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
      if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
      const ax = N.getX(i), ay = N.getY(i), az = N.getZ(i);
      // rigid transform: rotate normals with the upper 3×3
      const nx = e[0]! * ax + e[4]! * ay + e[8]! * az;
      const ny = e[1]! * ax + e[5]! * ay + e[9]! * az;
      const nz = e[2]! * ax + e[6]! * ay + e[10]! * az;
      const l = Math.hypot(nx, ny, nz) || 1;
      nor[i * 3] = nx / l; nor[i * 3 + 1] = ny / l; nor[i * 3 + 2] = nz / l;
    }
    this.pos = pos;
    this.nor = nor;
    this.minX = minX; this.maxX = maxX; this.minY = minY; this.maxY = maxY; this.minZ = minZ; this.maxZ = maxZ;

    const ix = geo.getIndex();
    const index = ix ? Uint32Array.from(ix.array as ArrayLike<number>) : Uint32Array.from({ length: nv }, (_, i) => i);
    this.index = index;
    const nt = index.length / 3;
    this.triCount = nt;
    // limb ids from the wood builder's triangle ranges (stones: one closed mesh)
    const starts = (geo.userData?.limbTri as number[] | undefined) ?? [0];
    const limb = new Uint16Array(nt);
    for (let l = 0; l < starts.length; l++) {
      const a = starts[l]!;
      const b = l + 1 < starts.length ? starts[l + 1]! : nt;
      limb.fill(l, a, b);
    }
    this.limb = limb;
    this.limbCount = starts.length;
    this.parity = new Uint8Array(starts.length);
    this.touched = new Int32Array(starts.length);

    const hintsLocal = (geo.userData?.anchorHints as number[] | undefined) ?? [];
    const hints = new Float64Array(hintsLocal.length);
    for (let i = 0; i < hintsLocal.length; i += 4) {
      const x = hintsLocal[i]!, y = hintsLocal[i + 1]!, z = hintsLocal[i + 2]!;
      hints[i] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
      hints[i + 1] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
      hints[i + 2] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
      hints[i + 3] = hintsLocal[i + 3]!;
    }
    this.hints = hints;

    // per-triangle 2D (x/z) barycentric setup
    const tri = new Float64Array(nt * TRI_STRIDE);
    for (let t = 0; t < nt; t++) {
      const a = index[t * 3]! * 3, b = index[t * 3 + 1]! * 3, c = index[t * 3 + 2]! * 3;
      const x0 = pos[a]!, z0 = pos[a + 2]!;
      const e1x = pos[b]! - x0, e1z = pos[b + 2]! - z0;
      const e2x = pos[c]! - x0, e2z = pos[c + 2]! - z0;
      const den = e1x * e2z - e1z * e2x;
      const o = t * TRI_STRIDE;
      tri[o] = x0; tri[o + 1] = z0; tri[o + 2] = e1x; tri[o + 3] = e1z; tri[o + 4] = e2x; tri[o + 5] = e2z;
      tri[o + 6] = Math.abs(den) < 1e-14 ? 0 : 1 / den; // 0 ⇒ vertical in x/z: never hit by a column
      tri[o + 7] = pos[a + 1]!;
      tri[o + 8] = pos[b + 1]! - pos[a + 1]!;
      tri[o + 9] = pos[c + 1]! - pos[a + 1]!;
    }
    this.tri = tri;

    // uniform x/z grid (CSR)
    const ext = Math.max(maxX - minX, maxZ - minZ, 1e-3);
    const cs = Math.max(0.25, ext / 96);
    const gx = Math.max(1, Math.ceil((maxX - minX) / cs) + 1);
    const gz = Math.max(1, Math.ceil((maxZ - minZ) / cs) + 1);
    this.cs = cs; this.nx = gx; this.nz = gz;
    const counts = new Int32Array(gx * gz + 1);
    const span = (t: number, out: Int32Array) => {
      const a = index[t * 3]! * 3, b = index[t * 3 + 1]! * 3, c = index[t * 3 + 2]! * 3;
      const lx = Math.min(pos[a]!, pos[b]!, pos[c]!), hx = Math.max(pos[a]!, pos[b]!, pos[c]!);
      const lz = Math.min(pos[a + 2]!, pos[b + 2]!, pos[c + 2]!), hz = Math.max(pos[a + 2]!, pos[b + 2]!, pos[c + 2]!);
      out[0] = Math.max(0, Math.floor((lx - minX) / cs - 1e-9));
      out[1] = Math.min(gx - 1, Math.floor((hx - minX) / cs + 1e-9));
      out[2] = Math.max(0, Math.floor((lz - minZ) / cs - 1e-9));
      out[3] = Math.min(gz - 1, Math.floor((hz - minZ) / cs + 1e-9));
    };
    const sp = new Int32Array(4);
    for (let t = 0; t < nt; t++) {
      if (tri[t * TRI_STRIDE + 6] === 0) continue;
      span(t, sp);
      for (let j = sp[2]!; j <= sp[3]!; j++) for (let i = sp[0]!; i <= sp[1]!; i++) counts[j * gx + i]!++;
    }
    const start = new Int32Array(gx * gz + 1);
    for (let k = 0; k < gx * gz; k++) start[k + 1] = start[k]! + counts[k]!;
    const fill = start.slice(0, gx * gz);
    const cells = new Int32Array(start[gx * gz]!);
    for (let t = 0; t < nt; t++) {
      if (tri[t * TRI_STRIDE + 6] === 0) continue;
      span(t, sp);
      for (let j = sp[2]!; j <= sp[3]!; j++) for (let i = sp[0]!; i <= sp[1]!; i++) cells[fill[j * gx + i]!++] = t;
    }
    this.cellStart = start;
    this.cellTris = cells;
  }

  private cell(x: number, z: number): number {
    if (!(x >= this.minX && x <= this.maxX && z >= this.minZ && z <= this.maxZ)) return -1;
    const i = Math.min(this.nx - 1, Math.floor((x - this.minX) / this.cs));
    const j = Math.min(this.nz - 1, Math.floor((z - this.minZ) / this.cs));
    return j * this.nx + i;
  }

  /** Column intersection with triangle t: y, or NaN when the column misses it. */
  private colY(t: number, x: number, z: number, bary?: number[]): number {
    const T = this.tri;
    const o = t * TRI_STRIDE;
    const inv = T[o + 6]!;
    const qx = x - T[o]!, qz = z - T[o + 1]!;
    const u = (qx * T[o + 5]! - qz * T[o + 4]!) * inv;
    if (u < -1e-9 || u > 1 + 1e-9) return NaN;
    const v = (T[o + 2]! * qz - T[o + 3]! * qx) * inv;
    if (v < -1e-9 || u + v > 1 + 1e-9) return NaN;
    if (bary) { bary[0] = u; bary[1] = v; }
    return T[o + 7]! + u * T[o + 8]! + v * T[o + 9]!;
  }

  /** Top-surface height at column (x, z), or null. */
  top(x: number, z: number): number | null {
    const c = this.cell(x, z);
    if (c < 0) return null;
    let best = -Infinity;
    const cells = this.cellTris;
    for (let k = this.cellStart[c]!, e = this.cellStart[c + 1]!; k < e; k++) {
      const y = this.colY(cells[k]!, x, z);
      if (y > best) best = y;
    }
    return best === -Infinity ? null : best;
  }

  /** Top-surface hit with the interpolated (smooth, unit) normal. */
  topHit(x: number, z: number, out: SurfaceHit): boolean {
    const c = this.cell(x, z);
    if (c < 0) return false;
    let best = -Infinity, bt = -1, bu = 0, bv = 0;
    const bary = [0, 0];
    const cells = this.cellTris;
    for (let k = this.cellStart[c]!, e = this.cellStart[c + 1]!; k < e; k++) {
      const t = cells[k]!;
      const y = this.colY(t, x, z, bary);
      if (y > best) { best = y; bt = t; bu = bary[0]!; bv = bary[1]!; }
    }
    if (bt < 0) return false;
    const I = this.index, Nn = this.nor;
    const a = I[bt * 3]! * 3, b = I[bt * 3 + 1]! * 3, cc = I[bt * 3 + 2]! * 3;
    const w0 = 1 - bu - bv;
    let nx = Nn[a]! * w0 + Nn[b]! * bu + Nn[cc]! * bv;
    let ny = Nn[a + 1]! * w0 + Nn[b + 1]! * bu + Nn[cc + 1]! * bv;
    let nz = Nn[a + 2]! * w0 + Nn[b + 2]! * bu + Nn[cc + 2]! * bv;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) {
      // degenerate: geometric face normal, pointing up
      const P = this.pos;
      const e1x = P[b]! - P[a]!, e1y = P[b + 1]! - P[a + 1]!, e1z = P[b + 2]! - P[a + 2]!;
      const e2x = P[cc]! - P[a]!, e2y = P[cc + 1]! - P[a + 1]!, e2z = P[cc + 2]! - P[a + 2]!;
      nx = e1y * e2z - e1z * e2y; ny = e1z * e2x - e1x * e2z; nz = e1x * e2y - e1y * e2x;
      const s = (ny < 0 ? -1 : 1) / (Math.hypot(nx, ny, nz) || 1);
      nx *= s; ny *= s; nz *= s;
    } else {
      nx /= l; ny /= l; nz /= l;
    }
    out.y = best; out.nx = nx; out.ny = ny; out.nz = nz;
    return true;
  }

  /**
   * Point-in-solid test by vertical ray parity, per limb (each limb is a
   * closed tube; overlapping limbs would break a global parity count).
   */
  inside(x: number, y: number, z: number): boolean {
    if (y > this.maxY || y < this.minY) return false;
    const c = this.cell(x, z);
    if (c < 0) return false;
    const par = this.parity, touched = this.touched, limb = this.limb;
    let nt = 0;
    const cells = this.cellTris;
    for (let k = this.cellStart[c]!, e = this.cellStart[c + 1]!; k < e; k++) {
      const t = cells[k]!;
      const yt = this.colY(t, x, z);
      if (!(yt > y)) continue;
      const l = limb[t]!;
      if (par[l] === 0) touched[nt++] = l;
      par[l] = par[l]! ^ 1 | 2; // bit 1 = touched, bit 0 = parity
    }
    let ins = false;
    for (let i = 0; i < nt; i++) {
      const l = touched[i]!;
      if ((par[l]! & 1) === 1) ins = true;
      par[l] = 0;
    }
    return ins;
  }
}

// ---------------------------------------------------------------------------
// Placement transform (identical to FrontalTank's HardscapeItem groups)

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _ry = new THREE.Matrix4();

/** Frame matrix of a piece: T(x, relBottom, z) · R(leanX, 0, leanZ) · R_y(rotationY). */
export function pieceMatrix(h: HardscapeVisual): THREE.Matrix4 {
  const fr = pieceFrame(h);
  const m = new THREE.Matrix4();
  _e.set(fr.leanX, 0, fr.leanZ);
  m.compose(_p.set(h.x, fr.relBottom, h.z), _q.setFromEuler(_e), _s);
  _ry.makeRotationY(h.rotationY);
  return m.multiply(_ry);
}

function qualityOf(opts?: SurfaceOpts): RenderQuality {
  return opts?.quality === "low" ? "low" : "high";
}

/** Memo key: shape (no id) + everything the placement transform reads. */
export function surfaceKey(h: HardscapeVisual, quality: RenderQuality): string {
  const fr = pieceFrame(h);
  return `${hardscapeShapeKey(h, quality)}|${h.x}|${h.z}|${h.rotationY}|${fr.relBottom}|${fr.leanX}|${fr.leanZ}`;
}

const MEMO_MAX = 48;
const memo = new Map<string, PieceSurface>();

/**
 * Surface index of a placed piece (memoised, LRU). Pass `geo` to reuse an
 * already-built render geometry for the same shape key.
 */
export function pieceSurface(h: HardscapeVisual, quality: RenderQuality = "high", geo?: THREE.BufferGeometry): PieceSurface {
  const key = surfaceKey(h, quality);
  const hit = memo.get(key);
  if (hit) {
    memo.delete(key);
    memo.set(key, hit);
    return hit;
  }
  const own = geo ? null : buildHardscapeGeometry(h, quality);
  const s = new PieceSurface(geo ?? own!, pieceMatrix(h));
  own?.dispose();
  memo.set(key, s);
  if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value!);
  return s;
}

/**
 * Contract 1.4.0: height of piece h's TOP surface at floor column (x, z),
 * above the piece's (flat) local bed, net of buriedFrac. null when the column
 * misses the piece. Values ≤ 0 mean the column only meets a buried part.
 */
export function hardscapeSurfaceY(h: HardscapeVisual, x: number, z: number, opts?: SurfaceOpts): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return pieceSurface(h, qualityOf(opts)).top(x, z);
}

const smooth = (e0: number, e1: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Contract 1.4.0: n deterministic attachment points on the upward-facing
 * (normal.y ≥ 0.35) top surface, spread by weighted farthest-point sampling,
 * sorted front-to-back (z descending) then left-to-right (x ascending).
 * Wood prefers forks, the upper trunk and the log's top; stones the upper
 * shoulders. Returns fewer than n when the surface cannot hold n points at
 * least ANCHOR_MIN_SPACING_CM apart; [] for n ≤ 0.
 */
export function hardscapeAnchors(h: HardscapeVisual, n: number, opts?: SurfaceOpts): SurfaceAnchor[] {
  const want = Math.floor(Number.isFinite(n) ? n : 0);
  if (want <= 0) return [];
  const S = pieceSurface(h, qualityOf(opts));
  const top = Math.max(1e-3, S.maxY);
  const cx: number[] = [], cy: number[] = [], cz: number[] = [], cw: number[] = [];
  const cnx: number[] = [], cny: number[] = [], cnz: number[] = [];
  const hit: SurfaceHit = { y: 0, nx: 0, ny: 1, nz: 0 };
  const push = (x: number, z: number, w: number) => {
    cx.push(x); cy.push(hit.y); cz.push(z); cw.push(w);
    cnx.push(hit.nx); cny.push(hit.ny); cnz.push(hit.nz);
  };
  const usable = () => hit.ny >= ANCHOR_MIN_NY && hit.y >= ANCHOR_MIN_Y_CM;
  const wood = h.kind === "wood";
  // preferred points (wood): forks, upper trunk, log top — projected to the top surface
  for (let i = 0; i < S.hints.length; i += 4) {
    const x = S.hints[i]!, y = S.hints[i + 1]!, z = S.hints[i + 2]!;
    if (!S.topHit(x, z, hit) || !usable()) continue;
    // a different limb over the hint: still valid surface, but not the intended spot
    const own = hit.y - y < Math.max(2, 0.2 * top);
    push(x, z, own ? S.hints[i + 3]! : 0.5);
  }
  // generic candidates: triangle centroids that are the top of their column
  const I = S.index, P = S.pos;
  const step = Math.max(1, Math.floor(S.triCount / 3000));
  for (let t = 0; t < S.triCount; t += step) {
    const a = I[t * 3]! * 3, b = I[t * 3 + 1]! * 3, c = I[t * 3 + 2]! * 3;
    const x = (P[a]! + P[b]! + P[c]!) / 3;
    const y = (P[a + 1]! + P[b + 1]! + P[c + 1]!) / 3;
    const z = (P[a + 2]! + P[b + 2]! + P[c + 2]!) / 3;
    if (!S.topHit(x, z, hit) || Math.abs(hit.y - y) > 0.05 || !usable()) continue;
    const hf = hit.y / top;
    const w = wood
      ? (0.12 + 0.3 * hf) * (0.6 + 0.4 * hit.ny) // forks / trunk / log-top hints (w ≈ 1) dominate
      : 0.15 + 0.8 * Math.exp(-(((hf - 0.72) / 0.2) ** 2)) * (0.5 + 0.5 * smooth(0.35, 0.75, hit.ny));
    push(x, z, w);
  }
  const m = cx.length;
  if (m === 0) return [];
  // weighted farthest-point sampling; preferred spots (w ≥ 0.8: forks, upper
  // trunk, log top) are used up first, then the rest of the surface
  const minD = new Float64Array(m).fill(Infinity);
  const picked: number[] = [];
  const PREF = 0.8;
  let first = 0;
  for (let i = 1; i < m; i++) if (cw[i]! > cw[first]! + 1e-12) first = i;
  let cur = first;
  while (picked.length < want) {
    picked.push(cur);
    let best = -1, bestScore = -Infinity, bestPref = false;
    for (let i = 0; i < m; i++) {
      const d = Math.hypot(cx[i]! - cx[cur]!, cy[i]! - cy[cur]!, cz[i]! - cz[cur]!);
      if (d < minD[i]!) minD[i] = d;
      if (minD[i]! < ANCHOR_MIN_SPACING_CM) continue;
      const pref = cw[i]! >= PREF && minD[i]! >= 2 * ANCHOR_MIN_SPACING_CM;
      if (bestPref && !pref) continue;
      const sc = minD[i]! * cw[i]! * cw[i]!;
      if ((pref && !bestPref) || sc > bestScore) { bestScore = sc; best = i; bestPref = pref; }
    }
    if (best < 0) break;
    cur = best;
  }
  const out: SurfaceAnchor[] = picked.map((i) => ({ x: cx[i]!, z: cz[i]!, y: cy[i]!, nx: cnx[i]!, ny: cny[i]!, nz: cnz[i]! }));
  out.sort((a, b) => (Math.abs(b.z - a.z) > 1e-6 ? b.z - a.z : a.x - b.x));
  return out;
}

// ---------------------------------------------------------------------------
// Scene surface for the plant layout (world coordinates)

/** What the layout needs to keep attached plants on / outside hardscape. */
export interface SurfaceField {
  /** world y of the highest hardscape surface over column (x, z), or null */
  top(x: number, z: number): number | null;
  /** true when the world point is inside any hardscape piece */
  inside(x: number, y: number, z: number): boolean;
}

export interface PlacedSurface {
  surf: PieceSurface;
  /** world y of the piece's reference bed plane (stonePlacement().bedRef) */
  bedRef: number;
}

export function makeSurfaceField(pieces: readonly PlacedSurface[]): SurfaceField {
  return {
    top(x, z) {
      let best: number | null = null;
      for (const p of pieces) {
        const y = p.surf.top(x, z);
        if (y !== null && (best === null || y + p.bedRef > best)) best = y + p.bedRef;
      }
      return best;
    },
    inside(x, y, z) {
      for (const p of pieces) if (p.surf.inside(x, y - p.bedRef, z)) return true;
      return false;
    },
  };
}
