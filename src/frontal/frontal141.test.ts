/**
 * Contract 1.4.1 tests: hardscapeExtent (real above-bed extent, from the
 * shared shape store), clampHardscapeXZ on that extent for every wood style /
 * stone role × 24 rotations × the 4 template tanks, resolveLeanSide, the
 * sloped-bed reference of attached plants, and "never y ≤ 0" surfaces.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { HardscapeVisual, StoneRole, WoodStyle } from "../contract.js";
import { RENDER_CONTRACT_VERSION } from "../contract.js";
import * as pkg from "../index.js";
import { GLASS_INSET_CM, clampHardscapeXZ } from "./editMath.js";
import * as frontal from "./index.js";
import { HardscapeGeometryCache, buildHardscapeGeometry, clearShapeStore, shapeStoreStats } from "./hardscapeCache.js";
import { substrateHeight, type SubstrateProfile } from "./layout.js";
import { stonePlacement } from "./stones.js";
import { attachedBedRef, hardscapeAnchors, hardscapeExtent, hardscapeSurfaceY, pieceSurface } from "./surface.js";
import { tankGeom } from "./tank.js";
import { WOOD_STYLES, leanSideOf, resolveLeanSide } from "./wood.js";

const ROLES: StoneRole[] = ["oyaishi", "fukuishi", "soeishi", "suteishi"];

function wood(style: WoodStyle, over: Partial<HardscapeVisual> = {}): HardscapeVisual {
  return { id: `w-${style}`, kind: "wood", woodStyle: style, x: 0, z: 0, rotationY: 0, sizeCm: style === "log" ? [22, 9, 10] : [24, 22, 13], seed: 14, ...over };
}
function stone(role: StoneRole, over: Partial<HardscapeVisual> = {}): HardscapeVisual {
  return { id: `s-${role}`, kind: "stone", role, x: 0, z: 0, rotationY: 0, sizeCm: [12, 14, 9], seed: 202, ...over };
}

/** World matrix of the piece exactly as FrontalTank's HardscapeItem groups place it. */
function renderedMatrix(h: HardscapeVisual, profile: SubstrateProfile) {
  const place = stonePlacement(h, profile);
  const outer = new THREE.Group();
  outer.position.set(h.x, place.bottomY, h.z);
  outer.rotation.set(place.leanX, 0, place.leanZ);
  const inner = new THREE.Group();
  inner.rotation.set(0, h.rotationY, 0);
  outer.add(inner);
  outer.updateMatrixWorld(true);
  return { m: inner.matrixWorld.clone(), place };
}

const geoMemo = new Map<string, THREE.BufferGeometry>();
function geoOf(h: HardscapeVisual): THREE.BufferGeometry {
  const k = `${h.kind}|${h.woodStyle}|${h.role}|${h.seed}|${h.sizeCm.join(",")}|${leanSideOf(h)}`;
  let g = geoMemo.get(k);
  if (!g) {
    g = buildHardscapeGeometry(h, "high");
    geoMemo.set(k, g);
  }
  return g;
}

/** World-space bounds of the rendered vertices above the piece's bed plane (bedRef). */
function renderedAboveBed(h: HardscapeVisual, profile: SubstrateProfile) {
  const { m, place } = renderedMatrix(h, profile);
  const P = geoOf(h).getAttribute("position") as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, n = 0;
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i).applyMatrix4(m);
    if (v.y <= place.bedRef) continue;
    n++;
    if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
    if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
  }
  return { minX, maxX, minZ, maxZ, n };
}

const FLAT = tankGeom({ widthCm: 90, depthCm: 45, heightCm: 45 }, { frontCm: 3, backCm: 3 }).profile;

describe("contract 1.4.1 exports", () => {
  it("version is 1.4.1", () => {
    expect(RENDER_CONTRACT_VERSION).toBe("1.4.1");
  });
  it("hardscapeExtent / resolveLeanSide are exported from the package and frontal index", () => {
    expect(pkg.hardscapeExtent).toBe(hardscapeExtent);
    expect(pkg.resolveLeanSide).toBe(resolveLeanSide);
    expect(frontal.hardscapeExtent).toBe(hardscapeExtent);
    expect(frontal.resolveLeanSide).toBe(resolveLeanSide);
  });
});

