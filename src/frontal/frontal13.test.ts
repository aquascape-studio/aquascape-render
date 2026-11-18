/**
 * Contract 1.3.0 tests: driftwood styles, per-piece geometry cache + rebuild
 * benchmark, clampHardscapeXZ, and the (now normative) 1.2.1 edit rules.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { HardscapeVisual, PlantVisual, SpeciesLook, WoodStyle } from "../contract.js";
import { RENDER_CONTRACT_VERSION } from "../contract.js";
import * as pkg from "../index.js";
import { dragClamp, haloSpec, makeHaloGeometry, makeHaloMaterial, type EditPropsSnapshot } from "./edit.js";
import {
  DRAG_SLOP_PX,
  DragSession,
  GLASS_INSET_CM,
  clampHardscapeXZ,
  clampToGlass,
  dragScale,
  visibleGlass,
} from "./editMath.js";
import { FieldSync } from "./fieldSync.js";
import { hardscapeExtent } from "./surface.js";
import { HardscapeGeometryCache, buildHardscapeGeometry, clearShapeStore, hardscapeGeometryKey } from "./hardscapeCache.js";
import { substrateHeight, type LayoutOptions } from "./layout.js";
import { speciesLook } from "./speciesLook.js";
import { DEFAULT_BURIED_FRAC_WOOD, buriedFrac, stonePlacement } from "./stones.js";
import { tankGeom } from "./tank.js";
import { WOOD_BASE_HEX, WOOD_STYLES, WOOD_TIP_HEX, makeWoodGeometry, rootLean, woodLimbKinds, woodStyleOf } from "./wood.js";

const TANK = { widthCm: 90, depthCm: 45, heightCm: 45 };
const g = tankGeom(TANK);

function wood(over: Partial<HardscapeVisual> = {}): HardscapeVisual {
  return { id: "w", kind: "wood", x: 0, z: 0, rotationY: 0, sizeCm: [26, 28, 15], seed: 12, ...over };
}

function lum(c: THREE.BufferAttribute, i: number): number {
  return c.getX(i) * 0.2126 + c.getY(i) * 0.7152 + c.getZ(i) * 0.0722;
}

describe("contract version", () => {
  it("is 1.3.0 or a later compatible version", () => {
    expect(["1.3.0", "1.4.0", "1.4.1"]).toContain(RENDER_CONTRACT_VERSION);
  });
});

describe("driftwood styles (1.3.0)", () => {
  const sizes: [number, number, number][] = [
    [26, 28, 15],
    [40, 34, 20],
    [24, 10, 12],
    [8, 6, 5],
  ];

  it("defaults to branchy", () => {
    expect(woodStyleOf(undefined)).toBe("branchy");
    expect(woodStyleOf("root")).toBe("root");
    expect(woodStyleOf("nope" as WoodStyle)).toBe("branchy");
  });

  it("every style fits its bounding box exactly (x, z centred; y from 0)", () => {
    for (const style of WOOD_STYLES) {
      for (const size of sizes) {
        for (const seed of [1, 12, 99]) {
          const geo = makeWoodGeometry(size, seed, style);
          const bb = geo.boundingBox!;
          expect(bb.min.x).toBeCloseTo(-size[0] / 2, 3);
          expect(bb.max.x).toBeCloseTo(size[0] / 2, 3);
          expect(bb.min.y).toBeCloseTo(0, 3);
          expect(bb.max.y).toBeCloseTo(size[1], 3);
          expect(bb.min.z).toBeCloseTo(-size[2] / 2, 3);
          expect(bb.max.z).toBeCloseTo(size[2] / 2, 3);
          geo.dispose();
        }
      }
    }
  });

  it("is deterministic in seed and differs between seeds and styles", () => {
    const a = makeWoodGeometry([26, 28, 15], 7, "root").getAttribute("position").array;
    const b = makeWoodGeometry([26, 28, 15], 7, "root").getAttribute("position").array;
    const c = makeWoodGeometry([26, 28, 15], 8, "root").getAttribute("position").array;
    const d = makeWoodGeometry([26, 28, 15], 7, "branchy").getAttribute("position").array;
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
    expect(Array.from(a)).not.toEqual(Array.from(d));
  });

  it("is a closed, smooth, outward-facing surface (unit analytic normals, consistent winding)", () => {
    for (const style of WOOD_STYLES) {
      const geo = makeWoodGeometry([26, 28, 15], 3, style);
      const p = geo.getAttribute("position") as THREE.BufferAttribute;
      const n = geo.getAttribute("normal") as THREE.BufferAttribute;
      const ix = geo.index!;
      for (let i = 0; i < n.count; i++) {
        expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 4);
      }
      const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3();
      let agree = 0;
      for (let i = 0; i < ix.count; i += 3) {
        A.fromBufferAttribute(p, ix.getX(i));
        B.fromBufferAttribute(p, ix.getX(i + 1));
        C.fromBufferAttribute(p, ix.getX(i + 2));
        N.fromBufferAttribute(n, ix.getX(i)).add(new THREE.Vector3().fromBufferAttribute(n, ix.getX(i + 1)));
        if (B.sub(A).cross(C.sub(A)).dot(N) >= 0) agree++;
      }
      expect(agree / (ix.count / 3)).toBeGreaterThan(0.995);
      // no uv / bark texture inputs: geometry carries position, normal, colour only
      expect(Object.keys(geo.attributes).sort()).toEqual(["color", "normal", "position"]);
    }
  });

  it("warm brown vertex colours, lighter towards the tips (#7A5A43 → #A88466)", () => {
    const c0 = new THREE.Color(WOOD_BASE_HEX);
    const c1 = new THREE.Color(WOOD_TIP_HEX);
    for (const style of WOOD_STYLES) {
      const geo = makeWoodGeometry([26, 28, 15], 5, style);
      const col = geo.getAttribute("color") as THREE.BufferAttribute;
      const pos = geo.getAttribute("position") as THREE.BufferAttribute;
      let lo = 0, nlo = 0, hi = 0, nhi = 0;
      for (let i = 0; i < col.count; i++) {
        // warm: r > g > b
        expect(col.getX(i)).toBeGreaterThan(col.getY(i));
        expect(col.getY(i)).toBeGreaterThan(col.getZ(i));
        expect(col.getX(i)).toBeLessThanOrEqual(c1.r * 1.06);
        expect(col.getX(i)).toBeGreaterThanOrEqual(c0.r * 0.8);
        const y = pos.getY(i);
        if (y < 28 * 0.2) { lo += lum(col, i); nlo++; }
        if (y > 28 * 0.8) { hi += lum(col, i); nhi++; }
      }
      expect(hi / nhi).toBeGreaterThan(lo / nlo);
    }
  });

  it("branchy: 4–7 main branches fanning up and out, plus twigs; mass towards the top", () => {
    for (let seed = 0; seed < 40; seed++) {
      const kinds = woodLimbKinds([26, 28, 15], seed, "branchy");
      const n = kinds.filter((k) => k === "branch").length;
      expect(n).toBeGreaterThanOrEqual(4);
      expect(n).toBeLessThanOrEqual(7);
    }
    expect(woodLimbKinds([26, 28, 15], 3, "branchy")).toContain("twig");
    const geo = makeWoodGeometry([26, 28, 15], 3, "branchy");
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    // narrow base, wide crown
    let baseW = 0, topW = 0;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), x = Math.abs(pos.getX(i));
      if (y < 28 * 0.12) baseW = Math.max(baseW, x);
      if (y > 28 * 0.6) topW = Math.max(topW, x);
    }
    expect(topW).toBeGreaterThan(baseW * 1.4);
  });

  it("root: one trunk leaning 30–45° (side from seed), 3–5 roots, 2–4 branches", () => {
    const sides = new Set<number>();
    for (let seed = 0; seed < 40; seed++) {
      const kinds = woodLimbKinds([40, 34, 20], seed, "root");
      expect(kinds.filter((k) => k === "trunk")).toHaveLength(1);
      const roots = kinds.filter((k) => k === "root").length;
      const branches = kinds.filter((k) => k === "branch").length;
      expect(roots).toBeGreaterThanOrEqual(3);
      expect(roots).toBeLessThanOrEqual(5);
      expect(branches).toBeGreaterThanOrEqual(2);
      expect(branches).toBeLessThanOrEqual(4);
      const lean = rootLean([40, 34, 20], seed);
      expect((lean.angle * 180) / Math.PI).toBeGreaterThanOrEqual(29);
      expect((lean.angle * 180) / Math.PI).toBeLessThanOrEqual(46);
      sides.add(lean.side);
    }
    expect(sides).toEqual(new Set([-1, 1]));
  });

  it("log: low and mostly horizontal with 1–2 stubs", () => {
    for (let seed = 0; seed < 30; seed++) {
      const stubs = woodLimbKinds([26, 11, 12], seed, "log").filter((k) => k === "stub").length;
      expect(stubs).toBeGreaterThanOrEqual(1);
      expect(stubs).toBeLessThanOrEqual(2);
    }
    const geo = makeWoodGeometry([26, 11, 12], 5, "log");
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    let low = 0;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) < 11 * 0.6) low++;
    expect(low / pos.count).toBeGreaterThan(0.6);
  });

  it("wood default buriedFrac is 0.05; explicit values win; stones unchanged", () => {
    expect(DEFAULT_BURIED_FRAC_WOOD).toBe(0.05);
    expect(buriedFrac({ kind: "wood" })).toBe(0.05);
    expect(buriedFrac({ kind: "wood", buriedFrac: 0.2 })).toBe(0.2);
    expect(buriedFrac({ kind: "stone" })).toBe(0.15);
    const flat = tankGeom(TANK, { frontCm: 3, backCm: 3 });
    const pl = stonePlacement(wood(), flat.profile);
    const bed = substrateHeight(flat.profile, 0, 0);
    // sunk 5% of its height (+0.1 cm) below the lowest bed point under its base
    expect(bed - pl.bottomY).toBeGreaterThanOrEqual(0.05 * 28 + 0.1 - 1e-9);
    expect(bed - pl.bottomY).toBeLessThan(0.05 * 28 + 0.1 + 0.1);
    expect(pl.leanX).toBe(0);
    expect(pl.leanZ).toBe(0);
  });
});

describe("per-piece geometry cache (1.3.0)", () => {
  const scene = (): HardscapeVisual[] => [
    wood({ id: "a", woodStyle: "root" }),
    wood({ id: "b", woodStyle: "branchy", seed: 3, x: -20 }),
    { id: "s", kind: "stone", role: "oyaishi", x: 20, z: 0, rotationY: 0.3, sizeCm: [12, 16, 10], seed: 9 },
  ];

  it("key = id + seed + kind + woodStyle + role + sizeCm @ 0.1 cm (placement excluded)", () => {
    const h = wood();
    const k = hardscapeGeometryKey(h, "high");
    expect(hardscapeGeometryKey({ ...h, x: 9, z: -3, rotationY: 2, buriedFrac: 0.3 }, "high")).toBe(k);
    expect(hardscapeGeometryKey({ ...h, sizeCm: [26.04, 28, 15] }, "high")).toBe(k);
    expect(hardscapeGeometryKey({ ...h, woodStyle: "branchy" }, "high")).toBe(k); // default style
    for (const v of [
      { sizeCm: [26.1, 28, 15] as [number, number, number] },
      { woodStyle: "log" as const },
      { seed: 13 },
      { id: "w2" },
      { kind: "stone" as const },
    ]) {
      expect(hardscapeGeometryKey({ ...h, ...v }, "high")).not.toBe(k);
    }
    // role only matters for stones
    expect(hardscapeGeometryKey({ ...h, role: "oyaishi" }, "high")).toBe(k);
    const s = { ...h, kind: "stone" as const };
    expect(hardscapeGeometryKey({ ...s, role: "oyaishi" }, "high")).not.toBe(hardscapeGeometryKey(s, "high"));
  });

  it("changing one piece's sizeCm / woodStyle / role rebuilds only that piece; x/z/rotationY never rebuild", () => {
    const built: string[] = [];
    const cache = new HardscapeGeometryCache((h, q) => {
      built.push(h.id);
      return buildHardscapeGeometry(h, q);
    });
    let hs = scene();
    const first = hs.map((h) => cache.get(h, "high"));
    expect(built).toEqual(["a", "b", "s"]);
    built.length = 0;

    const step = (next: HardscapeVisual[]) => {
      hs = next;
      return hs.map((h) => cache.get(h, "high"));
    };
    // move + rotate everything: no rebuild, same geometry objects
    expect(step(hs.map((h) => ({ ...h, x: h.x + 3, z: h.z - 1, rotationY: h.rotationY + 0.7 })))).toEqual(first);
    expect(built).toEqual([]);
    // resize "a" (non-uniform)
    const r1 = step(hs.map((h) => (h.id === "a" ? { ...h, sizeCm: [30, 28, 12] as [number, number, number] } : h)));
    expect(built).toEqual(["a"]);
    expect(r1[1]).toBe(first[1]);
    expect(r1[2]).toBe(first[2]);
    expect(r1[0]!.boundingBox!.max.x).toBeCloseTo(15, 3);
    // woodStyle of "b"
    built.length = 0;
    step(hs.map((h) => (h.id === "b" ? { ...h, woodStyle: "log" as const } : h)));
    expect(built).toEqual(["b"]);
    // role of the stone
    built.length = 0;
    step(hs.map((h) => (h.id === "s" ? { ...h, role: "soeishi" as const } : h)));
    expect(built).toEqual(["s"]);
    // the replaced geometry was disposed
    let disposed = 0;
    const g0 = cache.get(hs[0]!, "high");
    g0.addEventListener("dispose", () => disposed++);
    step(hs.map((h) => (h.id === "a" ? { ...h, sizeCm: [20, 20, 10] as [number, number, number] } : h)));
    expect(disposed).toBe(1);
    // removed pieces are released
    cache.retain(["a", "s"]);
    expect(cache.size).toBe(2);
    cache.dispose();
    expect(cache.size).toBe(0);
  });

  it("plants are not re-laid out when only hardscape changed", () => {
    const species: Record<string, SpeciesLook> = { r: speciesLook({ id: "r", growthForm: "stem" }), m: speciesLook({ id: "m", growthForm: "carpeting" }) };
    const plants: PlantVisual[] = Array.from({ length: 12 }, (_, i) => ({
      id: `p${i}`, speciesId: i % 2 ? "r" : "m", x: -40 + i * 7, z: (i % 3) * 5 - 5, y: 0, heightCm: 15, spreadCm: 8, health: 1,
    }));
    const opts = (p: PlantVisual): LayoutOptions => ({ quality: "high", baseY: substrateHeight(g.profile, p.x, p.z), waterY: g.waterY, bounds: { halfW: 44, halfD: 21 } });
    const sync = new FieldSync();
    sync.update(plants, species, opts);
    const cache = new HardscapeGeometryCache();
    cache.get(wood(), "high");
    cache.get(wood({ sizeCm: [30, 30, 15] }), "high"); // resize hardscape …
    sync.update(plants, species, opts); // … plant inputs unchanged
    expect(sync.lastMisses).toBe(0);
    expect(sync.dirtyInstances()).toBe(0);
    cache.dispose();
  });

  it("benchmark: one rebuild ≤ 8 ms CPU at quality high (median of 21 runs after warm-up)", () => {
    const cases: HardscapeVisual[] = [
      ...WOOD_STYLES.map((s) => wood({ id: `w-${s}`, woodStyle: s, sizeCm: [40, 34, 20] })),
      { id: "stone", kind: "stone", role: "oyaishi", x: 0, z: 0, rotationY: 0, sizeCm: [13, 23, 10], seed: 101 },
    ];
    const cache = new HardscapeGeometryCache();
    const report: string[] = [];
    // Robust on shared CI runners (1.4.1): the budget is CPU time (contract:
    // "≤ 8 ms CPU on the main thread"), measured with process.cpuUsage() in
    // this test's own worker process (vitest pool "forks"), so other test
    // files running in parallel no longer inflate it as wall-clock time did.
    // Longer JIT warm-up, 21 samples, median (a GC pause hits a few samples,
    // not the median). The 8 ms budget itself is unchanged; wall time is
    // reported alongside.
    const RUNS = 21;
    const cpuMs = (u: NodeJS.CpuUsage) => (u.user + u.system) / 1000;
    for (const base of cases) {
      for (let i = 0; i < 8; i++) {
        clearShapeStore();
        cache.get({ ...base, sizeCm: [base.sizeCm[0] + 3 + i * 0.3, base.sizeCm[1], base.sizeCm[2]] }, "high");
      }
      const cpu: number[] = [];
      const wall: number[] = [];
      for (let i = 0; i < RUNS; i++) {
        // each resize step changes the key ⇒ exactly one full rebuild (no shape-store clone)
        clearShapeStore();
        const h = { ...base, sizeCm: [base.sizeCm[0] - 2 + i * 0.2, base.sizeCm[1] + i * 0.1, base.sizeCm[2]] as [number, number, number] };
        const before = cache.builds;
        const c0 = process.cpuUsage();
        const t0 = performance.now();
        cache.get(h, "high");
        wall.push(performance.now() - t0);
        cpu.push(cpuMs(process.cpuUsage(c0)));
        expect(cache.builds).toBe(before + 1);
      }
      cpu.sort((a, b) => a - b);
      wall.sort((a, b) => a - b);
      const median = cpu[Math.floor(RUNS / 2)]!;
      report.push(`${base.id} CPU median ${median.toFixed(2)} ms (p90 ${cpu[Math.floor(RUNS * 0.9)]!.toFixed(2)}), wall median ${wall[Math.floor(RUNS / 2)]!.toFixed(2)} ms`);
      expect(median).toBeLessThan(8);
    }
    console.log(`[hardscape rebuild bench, quality high] ${report.join("; ")}`);
    cache.dispose();
  });
});

describe("clampHardscapeXZ (1.3.0, real-extent semantics since 1.4.1)", () => {
  const T = { widthCm: 60, depthCm: 36 };
  const st = (over: Partial<HardscapeVisual> = {}): HardscapeVisual => ({ id: "s", kind: "stone", x: 0, z: 0, rotationY: 0, sizeCm: [12, 8, 6], seed: 1, ...over });

  it("is exported from the package index", () => {
    expect(pkg.clampHardscapeXZ).toBe(clampHardscapeXZ);
  });

  it("axis-aligned: the above-bed extent edge stays exactly 1 cm inside the glass", () => {
    const h = st();
    const far = clampHardscapeXZ(h, T, 100, -100);
    const e = hardscapeExtent({ ...h, x: far.x, z: far.z });
    expect(far.x + e.maxX).toBeCloseTo(30 - 1, 9);
    expect(far.z + e.minZ).toBeCloseTo(-(18 - 1), 9);
    // the real extent of a smooth stone is within its bounding ellipse
    expect(e.maxX).toBeLessThanOrEqual(6 + 1e-6);
    expect(-e.minZ).toBeLessThanOrEqual(3 + 1e-6);
    expect(clampHardscapeXZ(h, T, 4, -2)).toEqual({ x: 4, z: -2 });
    expect(clampHardscapeXZ(h, T, Number.NaN, 0)).toEqual({ x: 0, z: 0 });
  });

  it("rotated: uses the rotated piece's real extent", () => {
    const h = st({ rotationY: Math.PI / 2, sizeCm: [20, 8, 9] }); // long axis along z
    const p = clampHardscapeXZ(h, T, 100, 100);
    const e = hardscapeExtent({ ...h, x: p.x });
    expect(p.x + e.maxX).toBeCloseTo(30 - 1, 9);
    expect(p.z + e.maxZ).toBeCloseTo(18 - 1, 9);
    expect(e.maxZ - e.minZ).toBeGreaterThan(e.maxX - e.minX);
  });

  it("an axis where the extent is wider than the interior is centred (extent midpoint at 0)", () => {
    for (const [sizeCm, axis] of [[[70, 8, 6], "x"], [[10, 8, 40], "z"], [[60, 8, 6], "x"]] as const) {
      const h = st({ sizeCm: [...sizeCm] as [number, number, number] });
      const p = clampHardscapeXZ(h, T, 12, 5);
      const e = hardscapeExtent({ ...h, x: p.x, z: p.z });
      if (axis === "x") {
        expect(p.x + (e.minX + e.maxX) / 2).toBeCloseTo(0, 9);
        expect(p.z).toBe(5);
      } else {
        expect(p.z + (e.minZ + e.maxZ) / 2).toBeCloseTo(0, 9);
        expect(p.x).toBe(12);
      }
    }
  });
});

describe("1.2.1 edit rules (normative in 1.3.0)", () => {
  const glass = visibleGlass(g, 1000, 700);
  const sc = dragScale({ w: g.w, d: g.d }, glass);
  const T = { kind: "hardscape", id: "w" } as const;

  it("drag starts only after > 4 css px; ≤ 4 px is a click with zero onMove events", () => {
    expect(DRAG_SLOP_PX).toBe(4);
    const s = new DragSession(T, { x: 0, z: 0 }, { x: 500, y: 400 }, { w: g.w, d: g.d }, sc);
    const evs = [...s.move(504, 400), ...s.move(500, 404), ...s.move(502.8, 402.8)]; // all ≤ 4 px
    expect(evs).toEqual([]);
    expect(s.end(504, 400)).toBeNull();
    const s2 = new DragSession(T, { x: 0, z: 0 }, { x: 500, y: 400 }, { w: g.w, d: g.d }, sc);
    expect(s2.move(504.01, 400).map((e) => e.phase)).toEqual(["start", "move"]);
  });

  it("cancel reports the ORIGINAL props x/z exactly, even when outside the clamp range", () => {
    const h = wood({ x: 44.7, z: -21.9, sizeCm: [30, 20, 14] });
    const snap: EditPropsSnapshot = { plants: [], hardscape: [h], species: {} };
    const s = new DragSession(T, { x: h.x, z: h.z }, { x: 500, y: 400 }, { w: g.w, d: g.d }, sc, undefined, dragClamp(snap, T, g));
    s.move(560, 380);
    s.move(620, 300);
    expect(s.cancel()).toEqual({ target: T, phase: "cancel", x: 44.7, z: -21.9 });
  });

  it("hardscape drags clamp the rotated footprint with clampHardscapeXZ", () => {
    const h = wood({ rotationY: 0.6, sizeCm: [30, 20, 14] });
    const snap: EditPropsSnapshot = { plants: [], hardscape: [h], species: {} };
    const clamp = dragClamp(snap, T, g);
    const s = new DragSession(T, { x: 0, z: 0 }, { x: 500, y: 400 }, { w: g.w, d: g.d }, sc, undefined, clamp);
    const evs = s.move(5000, 5000);
    const last = evs[evs.length - 1]!;
    expect(last).toMatchObject(clampHardscapeXZ(h, { widthCm: g.w, depthCm: g.d }, 1e9, 1e9));
    expect(last.x).toBeLessThan(g.w / 2 - 1 - 10);
  });

  it("plant drags clamp the plant centre 1 cm inside the glass", () => {
    const P = { kind: "plant", id: "p" } as const;
    const snap: EditPropsSnapshot = { plants: [], hardscape: [], species: {} };
    const s = new DragSession(P, { x: 0, z: 0 }, { x: 500, y: 400 }, { w: g.w, d: g.d }, sc, undefined, dragClamp(snap, P, g));
    const evs = s.move(-5000, -5000);
    expect(evs[evs.length - 1]).toMatchObject(clampToGlass({ w: g.w, d: g.d }, -1e9, -1e9));
    expect(evs[evs.length - 1]).toMatchObject({ x: -(g.w / 2 - 1), z: -(g.d / 2 - 1) });
  });

  it("selection halo: front half-arc only, never depth-tested", () => {
    const mat = makeHaloMaterial();
    expect(mat.depthTest).toBe(false);
    expect(mat.depthWrite).toBe(false);
    expect(mat.transparent).toBe(true);
    mat.dispose();
    for (const rotationY of [0, 0.7, Math.PI / 2, 2.4]) {
      const spec = haloSpec({ kind: "hardscape", id: "w" }, [], [wood({ x: 5, z: -3, rotationY })])!;
      const geo = makeHaloGeometry(g, spec);
      const front = geo.getAttribute("aFront") as THREE.BufferAttribute;
      const pos = geo.getAttribute("position") as THREE.BufferAttribute;
      const ix = geo.index!;
      expect(ix.count).toBeGreaterThan(0);
      let minZ = Infinity;
      for (let i = 0; i < ix.count; i += 3) {
        const f = [front.getX(ix.getX(i)), front.getX(ix.getX(i + 1)), front.getX(ix.getX(i + 2))];
        // only cells reaching into the front half are kept (≤ one grid cell behind)
        expect(Math.max(...f)).toBeGreaterThan(-0.1);
        for (let k = 0; k < 3; k++) minZ = Math.min(minZ, pos.getZ(ix.getX(i + k)));
      }
      // only a thin sliver (one grid cell) may extend behind the centre line; the
      // fragment shader cuts the ring exactly at aFront = 0
      expect(minZ).toBeGreaterThan(-3 - spec.b * 0.2);
      geo.dispose();
    }
  });
});
