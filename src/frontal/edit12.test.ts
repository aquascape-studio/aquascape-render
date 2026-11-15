/**
 * Contract 1.2.0 tests: footprintContains, drag mapping, clamping, picking,
 * drag session (start/move/end/cancel), suteishi default burial, leaves kept
 * inside the side glass, and incremental field updates while dragging.
 */
import { describe, expect, it } from "vitest";
import type { HardscapeVisual, PlantVisual, SpeciesLook } from "../contract.js";
import * as pkg from "../index.js";
import {
  DEPTH_DRAG_FRACTION,
  DRAG_SLOP_PX,
  DragSession,
  MIN_HIT_PX,
  chooseHit,
  clampToGlass,
  dragPosition,
  dragScale,
  footprintContains,
  hardscapePickShape,
  hitShape,
  pickTarget,
  plantPickShape,
  visibleGlass,
  type PickShape,
} from "./editMath.js";
import { FieldSync } from "./fieldSync.js";
import { InstanceBuffer, LAYER_KEYS, layoutPlant, substrateHeight, type LayoutOptions } from "./layout.js";
import { speciesLook } from "./speciesLook.js";
import { DEFAULT_BURIED_FRAC, DEFAULT_BURIED_FRAC_SUTEISHI, buriedFrac, stonePlacement } from "./stones.js";
import { tankGeom } from "./tank.js";

const TANK = { widthCm: 60, depthCm: 36, heightCm: 36 };
const g = tankGeom(TANK);

function stone(over: Partial<HardscapeVisual> = {}): HardscapeVisual {
  return { id: "s", kind: "stone", x: 0, z: 0, rotationY: 0, sizeCm: [12, 8, 6], seed: 1, ...over };
}

describe("footprintContains (1.2.0)", () => {
  it("is exported from the package index", () => {
    expect(pkg.footprintContains).toBe(footprintContains);
  });

  it("axis-aligned ellipse with half-axes sizeCm[0]/2 and sizeCm[2]/2", () => {
    const h = stone({ x: 5, z: -2 }); // half-axes 6 (x) × 3 (z)
    expect(footprintContains(h, 5, -2)).toBe(true);
    expect(footprintContains(h, 5 + 5.99, -2)).toBe(true);
    expect(footprintContains(h, 5 + 6.01, -2)).toBe(false);
    expect(footprintContains(h, 5, -2 + 2.99)).toBe(true);
    expect(footprintContains(h, 5, -2 + 3.01)).toBe(false);
    // corner of the bounding box is outside the ellipse
    expect(footprintContains(h, 5 + 5, -2 + 2.5)).toBe(false);
    // on the ellipse at 45° parameter: (6 cos t, 3 sin t)
    const t = Math.PI / 4;
    expect(footprintContains(h, 5 + 6 * Math.cos(t) * 0.999, -2 + 3 * Math.sin(t) * 0.999)).toBe(true);
    expect(footprintContains(h, 5 + 6 * Math.cos(t) * 1.001, -2 + 3 * Math.sin(t) * 1.001)).toBe(false);
  });

  it("rotates by rotationY (three.js convention, same as the stone mesh)", () => {
    // rotationY = 90°: local +x maps to world −z, so the long axis lies along z
    const h = stone({ rotationY: Math.PI / 2 });
    expect(footprintContains(h, 0, 5.9)).toBe(true);
    expect(footprintContains(h, 0, -5.9)).toBe(true);
    expect(footprintContains(h, 5.9, 0)).toBe(false);
    expect(footprintContains(h, 2.9, 0)).toBe(true);
    // 30°: local point (5.5, 0) → world (5.5 cos, −5.5 sin)
    const r = Math.PI / 6;
    const h2 = stone({ rotationY: r });
    expect(footprintContains(h2, 5.5 * Math.cos(r), -5.5 * Math.sin(r))).toBe(true);
    expect(footprintContains(h2, 5.5 * Math.cos(r), 5.5 * Math.sin(r))).toBe(false);
  });

  it("margin grows (or shrinks) both half-axes", () => {
    const h = stone();
    expect(footprintContains(h, 7, 0)).toBe(false);
    expect(footprintContains(h, 7, 0, 1.5)).toBe(true);
    expect(footprintContains(h, 0, 4, 1.5)).toBe(true);
    expect(footprintContains(h, 5, 0, -1.5)).toBe(false);
    expect(footprintContains(h, 4, 0, -1.5)).toBe(true);
    expect(footprintContains(h, 0, 0, -10)).toBe(false); // degenerate
  });
});