describe("hardscapeExtent (1.4.1)", () => {
  const pieces = [...WOOD_STYLES.map((s) => wood(s)), wood("root", { id: "root-l", x: 9, leanSide: "auto" }), ...ROLES.map((r) => stone(r)), stone("oyaishi", { id: "oya-l", x: -7 })];

  for (const base of pieces) {
    it(`${base.id}: equals the rendered above-bed vertex bounds (offsets from x/z), every 15°`, () => {
      for (let k = 0; k < 24; k++) {
        const h = { ...base, x: base.x || 4, z: -3, rotationY: (k * Math.PI) / 12 };
        const e = hardscapeExtent(h);
        const r = renderedAboveBed(h, FLAT);
        expect(r.n).toBeGreaterThan(0);
        // vertices are inside the extent; edge clipping at the bed adds ≤ one triangle's reach
        expect(e.minX).toBeLessThanOrEqual(r.minX - h.x + 1e-6);
        expect(e.maxX).toBeGreaterThanOrEqual(r.maxX - h.x - 1e-6);
        expect(e.minZ).toBeLessThanOrEqual(r.minZ - h.z + 1e-6);
        expect(e.maxZ).toBeGreaterThanOrEqual(r.maxZ - h.z - 1e-6);
        expect(r.minX - h.x - e.minX).toBeLessThan(0.6);
        expect(e.maxX - (r.maxX - h.x)).toBeLessThan(0.6);
        expect(r.minZ - h.z - e.minZ).toBeLessThan(0.6);
        expect(e.maxZ - (r.maxZ - h.z)).toBeLessThan(0.6);
      }
    });
  }

  it("is placement-independent (offsets) except for the lean side, and pure", () => {
    const h = wood("branchy", { rotationY: 0.9, x: 5, z: 2 });
    expect(hardscapeExtent({ ...h, x: 20, z: -9 })).toEqual(hardscapeExtent(h));
    expect(hardscapeExtent({ ...h, id: "other" })).toEqual(hardscapeExtent(h));
    const a = hardscapeExtent(h);
    a.minX = 999; // returned objects are copies
    expect(hardscapeExtent(h).minX).not.toBe(999);
    // root "auto" leans towards the centre: the extent mirrors with the side
    const rl = hardscapeExtent(wood("root", { x: -10 }));
    const rr = hardscapeExtent(wood("root", { x: 10 }));
    expect(rl.maxX).toBeCloseTo(-rr.minX, 6);
  });

  it("buried parts are ignored: a deeper burial never grows the extent", () => {
    for (const r of ROLES) {
      const shallow = hardscapeExtent(stone(r, { buriedFrac: 0 }));
      const deep = hardscapeExtent(stone(r, { buriedFrac: 0.6 }));
      expect(deep.maxX - deep.minX).toBeLessThanOrEqual(shallow.maxX - shallow.minX + 1e-6);
      expect(deep.maxZ - deep.minZ).toBeLessThanOrEqual(shallow.maxZ - shallow.minZ + 1e-6);
    }
  });

  it("comes from the shape store: no rebuild after the renderer built the piece, none for moves / rotations", () => {
    clearShapeStore();
    const cache = new HardscapeGeometryCache();
    // root lean stored resolved (as the editor does), so crossing x = 0 is not a shape change
    const hs = [...WOOD_STYLES.map((s) => wood(s, { seed: 77, leanSide: "left" })), ...ROLES.map((r) => stone(r, { seed: 78 }))];
    for (const h of hs) cache.get(h, "high");
    const before = shapeStoreStats.builds;
    const t0 = performance.now();
    let n = 0;
    for (const h of hs) {
      for (let k = 0; k < 24; k++) {
        hardscapeExtent({ ...h, rotationY: (k * Math.PI) / 12 });
        clampHardscapeXZ({ ...h, rotationY: (k * Math.PI) / 12 }, { widthCm: 60, depthCm: 30 }, 100 - k * 9, -50 + k * 4);
        n += 2;
      }
    }
    const ms = performance.now() - t0;
    expect(shapeStoreStats.builds).toBe(before);
    expect(cache.builds).toBe(hs.length);
    // memoised per (shape, rotation, lean): a drag frame's clamp is far below a rebuild
    const t1 = performance.now();
    for (let i = 0; i < 1000; i++) clampHardscapeXZ({ ...hs[0]!, rotationY: 0.5 }, { widthCm: 60, depthCm: 30 }, i % 70 - 35, 20);
    const perClamp = (performance.now() - t1) / 1000;
    console.log(`[extent] ${n} first-time extents/clamps over ${hs.length} cached shapes: ${ms.toFixed(1)} ms total; memoised clamp ${(perClamp * 1000).toFixed(1)} µs`);
    expect(perClamp).toBeLessThan(0.5);
    // a helper that runs first builds once; the renderer then clones (no second build)
    clearShapeStore();
    const fresh = wood("branchy", { seed: 91 });
    hardscapeExtent(fresh);
    const b1 = shapeStoreStats.builds;
    const c2 = new HardscapeGeometryCache((h, q) => buildHardscapeGeometry(h, q));
    expect(c2.builds).toBe(0);
    const c3 = new HardscapeGeometryCache();
    const geo = c3.get(fresh, "high");
    expect(shapeStoreStats.builds).toBe(b1);
    expect(geo.getAttribute("position").count).toBeGreaterThan(0);
    cache.dispose();
    c3.dispose();
  });
});

