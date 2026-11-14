/**
 * Procedural geometry for FrontalTank: thick rounded leaves, moss puffs,
 * stems, sculptural pebbles, stylized branches, sloped substrate bed.
 * All built once and shared; per-frame updates only touch instance buffers.
 */
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { LeafShape, StoneRole } from "../contract.js";
import { rand, srand } from "./rng.js";
import { substrateHeight, type SubstrateProfile } from "./layout.js";
import { roleShape } from "./stones.js";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Half-width profile (0..0.5) along normalised length t ∈ [0,1]. */
function widthProfile(shape: LeafShape, t: number): number {
  const base = clamp(t * 14, 0, 1); // tiny petiole pinch
  switch (shape) {
    case "lanceolate":
      return 0.5 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 0.72) * base;
    case "ovate":
      return 0.5 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.75) * base;
    case "cordate": {
      const s = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.5)), 0.7);
      return 0.5 * s * base;
    }
    case "round":
    case "moss":
      return 0.5 * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
    case "strap": {
      const tip = t < 0.86 ? 1 : Math.sqrt(Math.max(0, 1 - ((t - 0.86) / 0.14) ** 2));
      return 0.5 * Math.min(1, t * 10) * tip;
    }
    case "linear":
      return 0.5 * Math.min(1, t * 10) * Math.pow(Math.max(0, 1 - t * t * t), 0.6);
    case "needle":
      return 0.5 * Math.min(1, t * 12) * Math.pow(Math.max(0, 1 - t), 0.6);
  }
}

const BEND: Record<LeafShape, number> = {
  lanceolate: 0.28,
  ovate: 0.16,
  cordate: 0.14,
  round: 0.06,
  moss: 0,
  strap: 0.6,
  linear: 0.35,
  needle: 0.15,
};

/**
 * Thick, cupped, arching leaf. Lens-shaped cross-section (thickness ∝ local
 * width) so the rim is rounded, top + bottom share rim vertices after merge.
 * Local frame: length +Z (0..1), width X, face normal +Y.
 * Vertex colour = base→tip light gradient + faint midrib.
 */
export function makeLeafGeometry(shape: LeafShape, segL = 12, segW = 5): THREE.BufferGeometry {
  const bend = BEND[shape];
  // thick, soft, "inflated" leaves — never paper-thin slivers
  const thick = shape === "round" ? 0.24 : shape === "strap" || shape === "linear" || shape === "needle" ? 0.16 : 0.22;
  const cup = 0.22;
  const positions: number[] = [];
  const indices: number[] = [];
  const cols = segW * 2 + 1;

  for (let side = 0; side < 2; side++) {
    const sgn = side === 0 ? 1 : -1;
    for (let i = 0; i <= segL; i++) {
      const t = i / segL;
      const hw = widthProfile(shape, t);
      // centreline arcs downward towards the tip (gentle arch)
      const cz = t * (1 - 0.15 * bend * t);
      const cy = -bend * t * t * 0.55;
      for (let j = 0; j < cols; j++) {
        const u = j / segW - 1; // -1..1
        const x = u * hw;
        const cupY = cup * u * u * hw;
        const th = thick * hw * 2 * Math.sqrt(Math.max(0, 1 - u * u)) * 0.5;
        positions.push(x, cy + cupY + sgn * th, cz);
      }
    }
  }
  const sideVerts = (segL + 1) * cols;
  for (let side = 0; side < 2; side++) {
    const off = side * sideVerts;
    for (let i = 0; i < segL; i++) {
      for (let j = 0; j < cols - 1; j++) {
        const a = off + i * cols + j;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        if (side === 0) indices.push(a, c, b, b, c, d);
        else indices.push(a, b, c, b, d, c);
      }
    }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  // weld rim / tip vertices so normals round over the edge
  const welded = mergeVertices(g, 1e-5);
  g.dispose();
  g = welded;
  g.computeVertexNormals();
  // recompute colours on welded geometry from position
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const nor = g.getAttribute("normal") as THREE.BufferAttribute;
  const cArr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = clamp(pos.getZ(i), 0, 1);
    const hw = Math.max(1e-4, widthProfile(shape, clamp(t, 0, 1)));
    const u = clamp(Math.abs(pos.getX(i)) / hw, 0, 1);
    const gr = 0.76 + 0.32 * Math.pow(t, 0.8);
    const rib = 1 + 0.07 * Math.pow(1 - u, 10);
    const under = nor.getY(i) < 0 ? 0.9 : 1;
    const v = gr * rib * under;
    cArr[i * 3] = v;
    cArr[i * 3 + 1] = v;
    cArr[i * 3 + 2] = v;
  }
  g.setAttribute("color", new THREE.BufferAttribute(cArr, 3));
  return g;
}