describe("drag mapping (1.2.0)", () => {
  const W = 1280, H = 800;
  const glass = visibleGlass(g, W, H);
  const sc = dragScale({ w: g.w, d: g.d }, glass);

  it("dragging across the visible tank width moves the full width", () => {
    expect(sc.cmPerPxX * glass.width).toBeCloseTo(g.w, 9);
    const p = dragPosition({ w: 200, d: 200 }, sc, { x: 0, z: 0 }, glass.width / 2, 0);
    expect(p.x).toBeCloseTo(g.w / 2, 6);
    expect(p.z).toBe(0);
  });

  it("dragging over 40% of the visible tank height moves the full depth; screen up = back (−z)", () => {
    expect(DEPTH_DRAG_FRACTION).toBe(0.4);
    expect(sc.cmPerPxZ * glass.height * 0.4).toBeCloseTo(g.d, 9);
    const up = dragPosition({ w: 200, d: 200 }, sc, { x: 0, z: 0 }, 0, -glass.height * 0.2);
    expect(up.z).toBeCloseTo(-g.d / 2, 6);
    const down = dragPosition({ w: 200, d: 200 }, sc, { x: 3, z: 0 }, 0, 10);
    expect(down.z).toBeGreaterThan(0);
    expect(down.x).toBe(3);
  });

  it("is resolution-independent (same fraction of the glass ⇒ same cm)", () => {
    const g2 = visibleGlass(g, 390, 700);
    const sc2 = dragScale({ w: g.w, d: g.d }, g2);
    const a = dragPosition({ w: g.w, d: g.d }, sc, { x: 0, z: 0 }, glass.width * 0.1, glass.height * 0.05);
    const b = dragPosition({ w: g.w, d: g.d }, sc2, { x: 0, z: 0 }, g2.width * 0.1, g2.height * 0.05);
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.z).toBeCloseTo(b.z, 6);
  });
});

describe("clamping (1.2.0)", () => {
  it("keeps positions 1 cm inside the glass", () => {
    expect(clampToGlass({ w: 60, d: 36 }, 100, -100)).toEqual({ x: 29, z: -17 });
    expect(clampToGlass({ w: 60, d: 36 }, -29.5, 17.5)).toEqual({ x: -29, z: 17 });
    expect(clampToGlass({ w: 60, d: 36 }, 3, -4)).toEqual({ x: 3, z: -4 });
    expect(clampToGlass({ w: 60, d: 36 }, Number.NaN, Infinity)).toEqual({ x: 0, z: 17 });
  });

  it("drag results are always clamped", () => {
    const glass = visibleGlass(g, 1000, 700);
    const sc = dragScale({ w: g.w, d: g.d }, glass);
    for (const [dx, dy] of [[-5000, 0], [5000, 5000], [0, -5000], [123, -77]] as const) {
      const p = dragPosition({ w: g.w, d: g.d }, sc, { x: 10, z: 5 }, dx, dy);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(g.w / 2 - 1 + 1e-9);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(g.d / 2 - 1 + 1e-9);
    }
  });
});