describe("clampHardscapeXZ on the real extent (1.4.1)", () => {
  const TANKS = [
    { widthCm: 60, depthCm: 30 },
    { widthCm: 45, depthCm: 27 },
    { widthCm: 90, depthCm: 45 },
    { widthCm: 30, depthCm: 30 },
  ];
  const kinds: HardscapeVisual[] = [...WOOD_STYLES.map((s) => wood(s)), ...ROLES.map((r) => stone(r))];
  const targets: [number, number][] = [[1e3, -1e3], [-1e3, -1e3], [1e3, 1e3], [-1e3, 1e3], [0, -1e3], [3, 4]];

  for (const base of kinds) {
    it(`${base.id}: every above-bed vertex ≥ 1 cm − 0.05 inside the glass, rotations k·15°, 4 template tanks`, () => {
      let checked = 0, centred = 0, worst = Infinity;
      for (const tank of TANKS) {
        // pieces sized to the tank (as the templates do), so most fit and some do not
        const s = Math.min(1, tank.widthCm / 60);
        const sizeCm = base.sizeCm.map((v, i) => (i === 1 ? v : v * s)) as [number, number, number];
        for (let k = 0; k < 24; k++) {
          for (const [tx, tz] of targets) {
            const h0: HardscapeVisual = { ...base, sizeCm, rotationY: (k * Math.PI) / 12, x: tx, z: tz };
            const c = clampHardscapeXZ(h0, tank, tx, tz);
            const h = { ...h0, x: c.x, z: c.z };
            const r = renderedAboveBed(h, FLAT);
            const e = hardscapeExtent(h);
            const halfW = tank.widthCm / 2, halfD = tank.depthCm / 2;
            const fitsX = e.maxX - e.minX <= tank.widthCm - 2 * GLASS_INSET_CM;
            const fitsZ = e.maxZ - e.minZ <= tank.depthCm - 2 * GLASS_INSET_CM;
            if (fitsX) {
              const ix = Math.min(halfW - r.maxX, r.minX + halfW);
              worst = Math.min(worst, ix);
              expect(ix).toBeGreaterThanOrEqual(GLASS_INSET_CM - 0.05);
            } else {
              centred++;
              expect(c.x + (e.minX + e.maxX) / 2).toBeCloseTo(0, 6);
            }
            if (fitsZ) {
              const iz = Math.min(halfD - r.maxZ, r.minZ + halfD);
              worst = Math.min(worst, iz);
              expect(iz).toBeGreaterThanOrEqual(GLASS_INSET_CM - 0.05);
            } else {
              centred++;
              expect(c.z + (e.minZ + e.maxZ) / 2).toBeCloseTo(0, 6);
            }
            checked++;
          }
        }
      }
      expect(checked).toBe(TANKS.length * 24 * targets.length);
      // far targets end up touching the 1 cm margin (not over-conservative)
      expect(worst).toBeLessThan(GLASS_INSET_CM + 0.05);
      expect(centred).toBeLessThan(checked); // most pieces fit
    });
  }

  it("a rotated branchy piece at the back glass no longer pokes through (the ellipse clamp did)", () => {
    const tank = { widthCm: 60, depthCm: 30 };
    let ellipseWorst = Infinity;
    for (let k = 0; k < 24; k++) {
      const h = wood("branchy", { rotationY: (k * Math.PI) / 12 });
      // 1.3.0 footprint-ellipse clamp, for comparison
      const a = h.sizeCm[0] / 2, b = h.sizeCm[2] / 2, r = h.rotationY;
      const ez = Math.hypot(a * Math.sin(r), b * Math.cos(r));
      const oldZ = -(tank.depthCm / 2 - 1 - ez);
      ellipseWorst = Math.min(ellipseWorst, renderedAboveBed({ ...h, z: oldZ }, FLAT).minZ + tank.depthCm / 2);
      const c = clampHardscapeXZ(h, tank, 0, -100);
      expect(renderedAboveBed({ ...h, ...c }, FLAT).minZ + tank.depthCm / 2).toBeGreaterThanOrEqual(0.95);
    }
    expect(ellipseWorst).toBeLessThan(0.95);
  });

  it("near x = 0 the lean flip is handled (result valid for the side it lands on)", () => {
    const tank = { widthCm: 30, depthCm: 30 };
    for (const h of [wood("root", { sizeCm: [29, 22, 13] }), stone("oyaishi", { sizeCm: [29, 14, 9] })]) {
      for (const x of [-0.5, -0.01, 0, 0.01, 0.5]) {
        const c = clampHardscapeXZ(h, tank, x, 0);
        const r = renderedAboveBed({ ...h, ...c }, FLAT);
        const e = hardscapeExtent({ ...h, ...c });
        if (e.maxX - e.minX <= tank.widthCm - 2) {
          expect(Math.min(15 - r.maxX, r.minX + 15)).toBeGreaterThanOrEqual(0.95);
        }
      }
    }
  });
});