/** Soft moss puff: a lumpy low-poly blob occupying z ∈ [0,1]. */
export function makeMossGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.5, 2);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 1 + 0.12 * Math.sin(x * 11 + y * 7) * Math.cos(z * 9);
    pos.setXYZ(i, x * k, y * k * 0.75, z * k + 0.5);
  }
  g.deleteAttribute("uv");
  const merged = mergeVertices(g);
  g.dispose();
  merged.computeVertexNormals();
  const p2 = merged.getAttribute("position") as THREE.BufferAttribute;
  const c = new Float32Array(p2.count * 3);
  for (let i = 0; i < p2.count; i++) {
    const v = 0.8 + 0.35 * clamp(p2.getY(i) + 0.4, 0, 1);
    c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = v;
  }
  merged.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return merged;
}

/** Tapered stem along +Z (0..1), diameter 1 at the base. */
export function makeStemGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.3, 0.5, 1, 6, 1, true);
  g.rotateX(Math.PI / 2); // Y → Z
  g.translate(0, 0, 0.5);
  const n = g.getAttribute("position").count;
  const c = new Float32Array(n * 3).fill(1);
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return g;
}

export function makeLayerGeometry(key: LeafShape | "stem"): THREE.BufferGeometry {
  if (key === "stem") return makeStemGeometry();
  if (key === "moss") return makeMossGeometry();
  return makeLeafGeometry(key);
}

/**
 * Smooth sculptural stone (contract 1.1.0 roles). A convex "softened
 * polytope": the radius along each direction is a soft-min over a few random
 * facet planes and a sphere, so the stone has clear sculptural planes with
 * rounded edges (no rough photoreal texture). Role controls taper, peak and
 * squash. Output spans y ∈ [0, size.y · heightFrac], centred in x/z, filling
 * the bounding box width/depth. Deterministic in (size, seed, role).
 */
export function makeStoneGeometry(
  size: [number, number, number],
  seed: number,
  role: StoneRole | undefined,
  segW = 72,
  segH = 48,
): THREE.BufferGeometry {
  const shape = roleShape(role);
  const s = seed >>> 0;
  const sphere = new THREE.SphereGeometry(1, segW, segH);
  sphere.deleteAttribute("uv");
  sphere.deleteAttribute("normal");
  const g = mergeVertices(sphere, 1e-6);
  sphere.dispose();
  const pos = g.getAttribute("position") as THREE.BufferAttribute;

  // facet planes: normals spread around the upper body, a few on the shoulders
  const planes: number[] = [];
  const nF = shape.facets;
  for (let k = 0; k < nF; k++) {
    // one crown plane, the rest mostly steep side planes (split-face look)
    const az = (k / nF) * Math.PI * 2 + srand(s, k, 11) * 0.45;
    const el = (k === 0 ? 62 + 20 * rand(s, k, 12) : k % 3 === 0 ? 30 + 25 * rand(s, k, 12) : 2 + 22 * rand(s, k, 12)) * (Math.PI / 180);
    const nx = Math.cos(el) * Math.cos(az);
    const ny = Math.sin(el);
    const nz = Math.cos(el) * Math.sin(az);
    planes.push(nx, ny, nz, 0.7 + 0.2 * rand(s, k, 13));
  }
  const crisp = shape.crisp;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    // soft-min of distances to the sphere (r = 1) and each facet plane
    let acc = Math.exp(-crisp * 1.0);
    for (let k = 0; k < nF; k++) {
      const o = k * 4;
      const dt = v.x * planes[o]! + v.y * planes[o + 1]! + v.z * planes[o + 2]!;
      if (dt > 0.04) acc += Math.exp((-crisp * planes[o + 3]!) / dt);
    }
    let r = -Math.log(acc) / crisp;
    // very gentle large-scale undulation so planes are not dead flat
    r *= 1 + 0.025 * Math.sin(v.x * 3.1 + v.y * 2.3 + rand(s, 0, 14) * 6.28) * Math.cos(v.z * 2.7 + rand(s, 0, 15) * 6.28);
    let x = v.x * r;
    let y = v.y * r;
    let z = v.z * r;
    // flatter buried base, domed / squashed crown
    if (y < 0) y *= 0.55;
    else y *= shape.dome;
    const yn = Math.min(1, Math.max(0, (y + 0.55) / (0.55 + shape.dome))); // 0 base … 1 top
    const tp = 1 - shape.taper * Math.pow(yn, 1.4);
    x *= tp;
    z *= tp;
    // asymmetric peak: shift the crown sideways a little
    x += shape.peak * yn * yn * (srand(s, 1, 16) >= 0 ? 1 : -1);
    pos.setXYZ(i, x, y, z);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const H = size[1] * shape.heightFrac;
  const sx = size[0] / (maxX - minX);
  const sy = H / (maxY - minY);
  const sz = size[2] / (maxZ - minZ);
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = (pos.getY(i) - minY) * sy;
    pos.setXYZ(i, (pos.getX(i) - cx) * sx, y, (pos.getZ(i) - cz) * sz);
    // soft vertical gradient: slightly darker near the bed, lighter crown,
    // plus faint horizontal strata for a sculpted read
    const t = y / H;
    const strata = 0.025 * Math.sin(t * 19 + rand(s, 2, 17) * 6.28);
    const c = 0.8 + 0.24 * Math.pow(t, 0.7) + strata;
    col[i * 3] = c;
    col[i * 3 + 1] = c;
    col[i * 3 + 2] = c * 1.01;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

/** Smooth stylized branch: a few tubes along gentle random curves. */
export function makeBranchGeometry(size: [number, number, number], seed: number): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const [w, h, d] = size;
  const branches = 3;
  for (let b = 0; b < branches; b++) {
    const pts: THREE.Vector3[] = [];
    const start = new THREE.Vector3(srand(seed, b, 1) * w * 0.15, 0, srand(seed, b, 2) * d * 0.2);
    const dirX = (b === 0 ? 0.6 : b === 1 ? -0.5 : 0.2) + srand(seed, b, 3) * 0.3;
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      pts.push(
        new THREE.Vector3(
          start.x + dirX * w * 0.5 * t + srand(seed, b * 10 + i, 4) * w * 0.04,
          start.y + h * (b === 0 ? 0.6 : 0.95) * Math.pow(t, 0.8) * (b === 0 ? 0.7 : 1),
          start.z + srand(seed, b * 10 + i, 5) * d * 0.15,
        ),
      );
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const radius = Math.min(w, h) * (b === 0 ? 0.07 : 0.045);
    const tube = new THREE.TubeGeometry(curve, 40, radius, 10, false);
    parts.push(tube);
    const cap = new THREE.SphereGeometry(radius, 10, 8);
    const end = pts[pts.length - 1]!;
    cap.translate(end.x, end.y, end.z);
    parts.push(cap);
  }
  return parts;
}

