/**
 * Contract 1.1.0 tests: stone roles, burial, composition guides, bed slope,
 * layout cache + timing, Node-ESM import specifiers.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { HardscapeVisual, PlantVisual, StoneRole } from "../contract.js";
import { makeStoneGeometry } from "./geometry.js";
import { InstanceBuffer, LAYER_KEYS, LayoutCache, layoutPlant, substrateHeight, type LayoutOptions } from "./layout.js";
import { speciesLook } from "./speciesLook.js";
import { DEFAULT_BURIED_FRAC, stonePlacement } from "./stones.js";
import { focalToScreen, frontGlassRect, guideFractions, guideLines, tankGeom } from "./tank.js";

const TANK = { widthCm: 60, depthCm: 36, heightCm: 36 };
const ROLES: StoneRole[] = ["oyaishi", "fukuishi", "soeishi", "suteishi"];

function stone(over: Partial<HardscapeVisual> = {}): HardscapeVisual {
  return { id: "s", kind: "stone", x: -10, z: -2, rotationY: 0.4, sizeCm: [12, 18, 10], seed: 7, ...over };
}

describe("stone roles (1.1.0)", () => {
  it("orders heights oyaishi > fukuishi > soeishi > suteishi for the same bounding box", () => {
    const g = tankGeom(TANK, { frontCm: 2, backCm: 9 });
    const geoH = ROLES.map((role) => {
      const geo = makeStoneGeometry([12, 18, 10], 7, role, 32, 20);
      const h = geo.boundingBox!.max.y - geo.boundingBox!.min.y;
      geo.dispose();
      return h;
    });
    const visible = ROLES.map((role) => stonePlacement(stone({ role }), g.profile).visibleHeight);
    for (let i = 1; i < ROLES.length; i++) {
      expect(geoH[i - 1]!).toBeGreaterThan(geoH[i]!);
      expect(visible[i - 1]!).toBeGreaterThan(visible[i]!);
    }
    // oyaishi fills its box height; the others are progressively lower
    expect(geoH[0]!).toBeCloseTo(18, 3);
  });

  it("stones are deterministic in seed and differ between seeds", () => {
    const a = makeStoneGeometry([10, 10, 8], 3, "fukuishi", 24, 16).getAttribute("position").array;
    const b = makeStoneGeometry([10, 10, 8], 3, "fukuishi", 24, 16).getAttribute("position").array;
    const c = makeStoneGeometry([10, 10, 8], 4, "fukuishi", 24, 16).getAttribute("position").array;
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });

  it("only oyaishi/fukuishi/soeishi lean; wood ignores role", () => {
    const g = tankGeom(TANK);
    expect(Math.abs(stonePlacement(stone({ role: "oyaishi" }), g.profile).leanZ)).toBeGreaterThan(0);
    expect(stonePlacement(stone({ role: "oyaishi" }), g.profile).leanX).toBeGreaterThan(0); // forward
    expect(Math.abs(stonePlacement(stone({ role: "suteishi" }), g.profile).leanZ)).toBe(0);
    const wood = stonePlacement(stone({ kind: "wood", role: "oyaishi" }), g.profile);
    expect(wood.leanX).toBe(0);
    expect(wood.leanZ).toBe(0);
  });
});

describe("buriedFrac (1.1.0)", () => {
  const g = tankGeom(TANK, { frontCm: 2, backCm: 9 }); // steep Iwagumi bed

  it("sinks the base below the LOCAL bed surface everywhere under the footprint", () => {
    for (const role of [...ROLES, undefined]) {
      for (const [x, z, rot] of [[-10, -3, 0.35], [4, -12, -0.5], [20, 10, 1.4], [0, 0, 0]] as const) {
        for (const bf of [undefined, 0, 0.15, 0.4, 0.6]) {
          const h = stone({ role, x, z, rotationY: rot, buriedFrac: bf });
          const p = stonePlacement(h, g.profile);
          for (const [px, pz] of p.footprint) expect(p.bottomY).toBeLessThan(substrateHeight(g.profile, px, pz));
          const frac = bf ?? DEFAULT_BURIED_FRAC;
          // at least `buriedFrac` of the height is below the bed at the centre
          expect(substrateHeight(g.profile, x, z) - p.bottomY).toBeGreaterThanOrEqual(frac * p.height - 1e-9);
        }
      }
    }
  });

  it("defaults to 0.15 and clamps to 0..0.6", () => {
    const base = stonePlacement(stone(), g.profile);
    const explicit = stonePlacement(stone({ buriedFrac: 0.15 }), g.profile);
    expect(base.bottomY).toBeCloseTo(explicit.bottomY, 9);
    const big = stonePlacement(stone({ buriedFrac: 5 }), g.profile);
    const max = stonePlacement(stone({ buriedFrac: 0.6 }), g.profile);
    expect(big.bottomY).toBeCloseTo(max.bottomY, 9);
    const neg = stonePlacement(stone({ buriedFrac: -1 }), g.profile);
    const zero = stonePlacement(stone({ buriedFrac: 0 }), g.profile);
    expect(neg.bottomY).toBeCloseTo(zero.bottomY, 9);
    expect(max.visibleHeight).toBeLessThan(base.visibleHeight);
  });
});

describe("composition guides (1.1.0)", () => {
  it("fractions: thirds at 1/3, 2/3; golden at 0.382 / 0.618; none empty", () => {
    expect(guideFractions("thirds")).toEqual([1 / 3, 2 / 3]);
    expect(guideFractions("golden")).toEqual([0.382, 0.618]);
    expect(guideFractions("none")).toEqual([]);
    expect(guideFractions(undefined)).toEqual([]);
  });

  it("lines sit on the projected front-glass rectangle", () => {
    const g = tankGeom(TANK);
    for (const [w, h] of [[1440, 900], [390, 844]] as const) {
      const r = frontGlassRect(g, w, h);
      // the glass is inside the canvas, centred horizontally, fitted with a margin
      expect(r.left).toBeGreaterThan(0);
      expect(r.left + r.width).toBeLessThan(w);
      expect(r.left + r.width / 2).toBeCloseTo(w / 2, 6);
      expect(r.top).toBeGreaterThan(0);
      expect(r.top + r.height).toBeLessThan(h);
      const t = guideLines("thirds", r);
      expect(t.xs[0]).toBeCloseTo(r.left + r.width / 3, 6);
      expect(t.xs[1]).toBeCloseTo(r.left + (2 * r.width) / 3, 6);
      expect(t.ys[0]).toBeCloseTo(r.top + r.height / 3, 6);
      expect(t.ys[1]).toBeCloseTo(r.top + (2 * r.height) / 3, 6);
      const gl = guideLines("golden", r);
      expect(gl.xs[0]).toBeCloseTo(r.left + 0.382 * r.width, 6);
      expect(gl.xs[1]).toBeCloseTo(r.left + 0.618 * r.width, 6);
      expect(gl.ys[0]).toBeCloseTo(r.top + 0.382 * r.height, 6);
      expect(gl.ys[1]).toBeCloseTo(r.top + 0.618 * r.height, 6);
    }
  });

  it("focal point maps tank cm (front view) onto the glass rectangle", () => {
    const g = tankGeom(TANK);
    const r = frontGlassRect(g, 1440, 900);
    const [cx] = focalToScreen(g, 1440, 900, 0, 5);
    expect(cx).toBeCloseTo(r.left + r.width / 2, 6);
    const [lx, ly] = focalToScreen(g, 1440, 900, -TANK.widthCm / 2, g.topY);
    expect(lx).toBeCloseTo(r.left, 6);
    expect(ly).toBeCloseTo(r.top, 6);
    const [, by] = focalToScreen(g, 1440, 900, 0, -g.floor);
    expect(by).toBeCloseTo(r.top + r.height, 6);
  });
});

describe("bed (1.1.0)", () => {
  it("default is unchanged from 1.0.1", () => {
    const g = tankGeom(TANK);
    // 1.0.1 values: floor = clamp(h*0.08, 1.5, 4), back = min(d*0.2, h*0.18)
    expect(g.floor).toBeCloseTo(Math.min(4, Math.max(1.5, 36 * 0.08)), 9);
    expect(g.profile).toEqual({ front: 0, back: Math.min(36 * 0.2, 36 * 0.18), depthCm: 36, widthCm: 60 });
    expect(g.topY).toBeCloseTo(36 - g.floor, 9);
    expect(tankGeom(TANK, undefined)).toEqual(g);
  });

  it("bed {frontCm, backCm} sets heights above the glass floor at front / back glass", () => {
    const g = tankGeom(TANK, { frontCm: 2, backCm: 9 });
    expect(g.floor).toBe(2);
    // front glass: surface y=0 is 2 cm above the floor; back glass 9 cm above it
    expect(substrateHeight(g.profile, 25, 18) + g.floor).toBeCloseTo(2, 6);
    expect(substrateHeight(g.profile, 25, -18) + g.floor).toBeCloseTo(9, 1);
  });

  it("plants stay relative to the local bed surface", () => {
    const g = tankGeom(TANK, { frontCm: 2, backCm: 9 });
    const look = speciesLook({ id: "s", growthForm: "stem" });
    const p: PlantVisual = { id: "p", speciesId: "s", x: 0, z: -12, y: 0, heightCm: 10, spreadCm: 4, health: 1 };
    const buf = new InstanceBuffer();
    const baseY = substrateHeight(g.profile, p.x, p.z);
    layoutPlant(buf, look, p, { quality: "high", baseY, waterY: g.waterY });
    const st = buf.layers.stem;
    let minY = Infinity;
    for (let i = 0; i < st.count; i++) minY = Math.min(minY, st.matrices[i * 16 + 13]!);
    expect(minY).toBeGreaterThan(baseY - 1);
    expect(minY).toBeLessThan(baseY + 0.5);
  });
});

// ---------------------------------------------------------------------------

function scene(): { look: ReturnType<typeof speciesLook>; p: PlantVisual }[] {
  const carpet = speciesLook({ id: "c", growthForm: "carpeting" });
  const stem = speciesLook({ id: "s", growthForm: "stem", visual: { leafLengthCm: 1.2, leafWidthCm: 0.45 } });
  const ludw = speciesLook({ id: "l", growthForm: "stem", visual: { leafShape: "ovate", leafLengthCm: 2.2, leafWidthCm: 1.2, tipColorHex: "#e8735a" } });
  const ros = speciesLook({ id: "r", growthForm: "rosette", growth: { maxHeightCm: 15 } });
  const moss = speciesLook({ id: "m", growthForm: "moss" });
  const out: { look: ReturnType<typeof speciesLook>; p: PlantVisual }[] = [];
  for (let i = 0; i < 36; i++) {
    const k = i % 6;
    const look = k === 0 || k === 3 ? carpet : k === 1 ? stem : k === 2 ? ludw : k === 4 ? ros : moss;
    const tall = look.growthForm === "stem";
    out.push({
      look,
      p: {
        id: `p${i}`, speciesId: look.speciesId, x: -27 + i * 1.5, z: tall ? -12 : 8, y: 0,
        heightCm: tall ? 26 : look.growthForm === "rosette" ? 12 : 2.5,
        spreadCm: tall ? 10 : look.growthForm === "rosette" ? 12 : 18, health: 0.95,
      },
    });
  }
  return out;
}

const OPTS: LayoutOptions = { quality: "high", baseY: 0, waterY: 32, bounds: { halfW: 29.4, halfD: 17.4 } };

describe("layout cache (scrubbing)", () => {
  it("exact cache hit reproduces the uncached layout byte-for-byte", () => {
    const sc = scene();
    const cache = new LayoutCache();
    const a = new InstanceBuffer();
    const b = new InstanceBuffer();
    const ref = new InstanceBuffer();
    for (const buf of [a, b]) {
      cache.beginFrame();
      for (const { look, p } of sc) cache.layout(buf, look, p, OPTS);
      cache.endFrame();
    }
    for (const { look, p } of sc) layoutPlant(ref, look, p, OPTS);
    expect(cache.misses).toBe(sc.length);
    expect(cache.hits).toBe(sc.length);
    for (const k of LAYER_KEYS) {
      expect(b.layers[k].count).toBe(ref.layers[k].count);
      expect(Array.from(b.layers[k].matrices.subarray(0, b.layers[k].count * 16))).toEqual(
        Array.from(ref.layers[k].matrices.subarray(0, ref.layers[k].count * 16)),
      );
      expect(Array.from(b.layers[k].colors.subarray(0, b.layers[k].count * 3))).toEqual(
        Array.from(a.layers[k].colors.subarray(0, a.layers[k].count * 3)),
      );
    }
  });

  it("changed plants miss, unchanged ones hit; removed plants are evicted", () => {
    const sc = scene();
    const cache = new LayoutCache();
    const buf = new InstanceBuffer();
    cache.beginFrame();
    for (const { look, p } of sc) cache.layout(buf, look, p, OPTS);
    cache.endFrame();
    const h0 = cache.hits, m0 = cache.misses;
    buf.reset();
    cache.beginFrame();
    sc.forEach(({ look, p }, i) => cache.layout(buf, look, i === 0 ? { ...p, heightCm: p.heightCm + 0.5 } : p, OPTS));
    cache.endFrame();
    expect(cache.misses - m0).toBe(1);
    expect(cache.hits - h0).toBe(sc.length - 1);
    cache.beginFrame();
    cache.layout(new InstanceBuffer(), sc[0]!.look, sc[0]!.p, OPTS);
    cache.endFrame();
    expect(cache.size).toBe(1);
  });

  it("re-layout while scrubbing is fast enough for ≥30 updates/s (high quality)", () => {
    const sc = scene();
    const cache = new LayoutCache();
    const buf = new InstanceBuffer();
    const frame = (day: number) => {
      buf.reset();
      cache.beginFrame();
      const g = 0.4 + 0.6 * Math.min(1, day / 45);
      for (const { look, p } of sc) cache.layout(buf, look, { ...p, heightCm: p.heightCm * g, spreadCm: p.spreadCm * g, health: 0.8 + 0.2 * g }, OPTS);
      cache.endFrame();
    };
    for (let d = 0; d < 10; d++) frame(d * 0.5); // warm-up (JIT + per-leaf random tables)
    const N = 60;
    const t0 = performance.now();
    for (let d = 0; d < N; d++) frame(5 + d * 0.5); // every plant changes every frame (worst case)
    const scrubMs = (performance.now() - t0) / N;
    const t1 = performance.now();
    for (let d = 0; d < N; d++) frame(60); // idle / revisits: all hits
    const hitMs = (performance.now() - t1) / N;
    const instances = buf.total();
    console.log(
      `[layout bench] ${sc.length} plants, ${instances} instances: scrub (all miss) ${scrubMs.toFixed(2)} ms/update, ` +
        `all-hit ${hitMs.toFixed(2)} ms/update`,
    );
    expect(instances).toBeGreaterThan(30000);
    // 30 updates/s ⇒ 33 ms per update for the whole pipeline; leave headroom for upload
    expect(scrubMs).toBeLessThan(25);
    expect(hitMs).toBeLessThan(scrubMs);
  });
});

describe("package ESM", () => {
  it("every relative import in src ends in .js (valid Node ESM in dist)", () => {
    const bad: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) {
          const src = readFileSync(p, "utf8");
          for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
            if (!m[1]!.endsWith(".js")) bad.push(`${p}: ${m[1]}`);
          }
        }
      }
    };
    walk(join(__dirname, ".."));
    expect(bad).toEqual([]);
  });
});
