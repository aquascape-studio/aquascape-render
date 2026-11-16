/**
 * Stylized driftwood (contract 1.3.0): "branchy" spider-wood, "root" Nature
 * tree, "log" bog-wood. Each piece is a skeleton of limbs (Catmull-Rom curves
 * with a radius taper) swept into smooth tubes with rounded caps and analytic
 * normals, merged into ONE indexed BufferGeometry with vertex colours
 * (#7A5A43 at the base → #A88466 at the tips). No bark, no creases: children
 * leave their parent along the parent's tangent with a flared collar so forks
 * read as soft sculpted joints.
 *
 * Output spans exactly the bounding box: x ∈ [−w/2, w/2], y ∈ [0, h],
 * z ∈ [−d/2, d/2] (sizeCm). Deterministic in (size, seed, style, quality).
 */
import * as THREE from "three";
import type { WoodStyle } from "../contract.js";
import type { RenderQuality } from "./layout.js";
import { rand, srand } from "./rng.js";

export const WOOD_STYLES: readonly WoodStyle[] = ["branchy", "root", "log"];
export const DEFAULT_WOOD_STYLE: WoodStyle = "branchy";

/** Resolve the optional woodStyle (unknown values fall back to "branchy"). */
export function woodStyleOf(s: WoodStyle | undefined | null): WoodStyle {
  return s === "root" || s === "log" || s === "branchy" ? s : DEFAULT_WOOD_STYLE;
}

/** Base (dark) and tip (light) wood colours, sRGB. */
export const WOOD_BASE_HEX = "#7A5A43";
export const WOOD_TIP_HEX = "#A88466";

type V3 = [number, number, number];

export type LimbKind = "base" | "root" | "trunk" | "branch" | "twig" | "log" | "stub";

interface Limb {
  kind?: LimbKind;
  pts: V3[];
  /** radius along normalised arc length t ∈ [0, 1] */
  radius: (t: number) => number;
  /** colour parameter (0 = base, 1 = tip) at t = 0 and t = 1 */
  s0: number;
  s1: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const mix3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/**
 * Taper r0 → r1 with an optional flared collar at the base (soft fork) and a
 * very gentle undulation so long limbs don't read as pipes.
 */
function taper(r0: number, r1: number, flare = 0, wobble = 0.05, phase = 0, pow = 0.9): (t: number) => number {
  return (t) => {
    const base = lerp(r0, r1, Math.pow(clamp(t, 0, 1), pow));
    return base * (1 + flare * Math.exp(-t * 9)) * (1 + wobble * Math.sin(t * 9.5 + phase));
  };
}

/**
 * Taper for a limb forking off a parent whose radius at the fork is
 * `parentR`: the flared collar never exceeds 80% of the parent, so the child
 * emerges from inside it (soft joint, no protruding ring).
 */
function childTaper(parentR: number, r0: number, r1: number, flare: number, wobble: number, phase: number, pow = 0.9): (t: number) => number {
  const r0c = Math.min(r0, (0.8 * parentR) / ((1 + flare) * (1 + wobble)));
  return taper(r0c, Math.min(r1, r0c * 0.8), flare, wobble, phase, pow);
}

/** Sampled limb centreline (uniform in arc length), used by children too. */
interface Sampled {
  p: V3[];
  t: V3[];
  /** cumulative arc length fraction */
  u: number[];
  length: number;
}

const tmpCurvePts: THREE.Vector3[] = [];
function sampleCurve(pts: V3[], n: number): Sampled {
  tmpCurvePts.length = 0;
  for (const p of pts) tmpCurvePts.push(new THREE.Vector3(p[0], p[1], p[2]));
  const curve = new THREE.CatmullRomCurve3(tmpCurvePts, false, "centripetal");
  const sp = curve.getSpacedPoints(n);
  const p: V3[] = sp.map((v) => [v.x, v.y, v.z]);
  const t: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = p[Math.max(0, i - 1)]!;
    const b = p[Math.min(n, i + 1)]!;
    t.push(norm(sub(b, a)));
  }
  const u: number[] = [];
  let acc = 0;
  for (let i = 0; i <= n; i++) {
    if (i > 0) acc += len(sub(p[i]!, p[i - 1]!));
    u.push(acc);
  }
  for (let i = 0; i <= n; i++) u[i] = acc > 0 ? u[i]! / acc : i / n;
  return { p, t, u, length: acc };
}

