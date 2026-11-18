/**
 * Contract 1.4.0 tests: hardscapeSurfaceY vs the rendered mesh (ray-cast),
 * hardscapeAnchors, root lean side / angle, twig radius, cache key, attached
 * epiphyte / moss layout (never inside the hardscape).
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { HardscapeVisual, PlantVisual, StoneRole, WoodStyle } from "../contract.js";
import { RENDER_CONTRACT_VERSION } from "../contract.js";
import * as pkg from "../index.js";
import * as frontal from "./index.js";
import { HardscapeGeometryCache, buildHardscapeGeometry, hardscapeGeometryKey } from "./hardscapeCache.js";
import { InstanceBuffer, LAYER_KEYS, LayoutCache, layoutPlant, type LayerKey, type LayoutOptions } from "./layout.js";
import { speciesLook } from "./speciesLook.js";
import { stonePlacement } from "./stones.js";
import { hardscapeAnchors, hardscapeSurfaceY, makeSurfaceField, pieceSurface, type SurfaceField } from "./surface.js";
import { tankGeom } from "./tank.js";
import { MIN_TUBE_RADIUS, WOOD_STYLES, leanSideOf, makeWoodGeometry, rootLean } from "./wood.js";
import { rand } from "./rng.js";

const TANK = { widthCm: 90, depthCm: 45, heightCm: 45 };
const g = tankGeom(TANK, { frontCm: 3, backCm: 3 });
const ROLES: StoneRole[] = ["oyaishi", "fukuishi", "soeishi", "suteishi"];

function wood(style: WoodStyle, over: Partial<HardscapeVisual> = {}): HardscapeVisual {
  return { id: `w-${style}`, kind: "wood", woodStyle: style, x: -12, z: -3, rotationY: 0.3, sizeCm: style === "log" ? [26, 11, 12] : [34, 30, 16], seed: 14, ...over };
}
function stone(role: StoneRole, over: Partial<HardscapeVisual> = {}): HardscapeVisual {
  return { id: `s-${role}`, kind: "stone", role, x: 9, z: 2, rotationY: -0.6, sizeCm: [13, 12, 10], seed: 202, ...over };
}

/** The piece exactly as FrontalTank's HardscapeItem builds it (outer: bed + lean, inner: rotationY). */
function renderedPiece(h: HardscapeVisual, quality: "high" | "low" = "high") {
  const place = stonePlacement(h, g.profile);
  const outer = new THREE.Group();
  outer.position.set(h.x, place.bottomY, h.z);
  outer.rotation.set(place.leanX, 0, place.leanZ);
  const inner = new THREE.Group();
  inner.rotation.set(0, h.rotationY, 0);
  const geo = buildHardscapeGeometry(h, quality);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  inner.add(mesh);
  outer.add(inner);
  outer.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  return { mesh, place, box, geo };
}

const ray = new THREE.Raycaster();
/** Highest mesh surface over column (x, z) by a downward ray, world y. */
function castDown(mesh: THREE.Mesh, x: number, z: number): number | null {
  ray.set(new THREE.Vector3(x, 500, z), new THREE.Vector3(0, -1, 0));
  const hits = ray.intersectObject(mesh, false);
  return hits.length ? hits[0]!.point.y : null;
}

/** Inside test by upward ray parity per closed limb (wood) / whole mesh (stone). */
function insideMesh(mesh: THREE.Mesh, p: THREE.Vector3): boolean {
  ray.set(p, new THREE.Vector3(0, 1, 0));
  const hits = ray.intersectObject(mesh, false);
  const starts = (mesh.geometry.userData?.limbTri as number[] | undefined) ?? [0];
  const par = new Map<number, number>();
  for (const hh of hits) {
    let l = 0;
    while (l + 1 < starts.length && hh.faceIndex! >= starts[l + 1]!) l++;
    par.set(l, (par.get(l) ?? 0) ^ 1);
  }
  for (const v of par.values()) if (v) return true;
  return false;
}

