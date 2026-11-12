/**
 * Procedural geometry for FrontalTank: thick rounded leaves, moss puffs,
 * stems, sculptural pebbles, stylized branches, sloped substrate bed.
 * All built once and shared; per-frame updates only touch instance buffers.
 */
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { LeafShape } from "../contract.js";
import { rand, srand } from "./rng.js";
import { substrateHeight, type SubstrateProfile } from "./layout.js";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Half-width profile (0..0.5) along normalised length t ∈ [0,1]. */
function widthProfile(shape: LeafShape, t: number): number {
  const base = clamp(t * 14, 0, 1); // tiny petiole pinch
  switch (shape) {
    case "lanceolate":
      return 0.5 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.72)), 0.9) * base;
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
  const thick = shape === "round" ? 0.16 : 0.12;
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

/** Smooth sculptural pebble, base sunk slightly below y = 0. */
export function makePebbleGeometry(size: [number, number, number], seed: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 56, 36);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const f: number[] = [];
  for (let k = 0; k < 4; k++) {
    f.push(
      srand(seed, k, 1) * 1.6, srand(seed, k, 2) * 1.6, srand(seed, k, 3) * 1.6,
      rand(seed, k, 4) * 6.28, 0.06 + 0.07 * rand(seed, k, 5),
    );
  }
  const lean = srand(seed, 9, 6) * 0.35;
  const leanZ = srand(seed, 9, 7) * 0.2;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let r = 1;
    for (let k = 0; k < 4; k++) {
      const o = k * 5;
      r += f[o + 4]! * Math.sin(x * f[o]! + y * f[o + 1]! + z * f[o + 2]! + f[o + 3]!);
    }
    x *= r; y *= r; z *= r;
    // flatter underside, softly domed top, slight asymmetric lean
    if (y < 0) y *= 0.45;
    else y *= 1 - 0.18 * Math.max(0, x * Math.sign(lean || 1)); // asymmetric shoulder
    x += lean * Math.max(0, y);
    z += leanZ * Math.max(0, y);
    pos.setXYZ(i, (x * size[0]) / 2, ((y + 0.32) * size[1]) / 1.32, (z * size[2]) / 2);
  }
  g.computeVertexNormals();
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
  const nx = 64;
  const nzTop = 28;
  const filletSteps = 8;
  const fr = Math.min(1.6, floorDepth * 0.6); // fillet radius
  const w = p.widthCm - inset * 2;
  const zFront = p.depthCm / 2 - inset;
  const zBack = -p.depthCm / 2 + inset;
  // profile: list of (z, yBase, topWeight)
  const prof: { z: number; y: number | null; drop: number }[] = [];
  prof.push({ z: zFront, y: -floorDepth, drop: 0 });
  for (let s = 0; s <= filletSteps; s++) {
    const a = (s / filletSteps) * (Math.PI / 2);
    // from vertical (front face) to horizontal (top)
    prof.push({ z: zFront - fr + Math.cos(a) * fr, y: null, drop: fr - Math.sin(a) * fr });
  }
  for (let s = 1; s <= nzTop; s++) {
    const z = zFront - fr + ((zBack - (zFront - fr)) * s) / nzTop;
    prof.push({ z, y: null, drop: 0 });
  }
  const cols = nx + 1;
  const positions: number[] = [];
  for (const pr of prof) {
    for (let i = 0; i <= nx; i++) {
      const x = -w / 2 + (w * i) / nx;
      const y = pr.y ?? substrateHeight(p, x, pr.z) - pr.drop;
      positions.push(x, y, pr.z);
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
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