/** Point + tangent at arc fraction t of a sampled curve. */
function at(s: Sampled, t: number): { p: V3; t: V3 } {
  const n = s.p.length - 1;
  const f = clamp(t, 0, 1) * n;
  const i = Math.min(n - 1, Math.floor(f));
  const k = f - i;
  return { p: mix3(s.p[i]!, s.p[i + 1]!, k), t: norm(mix3(s.t[i]!, s.t[i + 1]!, k)) };
}

/**
 * Child limb control points leaving `parent` at arc fraction `t0` along the
 * parent's tangent, then bending towards `end` (soft Y-fork, no kink).
 */
function fork(parent: Sampled, t0: number, end: V3, lead: number, wig: V3 = [0, 0, 0]): V3[] {
  const a = at(parent, t0);
  const p1 = add(a.p, mul(a.t, lead));
  const p2 = add(mix3(p1, end, 0.55), wig);
  return [a.p, p1, p2, end];
}

// ---------------------------------------------------------------------------
// Skeletons (cm, before the exact bounding-box fit)

interface Skeleton {
  limbs: Limb[];
}

/** spider-wood: short buried base → 4–7 slender branches fanning up/out + twigs. */
function branchySkeleton(w: number, h: number, d: number, seed: number): Skeleton {
  const limbs: Limb[] = [];
  const rb = clamp(Math.min(w * 0.7, h) * 0.06, 0.25, 4);
  const hub: V3 = [srand(seed, 0, 1) * w * 0.04, h * 0.16, srand(seed, 0, 2) * d * 0.06];
  const basePts: V3[] = [[hub[0] * 0.3, -h * 0.03, hub[2] * 0.3], [hub[0] * 0.6, h * 0.07, hub[2] * 0.6], hub];
  limbs.push({ kind: "base", pts: basePts, radius: taper(rb * 1.6, rb * 1.15, 0.1, 0.03, seed % 7), s0: 0, s1: 0.18 });
  const base = sampleCurve(basePts, 8);
  // short roots gripping the bed
  const nRoots = 2 + Math.floor(rand(seed, 0, 3) * 2);
  for (let i = 0; i < nRoots; i++) {
    const az = (i / nRoots) * Math.PI * 2 + srand(seed, i, 4) * 0.6;
    const r = (0.1 + 0.06 * rand(seed, i, 5)) * w;
    const end: V3 = [Math.cos(az) * r, -h * 0.02, Math.sin(az) * Math.min(r, d * 0.35)];
    const a = at(base, 0.35);
    const mid: V3 = [lerp(a.p[0], end[0], 0.5), a.p[1] * 0.6, lerp(a.p[2], end[2], 0.5)];
    limbs.push({ kind: "root", pts: [a.p, mid, end], radius: childTaper(rb * 1.6, rb * 0.9, rb * 0.3, 0.25, 0.04, i), s0: 0.05, s1: 0.3 });
  }
  const n = 4 + Math.floor(rand(seed, 0, 6) * 4); // 4..7
  for (let i = 0; i < n; i++) {
    const u = -1 + (2 * (i + 0.5)) / n + srand(seed, i, 7) * (0.5 / n);
    const spread = 0.82 + 0.18 * rand(seed, i, 8);
    const end: V3 = [
      u * w * 0.5 * spread,
      h * (1 - 0.3 * Math.pow(Math.abs(u), 1.6)) * (0.86 + 0.14 * rand(seed, i, 9)),
      srand(seed, i, 10) * d * 0.42,
    ];
    const L = len(sub(end, hub));
    const wig: V3 = [srand(seed, i, 11) * L * 0.06, srand(seed, i, 12) * L * 0.05, srand(seed, i, 13) * L * 0.08];
    // start steeply upwards, curve outwards: classic spider-wood fan
    const pts = fork(base, 1, end, L * 0.22, wig);
    pts.splice(2, 0, add(mix3(pts[1]!, end, 0.3), [0, L * 0.06, 0]));
    const rOf = childTaper(rb * 1.2, rb * (0.95 - 0.15 * Math.abs(u)), rb * 0.2, 0.25, 0.06, i * 1.7, 0.75);
    limbs.push({ kind: "branch", pts, radius: rOf, s0: 0.18, s1: 1 });
    // secondary twig(s)
    if (rand(seed, i, 14) < 0.65) {
      const br = sampleCurve(pts, 16);
      const t0 = 0.42 + 0.25 * rand(seed, i, 15);
      const a = at(br, t0);
      const side = u >= 0 ? 1 : -1;
      const dir = norm([a.t[0] + side * 0.9, a.t[1] + 0.5, a.t[2] + srand(seed, i, 16) * 0.6]);
      const tl = br.length * (0.22 + 0.12 * rand(seed, i, 17));
      const tEnd = add(a.p, mul(dir, tl));
      limbs.push({
        kind: "twig",
        pts: fork(br, t0, tEnd, tl * 0.25),
        radius: childTaper(rOf(t0), rOf(t0) * 0.7, rb * 0.11, 0.25, 0.03, i),
        s0: lerp(0.18, 1, t0),
        s1: 1,
      });
    }
  }
  return { limbs };
}