/** Sample columns: half uniform over the box, half right next to random vertices (twigs count). */
function columns(mesh: THREE.Mesh, box: THREE.Box3, n: number, seed: number): [number, number][] {
  const out: [number, number][] = [];
  const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) {
      out.push([box.min.x + (box.max.x - box.min.x) * rand(seed, i, 1), box.min.z + (box.max.z - box.min.z) * rand(seed, i, 2)]);
    } else {
      v.fromBufferAttribute(pos, Math.floor(rand(seed, i, 3) * pos.count)).applyMatrix4(mesh.matrixWorld);
      out.push([v.x + (rand(seed, i, 4) - 0.5) * 0.3, v.z + (rand(seed, i, 5) - 0.5) * 0.3]);
    }
  }
  return out;
}

describe("contract version", () => {
  it("is 1.4.x (1.4.1 is a behaviour-fix release of 1.4.0)", () => {
    expect(["1.4.0", "1.4.1"]).toContain(RENDER_CONTRACT_VERSION);
  });
  it("exports hardscapeSurfaceY / hardscapeAnchors from the package and frontal index", () => {
    expect(pkg.hardscapeSurfaceY).toBe(hardscapeSurfaceY);
    expect(pkg.hardscapeAnchors).toBe(hardscapeAnchors);
    expect(frontal.hardscapeSurfaceY).toBe(hardscapeSurfaceY);
    expect(frontal.hardscapeAnchors).toBe(hardscapeAnchors);
  });
});

describe("hardscapeSurfaceY (1.4.0) matches the rendered mesh within 0.5 cm", () => {
  const cases: HardscapeVisual[] = [
    ...WOOD_STYLES.map((s) => wood(s)),
    wood("root", { id: "root-r", x: 15, seed: 3, leanSide: "auto" }),
    ...ROLES.map((r) => stone(r)),
    stone("oyaishi", { id: "oya-left", x: -14, sizeCm: [13, 23, 10], seed: 101, buriedFrac: 0.2 }),
  ];
  for (const h of cases) {
    it(`${h.id}: ≥ 50 hit columns agree, misses agree (quality high)`, () => {
      const { mesh, place, box } = renderedPiece(h);
      // the surface frame is the bed at the piece (flat bed ⇒ = local bed surface)
      expect(Math.abs(place.bedRef - g.profile.front)).toBeLessThan(1.2);
      let hits = 0, worst = 0;
      for (const [x, z] of columns(mesh, box, 400, h.seed + 7)) {
        const ref = castDown(mesh, x, z);
        const y = hardscapeSurfaceY(h, x, z);
        if (ref === null) {
          // grazing columns at a silhouette edge may differ; anything else must be null
          if (y !== null) expect(castDown(mesh, x + 0.02, z) ?? castDown(mesh, x - 0.02, z) ?? castDown(mesh, x, z + 0.02)).not.toBeNull();
          continue;
        }
        // 1.4.1: a column that only meets buried geometry (at / below the bed) is null
        if (ref - place.bedRef <= 0) {
          expect(y).toBeNull();
          continue;
        }
        if (y === null) {
          // grazing: the rendered top is within float noise of the bed plane
          expect(ref - place.bedRef).toBeLessThan(1e-3);
          continue;
        }
        const d = Math.abs(ref - place.bedRef - y);
        worst = Math.max(worst, d);
        hits++;
      }
      expect(hits).toBeGreaterThanOrEqual(50);
      expect(worst).toBeLessThan(0.5);
      mesh.geometry.dispose();
    });
  }

  it("is pure / deterministic and returns null off the piece", () => {
    const h = wood("branchy");
    const a = hardscapeSurfaceY(h, -12, -3);
    expect(hardscapeSurfaceY({ ...h }, -12, -3)).toBe(a);
    expect(hardscapeSurfaceY(h, 200, 0)).toBeNull();
    expect(hardscapeSurfaceY(h, Number.NaN, 0)).toBeNull();
    // id is not a shape input
    expect(hardscapeSurfaceY({ ...h, id: "other" }, -12, -3)).toBe(a);
  });

  it("low quality matches the low mesh as well", () => {
    const h = wood("root");
    const { mesh, place, box } = renderedPiece(h, "low");
    let hits = 0;
    for (const [x, z] of columns(mesh, box, 200, 5)) {
      const ref = castDown(mesh, x, z);
      if (ref === null || ref - place.bedRef <= 1e-3) continue;
      const y = hardscapeSurfaceY(h, x, z, { quality: "low" });
      expect(Math.abs(ref - place.bedRef - (y ?? -999))).toBeLessThan(0.5);
      hits++;
    }
    expect(hits).toBeGreaterThan(50);
  });
});