describe("drag session: start / move / end / cancel (1.2.0)", () => {
  const glass = visibleGlass(g, 1000, 700);
  const sc = dragScale({ w: g.w, d: g.d }, glass);
  const T = { kind: "hardscape", id: "s1" } as const;
  const mk = () => new DragSession(T, { x: 4, z: -3 }, { x: 500, y: 400 }, { w: g.w, d: g.d }, sc);

  it("a click without travel emits nothing (selection only)", () => {
    const s = mk();
    expect(s.move(501, 401)).toEqual([]);
    expect(s.end(501, 401)).toBeNull();
    expect(s.state).toBe("ended");
  });

  it("start fires once past the slop with the original position, then moves, then end", () => {
    const s = mk();
    const evs = s.move(500 + DRAG_SLOP_PX + 6, 400);
    expect(evs.map((e) => e.phase)).toEqual(["start", "move"]);
    expect(evs[0]).toMatchObject({ target: T, x: 4, z: -3 });
    expect(evs[1]!.x).toBeCloseTo(4 + (DRAG_SLOP_PX + 6) * sc.cmPerPxX, 9);
    const m = s.move(560, 380);
    expect(m.map((e) => e.phase)).toEqual(["move"]);
    expect(m[0]!.z).toBeLessThan(-3); // up = back
    const end = s.end(580, 380)!;
    expect(end.phase).toBe("end");
    expect(end.x).toBeCloseTo(4 + 80 * sc.cmPerPxX, 9);
    expect(s.move(600, 300)).toEqual([]); // nothing after end
    expect(s.cancel()).toBeNull();
  });

  it("cancel (Escape / pointercancel) reports the ORIGINAL x/z and stops the drag", () => {
    const s = mk();
    s.move(700, 200);
    const c = s.cancel()!;
    expect(c).toEqual({ target: T, phase: "cancel", x: 4, z: -3 });
    expect(s.move(800, 100)).toEqual([]);
    expect(s.end(800, 100)).toBeNull();
    // cancelling a mere press emits nothing
    const p = mk();
    expect(p.cancel()).toBeNull();
  });

  it("end without coordinates keeps the last proposed position", () => {
    const s = mk();
    s.move(600, 400);
    const last = s.last;
    expect(s.end()).toMatchObject({ phase: "end", x: last.x, z: last.z });
  });
});