/** Nature-style tree: leaning trunk, flared roots, 2–4 branches to the far side. */
function rootSkeleton(w: number, h: number, d: number, seed: number): Skeleton {
  const limbs: Limb[] = [];
  const s = rand(seed, 1, 1) < 0.5 ? -1 : 1; // lean direction
  const lean = ((30 + 15 * rand(seed, 1, 2)) * Math.PI) / 180;
  const rt = clamp(Math.min(w * 0.6, h) * 0.13, 0.5, 8);
  const B: V3 = [-s * w * 0.24, -h * 0.02, srand(seed, 1, 3) * d * 0.1];
  const topY = h * (0.62 + 0.08 * rand(seed, 1, 4));
  const T: V3 = [clamp(B[0] + s * Math.tan(lean) * topY, -w * 0.32, w * 0.32), topY, B[2] + srand(seed, 1, 5) * d * 0.15];
  const dir = sub(T, B);
  const bow = srand(seed, 1, 6) * d * 0.12;
  const trunkPts: V3[] = [
    B,
    add(B, add(mul(dir, 0.3), [-s * w * 0.05, 0, bow])),
    add(B, add(mul(dir, 0.68), [s * w * 0.045, 0, -bow * 0.5])),
    T,
  ];
  const trunkBody = taper(rt, rt * 0.42, 0.45, 0.06, seed % 5, 0.7);
  // past the last fork the trunk narrows quickly into a soft rounded tip (no cut stub)
  const trunkR = (t: number) => {
    const k = clamp((t - 0.84) / 0.16, 0, 1);
    return trunkBody(t) * (1 - 0.55 * k * k * (3 - 2 * k));
  };
  limbs.push({ kind: "trunk", pts: trunkPts, radius: trunkR, s0: 0, s1: 0.55 });
  const trunk = sampleCurve(trunkPts, 24);
  // flared roots into the bed, mostly behind the lean
  const nRoots = 3 + Math.floor(rand(seed, 1, 7) * 3); // 3..5
  for (let i = 0; i < nRoots; i++) {
    const az = Math.PI * (s > 0 ? 1 : 0) + ((i / Math.max(1, nRoots - 1)) - 0.5) * Math.PI * 1.5 + srand(seed, i, 8) * 0.25;
    const r = (0.16 + 0.1 * rand(seed, i, 9)) * w;
    const a = at(trunk, 0.07 + 0.05 * rand(seed, i, 10));
    const end: V3 = [a.p[0] + Math.cos(az) * r, -h * 0.03, clamp(a.p[2] + Math.sin(az) * r * 0.8, -d * 0.45, d * 0.45)];
    const knee: V3 = [lerp(a.p[0], end[0], 0.45), a.p[1] + h * 0.035, lerp(a.p[2], end[2], 0.45)];
    limbs.push({
      kind: "root",
      pts: [a.p, mix3(a.p, knee, 0.5), knee, end],
      radius: childTaper(trunkR(0.1), rt * 0.55, rt * 0.08, 0.2, 0.05, i * 2.1, 0.8),
      s0: 0.02,
      s1: 0.35,
    });
  }
  // branches reaching to the far side (+s)
  const nb = 2 + Math.floor(rand(seed, 1, 11) * 3); // 2..4
  for (let i = 0; i < nb; i++) {
    const t0 = nb === 1 ? 0.8 : 0.48 + (0.38 * i) / (nb - 1);
    const a = at(trunk, Math.min(0.98, t0));
    const reach = 0.3 + 0.2 * rand(seed, i, 12);
    const end: V3 = [
      s * w * (i === nb - 1 ? 0.5 : reach + 0.05),
      h * (i === nb - 1 ? 0.88 + 0.12 * rand(seed, i, 13) : 0.72 + 0.26 * rand(seed, i, 13)),
      srand(seed, i, 14) * d * 0.4,
    ];
    const L = len(sub(end, a.p));
    const wig: V3 = [0, L * (0.05 + 0.06 * rand(seed, i, 15)), srand(seed, i, 16) * L * 0.08];
    const pts = fork(trunk, Math.min(0.98, t0), end, L * 0.18, wig);
    const r0 = trunkR(Math.min(0.98, t0)) * (i === nb - 1 ? 0.9 : 0.68);
    const rOf = childTaper(trunkR(t0), r0, rt * 0.07, 0.25, 0.06, i * 1.3, 0.75);
    limbs.push({ kind: "branch", pts, radius: rOf, s0: lerp(0, 0.55, t0), s1: 1 });
    if (rand(seed, i, 17) < 0.7) {
      const br = sampleCurve(pts, 16);
      const tt = 0.45 + 0.25 * rand(seed, i, 18);
      const b = at(br, tt);
      const tdir = norm([b.t[0] * 0.6, b.t[1] + 0.8, b.t[2] + srand(seed, i, 19) * 0.5]);
      const tl = br.length * (0.25 + 0.12 * rand(seed, i, 20));
      limbs.push({
        kind: "twig",
        pts: fork(br, tt, add(b.p, mul(tdir, tl)), tl * 0.25),
        radius: childTaper(rOf(tt), rOf(tt) * 0.7, rt * 0.06, 0.25, 0.03, i),
        s0: lerp(0.55, 1, tt),
        s1: 1,
      });
    }
  }
  // a short counter-branch back over the trunk for balance
  {
    const t0 = 0.62 + 0.1 * rand(seed, 2, 1);
    const a = at(trunk, t0);
    const end: V3 = [a.p[0] - s * w * (0.12 + 0.06 * rand(seed, 2, 2)), h * (0.86 + 0.1 * rand(seed, 2, 3)), a.p[2] + srand(seed, 2, 4) * d * 0.2];
    const L = len(sub(end, a.p));
    limbs.push({ kind: "twig", pts: fork(trunk, t0, end, L * 0.2), radius: childTaper(trunkR(t0), trunkR(t0) * 0.55, rt * 0.07, 0.25, 0.04, 3), s0: 0.4, s1: 1 });
  }
  return { limbs };
}