describe("hardscapeAnchors (1.4.0)", () => {
  const pieces = [...WOOD_STYLES.map((s) => wood(s)), ...ROLES.map((r) => stone(r))];

  it("returns [] for n ≤ 0", () => {
    expect(hardscapeAnchors(wood("root"), 0)).toEqual([]);
    expect(hardscapeAnchors(wood("root"), -3)).toEqual([]);
  });

  for (const h of pieces) {
    it(`${h.id}: deterministic, n respected, unit normals ny ≥ 0.35, y = surfaceY, sorted front→back then left→right`, () => {
      const a = hardscapeAnchors(h, 6);
      expect(hardscapeAnchors({ ...h }, 6)).toEqual(a);
      expect(a).toHaveLength(6);
      for (const p of a) {
        expect(Math.hypot(p.nx, p.ny, p.nz)).toBeCloseTo(1, 6);
        expect(p.ny).toBeGreaterThanOrEqual(0.35);
        expect(p.y).toBeGreaterThan(0);
        expect(Math.abs(p.y - hardscapeSurfaceY(h, p.x, p.z)!)).toBeLessThan(0.5);
      }
      for (let i = 1; i < a.length; i++) {
        const prev = a[i - 1]!, cur = a[i]!;
        expect(prev.z > cur.z || (Math.abs(prev.z - cur.z) <= 1e-6 && prev.x <= cur.x)).toBe(true);
      }
      // spread out: no two anchors closer than the minimum spacing
      for (let i = 0; i < a.length; i++)
        for (let j = i + 1; j < a.length; j++)
          expect(Math.hypot(a[i]!.x - a[j]!.x, a[i]!.y - a[j]!.y, a[i]!.z - a[j]!.z)).toBeGreaterThanOrEqual(0.75);
    });
  }

  it("prefixes are stable (anchors(n) ⊂ anchors(n+k)) and tiny pieces may return fewer", () => {
    const h = wood("root");
    const a3 = hardscapeAnchors(h, 3);
    const a8 = hardscapeAnchors(h, 8);
    for (const p of a3) expect(a8).toContainEqual(p);
    const tiny = stone("suteishi", { sizeCm: [1.2, 0.8, 1], buriedFrac: 0.3 });
    const t = hardscapeAnchors(tiny, 40);
    expect(t.length).toBeLessThan(40);
  });

  it("wood prefers the upper half; stones the upper shoulders (not the bed line)", () => {
    for (const h of pieces) {
      const a = hardscapeAnchors(h, 3);
      const S = pieceSurface(h);
      const meanY = a.reduce((s, p) => s + p.y, 0) / a.length;
      expect(meanY).toBeGreaterThan(S.maxY * 0.4);
    }
  });
});