describe("picking (1.2.0)", () => {
  const W = 1280, H = 800;
  const looks: Record<string, SpeciesLook> = {
    stem: speciesLook({ id: "stem", growthForm: "stem" }),
    hc: speciesLook({ id: "hc", growthForm: "carpeting" }),
  };
  const plant = (over: Partial<PlantVisual>): PlantVisual => ({
    id: "p", speciesId: "stem", x: 0, z: 0, y: 0, heightCm: 20, spreadCm: 8, health: 1, ...over,
  });

  it("hits a plant clump inside its projected box", () => {
    const s = plantPickShape(g, W, H, plant({ id: "a", x: -10, z: -10 }), looks.stem);
    expect(pickTarget([s], s.cx, s.cy)).toEqual({ kind: "plant", id: "a" });
    expect(pickTarget([s], s.right + 40, s.cy)).toBeNull();
  });

  it("tall clumps are capped at the water surface like the layout", () => {
    const s = plantPickShape(g, W, H, plant({ id: "tall", z: -15, heightCm: 60 }), looks.stem);
    const capped = plantPickShape(g, W, H, plant({ id: "tall", z: -15, heightCm: g.waterY }), looks.stem);
    expect(s.top).toBeCloseTo(capped.top, 6);
  });

  it("small items (< 44 px) are pickable within 22 px of their centre", () => {
    const s = plantPickShape(g, W, H, plant({ id: "tiny", heightCm: 0.5, spreadCm: 0.8 }), looks.stem);
    expect(Math.min(s.right - s.left, s.bottom - s.top)).toBeLessThan(MIN_HIT_PX);
    expect(hitShape(s, s.cx + 21, s.cy)).not.toBeNull();
    expect(hitShape(s, s.cx + 15, s.cy - 15)).not.toBeNull();
    expect(hitShape(s, s.cx + 23, s.cy)).toBeNull();
    // large items get no radius bonus
    const big: PickShape = { ...s, left: 0, right: 200, top: 0, bottom: 200, cx: 100, cy: 100 };
    expect(hitShape(big, 215, 100)).toBeNull();
  });

  it("stones use the radius rule only (direct hits come from the raycast)", () => {
    const h = stone({ id: "pebble", sizeCm: [1.2, 0.8, 1], z: 5 });
    const pl = stonePlacement(h, g.profile);
    const s = { ...hardscapePickShape(g, W, H, h, pl.bottomY + pl.height), radiusOnly: true };
    expect(hitShape(s, s.cx + 10, s.cy)).toMatchObject({ target: { kind: "hardscape", id: "pebble" } });
    const big = stone({ id: "big", sizeCm: [20, 15, 12] });
    const pb = stonePlacement(big, g.profile);
    const sb = { ...hardscapePickShape(g, W, H, big, pb.bottomY + pb.height), radiusOnly: true };
    expect(hitShape(sb, sb.cx, sb.cy)).toBeNull();
  });

  it("front-most item wins; flat carpets use their footprint ellipse", () => {
    const back = plantPickShape(g, W, H, plant({ id: "back", z: -12, heightCm: 25 }), looks.stem);
    const front = plantPickShape(g, W, H, plant({ id: "front", z: 6, heightCm: 6 }), looks.stem);
    expect(pickTarget([back, front], front.cx, front.cy)).toEqual({ kind: "plant", id: "front" });
    expect(pickTarget([back, front], back.cx, back.top + 5)).toEqual({ kind: "plant", id: "back" });
    // a raycast stone hit in front of a background plant wins
    expect(
      pickTarget([back], back.cx, back.cy, [{ target: { kind: "hardscape", id: "s" }, z: 0, dist: 0 }]),
    ).toEqual({ kind: "hardscape", id: "s" });
    const carpet = plantPickShape(g, W, H, plant({ id: "hc", speciesId: "hc", z: 10, heightCm: 2, spreadCm: 20 }), looks.hc);
    expect(carpet.shape).toBe("ellipse");
    expect(hitShape(carpet, carpet.left + 1, carpet.top + 1)).toBeNull(); // bbox corner
    expect(hitShape(carpet, carpet.cx, carpet.cy)).not.toBeNull();
  });

  it("empty space picks nothing; chooseHit tie-breaks by distance", () => {
    expect(pickTarget([], 10, 10)).toBeNull();
    expect(
      chooseHit([
        { target: { kind: "plant", id: "a" }, z: 1, dist: 12 },
        { target: { kind: "plant", id: "b" }, z: 1.1, dist: 3 },
      ]),
    ).toEqual({ kind: "plant", id: "b" });
  });
});

describe("suteishi default burial (1.2.0)", () => {
  it("defaults to 0.35 for suteishi and 0.15 for other roles; explicit values win", () => {
    expect(DEFAULT_BURIED_FRAC_SUTEISHI).toBe(0.35);
    expect(buriedFrac({ role: "suteishi" })).toBe(0.35);
    expect(buriedFrac({ role: "oyaishi" })).toBe(DEFAULT_BURIED_FRAC);
    expect(buriedFrac({})).toBe(0.15);
    expect(buriedFrac({ role: "suteishi", buriedFrac: 0.1 })).toBe(0.1);
    const a = stonePlacement(stone({ role: "suteishi" }), g.profile);
    const b = stonePlacement(stone({ role: "suteishi", buriedFrac: 0.35 }), g.profile);
    expect(a.bottomY).toBeCloseTo(b.bottomY, 9);
  });
});