/** Bog-wood log: low horizontal chunk with 1–2 short stubs. */
function logSkeleton(w: number, h: number, d: number, seed: number): Skeleton {
  const limbs: Limb[] = [];
  const rl = clamp(Math.min(h * 0.3, d * 0.32, w * 0.12), 0.4, 12);
  const n = 5;
  const pts: V3[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    pts.push([
      lerp(-w * 0.5 + rl, w * 0.5 - rl, t),
      rl * (1 + 0.25 * Math.sin(t * Math.PI)) + srand(seed, i, 1) * rl * 0.25,
      srand(seed, i, 2) * d * 0.18 + (t - 0.5) * srand(seed, 9, 3) * d * 0.25,
    ]);
  }
  const ph = rand(seed, 0, 4) * 6.28;
  const asym = 0.7 + 0.25 * rand(seed, 0, 5);
  const logR = (t: number) => rl * lerp(1, asym, t) * (1 + 0.14 * Math.sin(Math.PI * t)) * (1 + 0.07 * Math.sin(t * 7 + ph));
  limbs.push({ kind: "log", pts, radius: logR, s0: 0.1, s1: 0.45 });
  const log = sampleCurve(pts, 24);
  const ns = 1 + (rand(seed, 0, 6) < 0.55 ? 1 : 0);
  for (let i = 0; i < ns; i++) {
    const t0 = ns === 1 ? 0.35 + 0.3 * rand(seed, i, 7) : i === 0 ? 0.22 + 0.15 * rand(seed, i, 7) : 0.6 + 0.18 * rand(seed, i, 7);
    const a = at(log, t0);
    const side = srand(seed, i, 8) >= 0 ? 1 : -1;
    const top = h * (i === 0 ? 1 : 0.78 + 0.15 * rand(seed, i, 9));
    const end: V3 = [a.p[0] + side * (top - a.p[1]) * (0.5 + 0.4 * rand(seed, i, 10)), top, a.p[2] + srand(seed, i, 11) * d * 0.15];
    const start: V3 = add(a.p, [0, logR(t0) * 0.35, 0]);
    const p1 = add(start, [side * logR(t0) * 0.2, logR(t0) * 0.7, 0]);
    limbs.push({
      kind: "stub",
      pts: [start, p1, add(mix3(p1, end, 0.5), [side * rl * 0.15, 0, 0]), end],
      radius: childTaper(logR(t0) * 1.4, logR(t0) * 0.55, rl * 0.24, 0.3, 0.04, i),
      s0: 0.4,
      s1: 1,
    });
  }
  return { limbs };
}