describe("root wood leanSide (1.4.0)", () => {
  it("auto leans towards the tank centre; explicit sides win", () => {
    expect(leanSideOf({ x: -10 })).toBe(1);
    expect(leanSideOf({ x: 0 })).toBe(-1);
    expect(leanSideOf({ x: 12 })).toBe(-1);
    expect(leanSideOf({ x: 12, leanSide: "right" })).toBe(1);
    expect(leanSideOf({ x: -12, leanSide: "left" })).toBe(-1);
    // the built geometry leans that way
    const left = buildHardscapeGeometry(wood("root", { x: 20 }), "high").userData.trunk as number[];
    const right = buildHardscapeGeometry(wood("root", { x: -20 }), "high").userData.trunk as number[];
    expect(Math.sign(left[3]! - left[0]!)).toBe(-1);
    expect(Math.sign(right[3]! - right[0]!)).toBe(1);
  });

  it("lean stays 30–45° for box aspect (w/h) 0.3 … 2, both sides, many seeds", () => {
    const report: string[] = [];
    for (const aspect of [0.3, 0.45, 0.6, 0.8, 1, 1.3, 1.6, 2]) {
      let lo = 90, hi = 0;
      for (let seed = 0; seed < 12; seed++) {
        for (const side of [-1, 1] as const) {
          const h = 30;
          const l = rootLean([h * aspect, h, 16], seed, side);
          const deg = (l.angle * 180) / Math.PI;
          lo = Math.min(lo, deg);
          hi = Math.max(hi, deg);
          expect(l.side).toBe(side);
        }
      }
      report.push(`${aspect}: ${lo.toFixed(1)}–${hi.toFixed(1)}°`);
      expect(lo).toBeGreaterThanOrEqual(30);
      expect(hi).toBeLessThanOrEqual(45);
    }
    console.log(`[root lean by aspect] ${report.join(", ")}`);
  });
});

describe("twig radius + cache key (1.4.0)", () => {
  it("tubes never taper below 0.35 cm (high) / 0.45 cm (low)", () => {
    for (const style of WOOD_STYLES) {
      for (const size of [[34, 30, 16], [8, 6, 5], [60, 40, 25], [12, 40, 10]] as [number, number, number][]) {
        for (const seed of [1, 7, 14]) {
          for (const q of ["high", "low"] as const) {
            const geo = makeWoodGeometry(size, seed, style, q, 1);
            expect(geo.userData.minTubeRadius).toBeGreaterThanOrEqual(MIN_TUBE_RADIUS[q] - 1e-6);
            geo.dispose();
          }
        }
      }
    }
  });

  it("key includes quality and the resolved lean side (root only)", () => {
    const h = wood("root", { x: -10 });
    const k = hardscapeGeometryKey(h, "high");
    expect(hardscapeGeometryKey(h, "low")).not.toBe(k);
    expect(hardscapeGeometryKey({ ...h, leanSide: "left" }, "high")).not.toBe(k);
    expect(hardscapeGeometryKey({ ...h, leanSide: "right" }, "high")).toBe(k); // same resolved side
    expect(hardscapeGeometryKey({ ...h, x: -3 }, "high")).toBe(k); // still left of centre
    expect(hardscapeGeometryKey({ ...h, x: 4 }, "high")).not.toBe(k); // crossed the centre ⇒ flips
    // other styles ignore leanSide
    const b = wood("branchy");
    expect(hardscapeGeometryKey({ ...b, leanSide: "left" }, "high")).toBe(hardscapeGeometryKey({ ...b, leanSide: "right" }, "high"));
    const cache = new HardscapeGeometryCache();
    const g1 = cache.get(h, "high");
    expect(cache.get({ ...h, leanSide: "left" }, "high")).not.toBe(g1);
    cache.dispose();
  });
});

// ---------------------------------------------------------------------------
// Attached epiphytes / moss

const SPECIES = {
  moss: speciesLook({ id: "taxiphyllum-christmas", growthForm: "moss", colorHex: "#4f8a3c" }),
  anubias: speciesLook({ id: "anubias-nana-petite", growthForm: "epiphyte", colorHex: "#2d5a32", visual: { leafLengthCm: 2.2, leafWidthCm: 1.4 } }),
  buce: speciesLook({ id: "bucephalandra", growthForm: "epiphyte", colorHex: "#4a5c3a", visual: { leafShape: "lanceolate", leafLengthCm: 2.6, leafWidthCm: 0.9 } }),
  fern: speciesLook({ id: "microsorum-pteropus", growthForm: "epiphyte", colorHex: "#3f7a3a", visual: { leafShape: "lanceolate", leafLengthCm: 9, leafWidthCm: 2.2 } }),
};