describe("leaves stay inside the side glass (11-14 note)", () => {
  const looks = [
    speciesLook({ id: "ludwigia", growthForm: "stem", visual: { leafShape: "ovate", leafLengthCm: 2.2, leafWidthCm: 1.2 } }),
    speciesLook({ id: "hygro", growthForm: "stem", visual: { leafLengthCm: 2.4, leafWidthCm: 0.8 } }),
    speciesLook({ id: "cabomba", growthForm: "stem", visual: { leafShape: "linear", arrangement: "whorled", leafLengthCm: 1.6, leafWidthCm: 0.18 } }),
    speciesLook({ id: "v", growthForm: "rosette", growth: { maxHeightCm: 50 } }),
    speciesLook({ id: "e", growthForm: "epiphyte", visual: { leafShape: "lanceolate", leafLengthCm: 9, leafWidthCm: 2.2 } }),
  ];
  it("no stem / leaf extent crosses the bounds, even for clumps hugging the glass", () => {
    const bw = 29.3, bd = 17.3;
    for (const look of looks) {
      for (const [x, z] of [[-28, -14], [-25, 0], [28, -16], [27, 16]] as const) {
        const buf = new InstanceBuffer();
        layoutPlant(buf, look, { id: `p${x}${z}`, speciesId: look.speciesId, x, z, y: 0, heightCm: 28, spreadCm: 10, health: 1 }, {
          quality: "high", baseY: 0, waterY: 31, bounds: { halfW: bw, halfD: bd },
        });
        for (const k of LAYER_KEYS) {
          const L = buf.layers[k];
          for (let i = 0; i < L.count; i++) {
            const m = L.matrices.subarray(i * 16, i * 16 + 16);
            for (const [a, b] of [[0, 0], [1, 0], [0, 0.5], [0, -0.5], [1, 0.5], [1, -0.5], [0.5, 0.5], [0.5, -0.5]] as const) {
              const ox = Math.abs(m[12]! + m[8]! * a + m[0]! * b);
              expect(ox).toBeLessThanOrEqual(bw + 0.05);
              const oz = Math.abs(m[14]! + m[10]! * a + m[2]! * b);
              expect(oz).toBeLessThanOrEqual(bd + 0.05);
            }
          }
        }
      }
    }
  });
});