function skeleton(style: WoodStyle, w: number, h: number, d: number, seed: number): Skeleton {
  switch (style) {
    case "root":
      return rootSkeleton(w, h, d, seed);
    case "log":
      return logSkeleton(w, h, d, seed);
    default:
      return branchySkeleton(w, h, d, seed);
  }
}

// ---------------------------------------------------------------------------
// Sweep

interface Detail {
  ring: number;
  /** samples per cm (relative to mean radius) */
  density: number;
  cap: number;
  maxSeg: number;
}
const DETAIL: Record<RenderQuality, Detail> = {
  high: { ring: 16, density: 1.1, cap: 5, maxSeg: 48 },
  low: { ring: 10, density: 0.6, cap: 3, maxSeg: 24 },
};

class Builder {
  pos: number[] = [];
  nor: number[] = [];
  /** colour parameter s and raw y per vertex (colour assigned after the fit) */
  col: number[] = [];
  idx: number[] = [];

  vert(p: V3, n: V3, s: number): number {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.col.push(s);
    return this.pos.length / 3 - 1;
  }

  sweep(limb: Limb, det: Detail): void {
    const M = det.ring;
    const approxLen = limb.pts.reduce((a, p, i) => (i ? a + len(sub(p, limb.pts[i - 1]!)) : 0), 0);
    const rMean = Math.max(0.05, (limb.radius(0) + limb.radius(0.5) + limb.radius(1)) / 3);
    const n = clamp(Math.round((approxLen / rMean) * det.density), 6, det.maxSeg);
    const c = sampleCurve(limb.pts, n);
    const dt = 1 / n;
    // parallel-transport frames
    let nrm: V3 = Math.abs(c.t[0]![1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const frames: { n: V3; b: V3 }[] = [];
    for (let i = 0; i <= n; i++) {
      const t = c.t[i]!;
      const d0 = nrm[0] * t[0] + nrm[1] * t[1] + nrm[2] * t[2];
      nrm = norm(sub(nrm, mul(t, d0)));
      const b: V3 = [t[1] * nrm[2] - t[2] * nrm[1], t[2] * nrm[0] - t[0] * nrm[2], t[0] * nrm[1] - t[1] * nrm[0]];
      frames.push({ n: nrm, b });
    }
    const L = Math.max(1e-6, c.length);
    const ring = (i: number, center: V3, r: number, tang: V3, axial: number, s: number) => {
      const f = frames[i]!;
      const first = this.pos.length / 3;
      for (let j = 0; j < M; j++) {
        const a = (j / M) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const rad: V3 = [f.n[0] * ca + f.b[0] * sa, f.n[1] * ca + f.b[1] * sa, f.n[2] * ca + f.b[2] * sa];
        this.vert(add(center, mul(rad, r)), norm(add(rad, mul(tang, axial))), s);
      }
      return first;
    };
    const rings: number[] = [];
    // start cap (rounded), from the pole inwards
    const capRings = (end: 0 | 1) => {
      const i = end === 0 ? 0 : n;
      const t = c.t[i]!;
      const sgn = end === 0 ? -1 : 1;
      const r = limb.radius(end);
      const s = end === 0 ? limb.s0 : limb.s1;
      const out: number[] = [];
      for (let k = det.cap - 1; k >= 1; k--) {
        const phi = (k / det.cap) * (Math.PI / 2);
        const center = add(c.p[i]!, mul(t, sgn * r * Math.sin(phi) * 0.85));
        out.push(ring(i, center, r * Math.cos(phi), mul(t, sgn), Math.tan(phi), s));
      }
      return out;
    };
    const pole = (end: 0 | 1) => {
      const i = end === 0 ? 0 : n;
      const t = c.t[i]!;
      const sgn = end === 0 ? -1 : 1;
      const r = limb.radius(end);
      return this.vert(add(c.p[i]!, mul(t, sgn * r * 0.85)), mul(t, sgn), end === 0 ? limb.s0 : limb.s1);
    };
    const p0 = pole(0);
    rings.push(...capRings(0));
    for (let i = 0; i <= n; i++) {
      const u = c.u[i]!;
      const r = limb.radius(u);
      const drds = (limb.radius(Math.min(1, u + dt * 0.5)) - limb.radius(Math.max(0, u - dt * 0.5))) / (dt * L);
      rings.push(ring(i, c.p[i]!, r, c.t[i]!, -drds, lerp(limb.s0, limb.s1, u)));
    }
    rings.push(...capRings(1).reverse());
    const p1 = pole(1);
    // fans to the poles
    const r0 = rings[0]!;
    for (let j = 0; j < M; j++) this.idx.push(p0, r0 + ((j + 1) % M), r0 + j);
    for (let k = 0; k < rings.length - 1; k++) {
      const a = rings[k]!;
      const b = rings[k + 1]!;
      for (let j = 0; j < M; j++) {
        const j1 = (j + 1) % M;
        this.idx.push(a + j, a + j1, b + j, a + j1, b + j1, b + j);
      }
    }
    const rl = rings[rings.length - 1]!;
    for (let j = 0; j < M; j++) this.idx.push(p1, rl + j, rl + ((j + 1) % M));
  }
}

function hexToLinear(hex: string): V3 {
  const c = new THREE.Color(hex); // three converts sRGB hex to the linear working space
  return [c.r, c.g, c.b];
}

/**
 * Build one driftwood piece. Single indexed geometry with position, normal
 * (smooth, analytic) and linear-space vertex colours; bounding box = size.
 */
export function makeWoodGeometry(
  size: [number, number, number],
  seed: number,
  style: WoodStyle | undefined,
  quality: RenderQuality = "high",
): THREE.BufferGeometry {
  const w = Math.max(0.5, Math.abs(size[0]));
  const h = Math.max(0.5, Math.abs(size[1]));
  const d = Math.max(0.5, Math.abs(size[2]));
  const st = woodStyleOf(style);
  const sk = skeleton(st, w, h, d, seed >>> 0);
  const b = new Builder();
  const det = DETAIL[quality];
  for (const limb of sk.limbs) b.sweep(limb, det);

  // exact bounding-box fit (scale factors stay close to 1: skeleton is in cm)
  const P = b.pos;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i]!, y = P[i + 1]!, z = P[i + 2]!;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const sx = w / Math.max(1e-6, maxX - minX);
  const sy = h / Math.max(1e-6, maxY - minY);
  const sz = d / Math.max(1e-6, maxZ - minZ);
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const nv = P.length / 3;
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const col = new Float32Array(nv * 3);
  const c0 = hexToLinear(WOOD_BASE_HEX);
  const c1 = hexToLinear(WOOD_TIP_HEX);
  const N = b.nor;
  const contact = Math.max(0.6, h * 0.12);
  for (let v = 0; v < nv; v++) {
    const o = v * 3;
    const y = (P[o + 1]! - minY) * sy;
    pos[o] = (P[o]! - cx) * sx;
    pos[o + 1] = y;
    pos[o + 2] = (P[o + 2]! - cz) * sz;
    // normals under non-uniform scale: n' ∝ S⁻¹ n
    let nx = N[o]! / sx, ny = N[o + 1]! / sy, nz = N[o + 2]! / sz;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
    const s = b.col[v]!;
    const k = s * s * (3 - 2 * s); // smoothstep
    // soft contact darkening near the bed + faint top-light lift
    const ao = 0.82 + 0.18 * clamp(y / contact, 0, 1);
    const lift = 1 + 0.05 * Math.max(0, ny);
    for (let ch = 0; ch < 3; ch++) col[o + ch] = lerp(c0[ch]!, c1[ch]!, k) * ao * lift;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Limb kinds of a style's skeleton (tests: branch / stub counts per style). */
export function woodLimbKinds(size: [number, number, number], seed: number, style: WoodStyle): LimbKind[] {
  return skeleton(style, Math.abs(size[0]), Math.abs(size[1]), Math.abs(size[2]), seed >>> 0).limbs.map((l) => l.kind ?? "branch");
}

/** Trunk lean of a "root" piece from vertical, radians, and its side (−1 left / +1 right). */
export function rootLean(size: [number, number, number], seed: number): { angle: number; side: number } {
  const t = skeleton("root", Math.abs(size[0]), Math.abs(size[1]), Math.abs(size[2]), seed >>> 0).limbs.find((l) => l.kind === "trunk")!;
  const a = t.pts[0]!;
  const b = t.pts[t.pts.length - 1]!;
  return { angle: Math.atan2(Math.abs(b[0] - a[0]), b[1] - a[1]), side: Math.sign(b[0] - a[0]) };
}