function sceneField(hs: HardscapeVisual[]): { field: SurfaceField; bedRef: Map<string, number> } {
  const bedRef = new Map<string, number>();
  const field = makeSurfaceField(
    hs.map((h) => {
      const pl = stonePlacement(h, g.profile);
      bedRef.set(h.id, pl.bedRef);
      return { surf: pieceSurface(h, "high"), bedRef: pl.bedRef };
    }),
  );
  return { field, bedRef };
}

function attachedOpts(field: SurfaceField, bedRef: number): LayoutOptions {
  return { quality: "high", baseY: bedRef, waterY: g.waterY, bounds: { halfW: 44, halfD: 21 }, surface: field, surfaceKey: "t" };
}

/** Instance origins (leaf base points) of the given layers. */
function bases(buf: InstanceBuffer, keys: readonly LayerKey[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const k of keys) {
    const L = buf.layers[k];
    for (let i = 0; i < L.count; i++) out.push(new THREE.Vector3(L.matrices[i * 16 + 12], L.matrices[i * 16 + 13], L.matrices[i * 16 + 14]));
  }
  return out;
}

describe("attached epiphytes and moss (1.4.0)", () => {
  const hs = [wood("root"), wood("log", { id: "log", x: 20, z: 4, rotationY: -0.2 }), stone("fukuishi", { x: -30, z: 6 })];
  const { field, bedRef } = sceneField(hs);
  const meshes = hs.map((h) => renderedPiece(h).mesh);

  const cases: { name: string; look: keyof typeof SPECIES; piece: number; anchor: number; H: number; S: number }[] = [
    { name: "moss on a root-wood branch", look: "moss", piece: 0, anchor: 0, H: 3, S: 9 },
    { name: "moss on the log", look: "moss", piece: 1, anchor: 1, H: 3, S: 8 },
    { name: "Anubias on the root fork", look: "anubias", piece: 0, anchor: 2, H: 5, S: 8 },
    { name: "Anubias on the log", look: "anubias", piece: 1, anchor: 0, H: 5, S: 8 },
    { name: "Bucephalandra on a stone shoulder", look: "buce", piece: 2, anchor: 0, H: 6, S: 7 },
    { name: "Java fern on the root wood", look: "fern", piece: 0, anchor: 3, H: 15, S: 10 },
  ];
  for (const c of cases) {
    it(`${c.name}: no leaf / rhizome base point inside the hardscape mesh; sits on the surface`, () => {
      const h = hs[c.piece]!;
      const an = hardscapeAnchors(h, 4)[c.anchor]!;
      const plant: PlantVisual = { id: `p-${c.name}`, speciesId: c.look, x: an.x, z: an.z, y: an.y, heightCm: c.H, spreadCm: c.S, health: 1 };
      const buf = new InstanceBuffer();
      const n = layoutPlant(buf, SPECIES[c.look], plant, attachedOpts(field, bedRef.get(h.id)!));
      expect(n).toBeGreaterThan(c.look === "moss" ? 300 : 8);
      const pts = bases(buf, LAYER_KEYS);
      let inside = 0;
      for (let i = 0; i < pts.length; i += Math.max(1, Math.floor(pts.length / 400))) {
        for (const m of meshes) if (insideMesh(m, pts[i]!)) inside++;
      }
      expect(inside).toBe(0);
      // the base sits on the surface: lowest instance is near the anchor height (not on the bed)
      const ys = pts.map((p) => p.y).sort((a, b) => a - b);
      const anchorWorld = bedRef.get(h.id)! + an.y;
      expect(ys[Math.floor(ys.length * 0.1)]!).toBeGreaterThan(anchorWorld - c.S * 0.5 - 0.5);
    });
  }

  it("moss cushion follows the surface within spread/2 and is a dense rounded mound", () => {
    const h = hs[1]!;
    const an = hardscapeAnchors(h, 3)[1]!;
    const plant: PlantVisual = { id: "moss-log", speciesId: "moss", x: an.x, z: an.z, y: an.y, heightCm: 3, spreadCm: 9, health: 1 };
    const buf = new InstanceBuffer();
    layoutPlant(buf, SPECIES.moss, plant, attachedOpts(field, bedRef.get(h.id)!));
    const pts = bases(buf, ["moss"]);
    expect(pts.length).toBeGreaterThan(800);
    for (const p of pts) {
      expect(Math.hypot(p.x - an.x, p.z - an.z)).toBeLessThanOrEqual(4.5 + 0.6);
      const top = field.top(p.x, p.z);
      // on the wood: above its top; off the edge: draped at most spread/2 below the base
      if (top !== null && top > bedRef.get(h.id)! + an.y - 4.5) expect(p.y).toBeGreaterThanOrEqual(top - 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(bedRef.get(h.id)! + an.y - 4.5 - 0.6);
    }
  });

  it("attached Anubias leaves fan forward (+z) and up ≈ 35°", () => {
    const h = hs[1]!;
    const an = hardscapeAnchors(h, 3)[0]!;
    const plant: PlantVisual = { id: "anu", speciesId: "anubias", x: an.x, z: an.z, y: an.y, heightCm: 5, spreadCm: 8, health: 1 };
    const buf = new InstanceBuffer();
    layoutPlant(buf, SPECIES.anubias, plant, attachedOpts(field, bedRef.get(h.id)!));
    const L = buf.layers[SPECIES.anubias.leafShape];
    let fwd = 0, elevSum = 0;
    for (let i = 0; i < L.count; i++) {
      const o = i * 16;
      const dx = L.matrices[o + 8]!, dy = L.matrices[o + 9]!, dz = L.matrices[o + 10]!;
      const l = Math.hypot(dx, dy, dz);
      if (dz > 0) fwd++;
      elevSum += Math.asin(dy / l);
    }
    expect(L.count).toBeGreaterThan(8);
    expect(fwd / L.count).toBeGreaterThan(0.75);
    const meanElev = (elevSum / L.count) * (180 / Math.PI);
    expect(meanElev).toBeGreaterThan(25);
    expect(meanElev).toBeLessThan(55);
  });

  it("y = 0 epiphytes keep the planted (1.3.0) look; the surface is ignored", () => {
    const plant: PlantVisual = { id: "anu0", speciesId: "anubias", x: 30, z: 10, y: 0, heightCm: 5, spreadCm: 8, health: 1 };
    const a = new InstanceBuffer();
    const b = new InstanceBuffer();
    layoutPlant(a, SPECIES.anubias, plant, { quality: "high", baseY: 3, waterY: g.waterY });
    layoutPlant(b, SPECIES.anubias, plant, { quality: "high", baseY: 3, waterY: g.waterY, surface: field, surfaceKey: "x" });
    for (const k of LAYER_KEYS) expect(Array.from(b.layers[k].matrices.subarray(0, b.layers[k].count * 16))).toEqual(Array.from(a.layers[k].matrices.subarray(0, a.layers[k].count * 16)));
  });

  it("layout cache re-lays out attached plants when the surface key changes", () => {
    const cache = new LayoutCache();
    const plant: PlantVisual = { id: "m", speciesId: "moss", x: 0, z: 0, y: 4, heightCm: 3, spreadCm: 6, health: 1 };
    const o = attachedOpts(field, 3);
    cache.layout(new InstanceBuffer(), SPECIES.moss, plant, o);
    cache.layout(new InstanceBuffer(), SPECIES.moss, plant, o);
    expect(cache.hits).toBe(1);
    cache.layout(new InstanceBuffer(), SPECIES.moss, plant, { ...o, surfaceKey: "moved" });
    expect(cache.misses).toBe(2);
  });
});