/**
 * Substrate bed: sloped heightfield (higher at back) whose front edge rolls
 * over a rounded fillet down to the glass floor at y = −floorDepth.
 */
export function makeSubstrateGeometry(p: SubstrateProfile, floorDepth: number, inset = 0.4): THREE.BufferGeometry {
  const nx = 96;
  const nzTop = 36;
  const filletSteps = 10;
  const frontSteps = 6;
  // small, crisp rounded lip — a fine front sand edge rather than a fat roll
  const fr = Math.min(0.55, floorDepth * 0.3);
  const w = p.widthCm - inset * 2;
  const zFront = p.depthCm / 2 - inset;
  const zBack = -p.depthCm / 2 + inset;
  // profile rows: z, fixed y (front face) or drop below the bed surface, and a shade
  const prof: { z: number; u: number | null; drop: number; face: number }[] = [];
  for (let s = 0; s < frontSteps; s++) {
    // vertical front face from the glass floor up to the start of the lip
    prof.push({ z: zFront, u: s / frontSteps, drop: 0, face: 1 });
  }
  for (let s = 0; s <= filletSteps; s++) {
    const a = (s / filletSteps) * (Math.PI / 2);
    prof.push({ z: zFront - fr + Math.cos(a) * fr, u: null, drop: fr - Math.sin(a) * fr, face: 1 - s / filletSteps });
  }
  for (let s = 1; s <= nzTop; s++) {
    const t = s / nzTop;
    const z = zFront - fr + (zBack - (zFront - fr)) * t;
    prof.push({ z, u: null, drop: 0, face: 0 });
  }
  const cols = nx + 1;
  const positions: number[] = [];
  const colors: number[] = [];
  for (const pr of prof) {
    for (let i = 0; i <= nx; i++) {
      const x = -w / 2 + (w * i) / nx;
      const top = substrateHeight(p, x, zFront - fr);
      const y = pr.u !== null
        ? -floorDepth + (top - fr + floorDepth) * pr.u
        : substrateHeight(p, x, pr.z) - pr.drop;
      positions.push(x, y, pr.z);
      // front face: fine soil strata, darker towards the glass floor;
      // top: soft lighter sand with a slight tonal drift
      let c: number;
      if (pr.face > 0) {
        const depth = Math.max(0, top - y);
        const band = 0.035 * Math.sin(depth * 5.3 + x * 0.05) + 0.02 * Math.sin(depth * 13.1);
        c = 0.9 - 0.16 * Math.min(1, depth / Math.max(1, floorDepth)) + band;
      } else {
        c = 1.0 + 0.04 * Math.sin(x * 0.21 + pr.z * 0.33) * Math.cos(x * 0.07 - pr.z * 0.19);
      }
      colors.push(c, c * 0.995, c * 0.985);
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < prof.length - 1; r++) {
    for (let i = 0; i < nx; i++) {
      const a = r * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