describe("resolveLeanSide (1.4.1)", () => {
  it("explicit sides as given; auto / undefined: x < 0 → right, x ≥ 0 → left", () => {
    expect(resolveLeanSide(wood("root", { x: -10 }))).toBe("right");
    expect(resolveLeanSide(wood("root", { x: -0.001, leanSide: "auto" }))).toBe("right");
    expect(resolveLeanSide(wood("root", { x: 0 }))).toBe("left");
    expect(resolveLeanSide(wood("root", { x: 12, leanSide: "auto" }))).toBe("left");
    expect(resolveLeanSide(wood("root", { x: 12, leanSide: "right" }))).toBe("right");
    expect(resolveLeanSide(wood("root", { x: -12, leanSide: "left" }))).toBe("left");
  });
  it("matches the side the geometry actually leans to (cache key / render)", () => {
    for (const x of [-20, -1, 0, 1, 20]) {
      for (const leanSide of ["auto", "left", "right", undefined] as const) {
        const h = wood("root", { x, leanSide });
        expect(resolveLeanSide(h) === "left" ? -1 : 1).toBe(leanSideOf(h));
        // storing the resolved side keeps the geometry when the piece crosses x = 0
        const stored = { ...h, leanSide: resolveLeanSide(h) };
        expect(hardscapeExtent({ ...stored, x: -x || 5 })).toEqual(hardscapeExtent({ ...stored, x }));
      }
    }
  });
});

describe("surfaces never report y ≤ 0 (1.4.1)", () => {
  const pieces = [
    ...WOOD_STYLES.map((s) => wood(s, { rotationY: 0.4 })),
    ...ROLES.map((r) => stone(r, { rotationY: -0.7, x: 6 })),
    stone("suteishi", { id: "deep", buriedFrac: 0.6 }),
    wood("log", { id: "log-deep", buriedFrac: 0.5 }),
  ];
  it("hardscapeSurfaceY is null (not ≤ 0) for columns that only meet buried geometry", () => {
    for (const h of pieces) {
      const S = pieceSurface(h);
      let buried = 0, n = 0;
      for (let i = 0; i <= 60; i++) {
        for (let j = 0; j <= 60; j++) {
          const x = S.minX + ((S.maxX - S.minX) * i) / 60;
          const z = S.minZ + ((S.maxZ - S.minZ) * j) / 60;
          const raw = S.top(x, z);
          const y = hardscapeSurfaceY(h, x, z);
          if (raw !== null && raw <= 0) {
            buried++;
            expect(y).toBeNull();
          } else {
            expect(y).toBe(raw);
          }
          if (y !== null) {
            expect(y).toBeGreaterThan(0);
            n++;
          }
        }
      }
      expect(n).toBeGreaterThan(20);
      if (h.id === "deep" || h.id === "log-deep") expect(buried).toBeGreaterThan(0);
    }
  });
  it("hardscapeAnchors never returns y ≤ 0.2", () => {
    for (const h of pieces) {
      for (const seed of [1, 2, 3, 4]) {
        for (const a of hardscapeAnchors({ ...h, seed }, 24)) expect(a.y).toBeGreaterThan(0.2);
      }
    }
  });
});