describe("incremental field update while dragging (1.2.0 perf)", () => {
  const recs = [
    { id: "rotala", growthForm: "stem", visual: { leafLengthCm: 1.2, leafWidthCm: 0.45 } },
    { id: "ludwigia", growthForm: "stem", visual: { leafShape: "ovate" as const, leafLengthCm: 2.2, leafWidthCm: 1.2, tipColorHex: "#e8735a" } },
    { id: "crypt", growthForm: "rosette", growth: { maxHeightCm: 15 } },
    { id: "vallis", growthForm: "rosette", growth: { maxHeightCm: 50 } },
    { id: "anubias", growthForm: "epiphyte", visual: { leafLengthCm: 2.2, leafWidthCm: 1.4 } },
    { id: "monte", growthForm: "carpeting" },
    { id: "moss", growthForm: "moss" },
  ];
  const species: Record<string, SpeciesLook> = {};
  for (const r of recs) species[r.id] = speciesLook(r);
  // 30 plants: dense mixed scene like the demo
  const base: PlantVisual[] = Array.from({ length: 30 }, (_, i) => {
    const sp = recs[i % recs.length]!.id;
    const ground = sp === "monte" || sp === "moss";
    return {
      id: `p${i}`, speciesId: sp,
      x: -26 + (i % 10) * 5.8, z: -14 + Math.floor(i / 10) * 11, y: 0,
      heightCm: ground ? 2.5 : 12 + (i % 5) * 4, spreadCm: ground ? 16 : 9, health: 0.95,
    };
  });
  const optsFor = (p: PlantVisual): LayoutOptions => ({
    quality: "high", baseY: substrateHeight(g.profile, p.x, p.z), waterY: g.waterY,
    bounds: { halfW: g.w / 2 - 0.7, halfD: g.d / 2 - 0.7 },
  });

  it("dragging one plant re-lays out only that plant and uploads only its slot", () => {
    const sync = new FieldSync();
    sync.update(base, species, optsFor);
    const total = sync.buf.total();
    expect(sync.dirtyInstances()).toBe(total); // first frame: full upload
    sync.update(base, species, optsFor);
    expect(sync.dirtyInstances()).toBe(0); // nothing changed
    const moved = base.map((p, i) => (i === 7 ? { ...p, x: p.x + 1.3, z: p.z + 0.4 } : p));
    sync.update(moved, species, optsFor);
    expect(sync.lastMisses).toBe(1);
    expect(sync.dirtyInstances()).toBeLessThan(total * 0.25);
    // the incremental result equals a full, uncached layout
    const ref = new InstanceBuffer();
    for (const p of moved) layoutPlant(ref, species[p.speciesId]!, p, optsFor(p));
    for (const k of LAYER_KEYS) {
      expect(sync.buf.layers[k].count).toBe(ref.layers[k].count);
      expect(Array.from(sync.buf.layers[k].matrices.subarray(0, ref.layers[k].count * 16))).toEqual(
        Array.from(ref.layers[k].matrices.subarray(0, ref.layers[k].count * 16)),
      );
    }
  });

  it("removing a plant marks the shifted tail dirty", () => {
    const sync = new FieldSync();
    sync.update(base, species, optsFor);
    sync.update(base.filter((_, i) => i !== 3), species, optsFor);
    expect(sync.dirtyInstances()).toBeGreaterThan(0);
    expect(sync.lastMisses).toBe(0);
  });

  it("a drag frame of one plant among 30 stays well under 16 ms", () => {
    const sync = new FieldSync();
    const dst = LAYER_KEYS.map(() => ({ m: new Float32Array(0), c: new Float32Array(0) }));
    const frame = (plants: PlantVisual[]) => {
      sync.update(plants, species, optsFor);
      // mimic the GPU-side copy of the dirty ranges (FrontalTank.PlantField)
      LAYER_KEYS.forEach((k, li) => {
        const L = sync.buf.layers[k];
        const d = dst[li]!;
        if (d.c.length < L.count * 3) {
          d.m = new Float32Array(L.capacity * 16);
          d.c = new Float32Array(L.capacity * 3);
          sync.markLayerDirty(li);
        }
        const { lo, hi } = sync.dirty[li]!;
        if (hi > lo) {
          d.m.set(L.matrices.subarray(lo * 16, hi * 16), lo * 16);
          for (let i = lo * 3; i < hi * 3; i++) d.c[i] = Math.pow(L.colors[i]!, 2.2);
        }
      });
    };
    frame(base);
    const N = 120;
    const times: number[] = [];
    let uploaded = 0;
    for (const which of [0, 5, 12]) { // a stem, a carpet, a rosette
      for (let f = 0; f < N; f++) {
        const t = f / N;
        const plants = base.map((p, i) => (i === which ? { ...p, x: p.x + Math.sin(t * 6.28) * 6, z: p.z + Math.cos(t * 6.28) * 3 } : p));
        const t0 = performance.now();
        frame(plants);
        times.push(performance.now() - t0);
        uploaded += sync.dirtyInstances();
      }
    }
    times.sort((a, b) => a - b);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const p95 = times[Math.floor(times.length * 0.95)]!;
    const total = sync.buf.total();
    console.log(
      `[drag bench] 30 plants, ${total} instances: drag-frame mean ${mean.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, ` +
        `max ${times[times.length - 1]!.toFixed(2)} ms; uploads ${(uploaded / times.length).toFixed(0)} instances/frame ` +
        `(${((uploaded / times.length / total) * 100).toFixed(1)}% of the field)`,
    );
    expect(p95).toBeLessThan(8);
  });
});