describe("sloped-bed reference of attached plants (1.4.1)", () => {
  // bed front 2 cm, back 8 cm (measured from the floor glass)
  const g = tankGeom({ widthCm: 90, depthCm: 45, heightCm: 45 }, { frontCm: 2, backCm: 8 });
  const ray = new THREE.Raycaster();

  function rendered(h: HardscapeVisual) {
    const { m, place } = renderedMatrix(h, g.profile);
    const mesh = new THREE.Mesh(geoOf(h), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(m);
    mesh.matrixWorld.copy(m);
    return { mesh, place };
  }
  function castDown(mesh: THREE.Mesh, x: number, z: number): number | null {
    ray.set(new THREE.Vector3(x, 500, z), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObject(mesh, false);
    return hits.length ? hits[0]!.point.y : null;
  }

  const hs: HardscapeVisual[] = [
    wood("root", { id: "root", x: -18, z: -6, rotationY: 0.2, sizeCm: [40, 30, 18] }),
    wood("branchy", { id: "branchy", x: 22, z: -4, rotationY: 1.1, sizeCm: [34, 28, 20] }),
    // a log lying across the slope: the case where the piece is sunk to its downhill end
    wood("log", { id: "log", x: 0, z: 2, rotationY: Math.PI / 2, sizeCm: [32, 10, 12] }),
    stone("oyaishi", { id: "oya", x: 30, z: 8, sizeCm: [22, 24, 18], buriedFrac: 0 }),
    stone("soeishi", { id: "soe", x: -32, z: 9, rotationY: 1.4, sizeCm: [26, 10, 20], buriedFrac: 0.05 }),
  ];
  const pieces = hs.map((h) => ({ h, surf: pieceSurface(h, "high"), bedRef: stonePlacement(h, g.profile).bedRef }));

  it("an attached plant's base (drawn at the piece's bed reference + y) is within 0.5 cm of the rendered surface, ≥ 10 cm from the piece centre", () => {
    let far = 0, worst = 0, worstColumnRef = 0;
    for (const h of hs) {
      const { mesh } = rendered(h);
      for (const a of hardscapeAnchors(h, 40)) {
        if (Math.hypot(a.x - h.x, a.z - h.z) < 10) continue;
        const ref = attachedBedRef(pieces, a.x, a.z, a.y);
        expect(ref).not.toBeNull();
        const base = ref! + a.y;
        const surf = castDown(mesh, a.x, a.z);
        expect(surf).not.toBeNull();
        worst = Math.max(worst, Math.abs(base - surf!));
        // the plant's own bed column (the pre-1.4.1 reading) would be off on the slope
        worstColumnRef = Math.max(worstColumnRef, Math.abs(substrateHeight(g.profile, a.x, a.z) + a.y - surf!));
        far++;
      }
    }
    console.log(`[sloped bed] ${far} anchors ≥ 10 cm from their piece centre: worst |base − surface| ${worst.toFixed(3)} cm (bed-under-plant reading: ${worstColumnRef.toFixed(2)} cm)`);
    expect(far).toBeGreaterThanOrEqual(20);
    expect(worst).toBeLessThan(0.5);
    expect(worstColumnRef).toBeGreaterThan(0.5);
  });

  it("the reference is one height per piece: bedY(h.x, h.z) whenever the centre is the lowest bed point under the base", () => {
    for (const pc of pieces) {
      const centre = substrateHeight(g.profile, pc.h.x, pc.h.z);
      // never above the centre's bed; equal unless the piece is sunk to a lower part of its base
      expect(pc.bedRef).toBeLessThanOrEqual(centre + 1e-9);
      for (const a of hardscapeAnchors(pc.h, 6)) expect(attachedBedRef(pieces, a.x, a.z, a.y)).toBe(pc.bedRef);
    }
    // a stone with the default burial on the slope: exactly bedY(h.x, h.z)
    const st = stone("fukuishi", { x: 10, z: 0, rotationY: 0.3 });
    expect(stonePlacement(st, g.profile).bedRef).toBeCloseTo(substrateHeight(g.profile, st.x, st.z), 9);
  });

  it("off-column plants just past a piece's edge still use that piece's reference, not the bed under them", () => {
    const pc = pieces.find((p) => p.h.id === "log")!;
    const e = hardscapeExtent(pc.h);
    const x = pc.h.x + e.maxX + 0.5;
    const z = pc.h.z;
    expect(pc.surf.top(x, z)).toBeNull();
    expect(attachedBedRef(pieces, x, z, 3)).toBe(pc.bedRef);
    expect(attachedBedRef(pieces, 44, 21, 3)).toBeNull();
  });
});
