import { describe, expect, it } from "vitest";
import { speciesLook, DEFAULT_LEAF_HEX } from "./speciesLook";
import { InstanceBuffer, layoutPlant, LAYER_KEYS, MAX_LEAVES_PER_PLANT, substrateHeight, type LayoutOptions } from "./layout";
import { chroma, healthTint, hexToRgb } from "./color";
import type { PlantVisual, SpeciesLook } from "../contract";

const OPTS: LayoutOptions = { quality: "high", baseY: 0, waterY: 30 };

function plant(over: Partial<PlantVisual> = {}): PlantVisual {
  return { id: "p1", speciesId: "s", x: 0, z: 0, y: 0, heightCm: 20, spreadCm: 10, health: 1, ...over };
}

function run(look: SpeciesLook, p: PlantVisual, opts: LayoutOptions = OPTS) {
  const buf = new InstanceBuffer();
  const n = layoutPlant(buf, look, p, opts);
  return { buf, n };
}

const leaves = (buf: InstanceBuffer) => buf.total() - buf.layers.stem.count;

describe("speciesLook", () => {
  it("applies growthForm defaults", () => {
    const stem = speciesLook({ id: "a", growthForm: "stem" });
    expect(stem).toMatchObject({ leafShape: "lanceolate", arrangement: "opposite", leafLengthCm: 1.5, leafWidthCm: 0.4 });
    expect(stem.colorHex).toBe(DEFAULT_LEAF_HEX);
    expect(stem.tipColorHex).toBeUndefined();
    expect(speciesLook({ id: "b", growthForm: "carpeting" })).toMatchObject({ leafShape: "round", arrangement: "mat" });
    expect(speciesLook({ id: "c", growthForm: "moss" })).toMatchObject({ leafShape: "moss", arrangement: "mat" });
    expect(speciesLook({ id: "d", growthForm: "rosette", growth: { maxHeightCm: 15 } })).toMatchObject({ leafShape: "lanceolate", arrangement: "rosette" });
    expect(speciesLook({ id: "e", growthForm: "rosette", growth: { maxHeightCm: 60 } }).leafShape).toBe("strap");
    expect(speciesLook({ id: "f", growthForm: "epiphyte" })).toMatchObject({ leafShape: "ovate", arrangement: "alternate" });
    expect(speciesLook({ id: "g", growthForm: "floating" }).leafShape).toBe("round");
    expect(speciesLook({ id: "h", growthForm: "rhizome" }).leafShape).toBe("strap");
  });

  it("prefers record.visual and colorHex", () => {
    const l = speciesLook({
      id: "x",
      growthForm: "stem",
      colorHex: "#7AA56A",
      visual: { leafShape: "ovate", arrangement: "whorled", leafLengthCm: 2, leafWidthCm: 1, leafDensity: 0.3, tipColorHex: "#ff0000" },
    });
    expect(l).toEqual({
      speciesId: "x", growthForm: "stem", leafShape: "ovate", arrangement: "whorled",
      leafLengthCm: 2, leafWidthCm: 1, leafDensity: 0.3, colorHex: "#7aa56a", tipColorHex: "#ff0000",
    });
  });

  it("adds a coral tip when colorRange mentions red", () => {
    expect(speciesLook({ id: "r", growthForm: "stem", colorRange: ["green", "red-high-light"] }).tipColorHex).toMatch(/^#e8735a$/i);
    expect(speciesLook({ id: "g", growthForm: "stem", colorRange: ["green"] }).tipColorHex).toBeUndefined();
  });

  it("falls back on invalid colour / unknown form", () => {
    const l = speciesLook({ id: "z", growthForm: "weird", colorHex: "green" });
    expect(l.growthForm).toBe("stem");
    expect(l.colorHex).toBe(DEFAULT_LEAF_HEX);
  });
});

describe("layoutPlant", () => {
  const forms = ["stem", "carpeting", "moss", "rosette", "epiphyte", "floating", "rhizome"] as const;

  it("is deterministic for a given plant id", () => {
    for (const f of forms) {
      const look = speciesLook({ id: f, growthForm: f });
      const a = run(look, plant()).buf;
      const b = run(look, plant()).buf;
      for (const k of LAYER_KEYS) {
        expect(a.layers[k].count).toBe(b.layers[k].count);
        expect(Array.from(a.layers[k].matrices.subarray(0, a.layers[k].count * 16))).toEqual(
          Array.from(b.layers[k].matrices.subarray(0, b.layers[k].count * 16)),
        );
      }
      const c = run(look, plant({ id: "other" })).buf;
      const k = look.leafShape;
      expect(Array.from(c.layers[k].matrices.subarray(0, 16))).not.toEqual(Array.from(a.layers[k].matrices.subarray(0, 16)));
    }
  });

  it("emits a dense, non-trivial number of leaves per form", () => {
    expect(leaves(run(speciesLook({ id: "s", growthForm: "stem" }), plant({ heightCm: 25, spreadCm: 10 })).buf)).toBeGreaterThan(400);
    expect(leaves(run(speciesLook({ id: "c", growthForm: "carpeting" }), plant({ heightCm: 2.5, spreadCm: 15 })).buf)).toBeGreaterThan(1500);
    expect(leaves(run(speciesLook({ id: "m", growthForm: "moss" }), plant({ heightCm: 3, spreadCm: 8 })).buf)).toBeGreaterThan(300);
    expect(leaves(run(speciesLook({ id: "r", growthForm: "rosette" }), plant({ heightCm: 12, spreadCm: 12 })).buf)).toBeGreaterThan(20);
  });

  it("leaf count scales with spread and height", () => {
    const stem = speciesLook({ id: "s", growthForm: "stem" });
    const carpet = speciesLook({ id: "c", growthForm: "carpeting" });
    const sSmall = leaves(run(stem, plant({ heightCm: 8, spreadCm: 4 })).buf);
    const sTall = leaves(run(stem, plant({ heightCm: 25, spreadCm: 4 })).buf);
    const sWide = leaves(run(stem, plant({ heightCm: 8, spreadCm: 12 })).buf);
    expect(sTall).toBeGreaterThan(sSmall * 2);
    expect(sWide).toBeGreaterThan(sSmall * 2);
    const c1 = leaves(run(carpet, plant({ heightCm: 2, spreadCm: 5 })).buf);
    const c2 = leaves(run(carpet, plant({ heightCm: 2, spreadCm: 15 })).buf);
    expect(c2).toBeGreaterThan(c1 * 6);
  });

  it("low quality emits fewer instances and respects caps", () => {
    const carpet = speciesLook({ id: "c", growthForm: "carpeting" });
    const hi = run(carpet, plant({ heightCm: 3, spreadCm: 40 })).n;
    const lo = run(carpet, plant({ heightCm: 3, spreadCm: 40 }), { ...OPTS, quality: "low" }).n;
    expect(lo).toBeLessThan(hi);
    expect(hi).toBeLessThanOrEqual(MAX_LEAVES_PER_PLANT.high);
    expect(lo).toBeLessThanOrEqual(MAX_LEAVES_PER_PLANT.low);
  });

  it("low health thins leaves and shifts colour towards yellow-brown", () => {
    const stem = speciesLook({ id: "s", growthForm: "stem", colorHex: "#3fa040" });
    const good = run(stem, plant({ health: 1 })).buf;
    const bad = run(stem, plant({ health: 0.2 })).buf;
    expect(leaves(bad)).toBeLessThan(leaves(good) * 0.8);
    const avg = (b: InstanceBuffer) => {
      const L = b.layers.lanceolate;
      const s = [0, 0, 0];
      for (let i = 0; i < L.count; i++) for (let k = 0; k < 3; k++) s[k]! += L.colors[i * 3 + k]!;
      return s.map((v) => v / L.count) as [number, number, number];
    };
    const g = avg(good);
    const b = avg(bad);
    // greener when healthy: green dominance over red shrinks when sick
    expect(g[1] - g[0]).toBeGreaterThan(b[1] - b[0]);
    expect(b[0]).toBeGreaterThan(g[0]);
  });

  it("keeps leaf tips inside the given bounds", () => {
    const look = speciesLook({ id: "v", growthForm: "rosette", growth: { maxHeightCm: 50 } });
    const { buf } = run(look, plant({ x: 28, heightCm: 30, spreadCm: 8 }), { ...OPTS, bounds: { halfW: 29.4, halfD: 17.4 } });
    const L = buf.layers.strap;
    for (let i = 0; i < L.count; i++) {
      const m = L.matrices.subarray(i * 16, i * 16 + 16);
      expect(m[12]! + m[8]!).toBeLessThanOrEqual(29.4 + 1e-3);
    }
  });

  it("writes orthonormal leaf bases (no NaN, faces lean towards the viewer)", () => {
    const { buf } = run(speciesLook({ id: "s", growthForm: "stem" }), plant());
    const L = buf.layers.lanceolate;
    let towardViewer = 0;
    for (let i = 0; i < L.count; i++) {
      const m = L.matrices.subarray(i * 16, i * 16 + 16);
      for (const v of m) expect(Number.isFinite(v)).toBe(true);
      const ny = m[5]!, nz = m[6]!;
      if (ny + nz > 0) towardViewer++;
    }
    expect(towardViewer / L.count).toBeGreaterThan(0.9);
  });
});

describe("colour + substrate", () => {
  it("healthTint is identity at 1 and desaturates towards brown at 0", () => {
    const c = hexToRgb("#3fa040");
    const same = healthTint(c, 1);
    same.forEach((v, i) => expect(v).toBeCloseTo(c[i]!, 6));
    const sick = healthTint(c, 0);
    expect(chroma(sick)).toBeLessThan(chroma(c));
    expect(sick[0]).toBeGreaterThan(c[0]);
  });

  it("substrate slopes up towards the back", () => {
    const p = { front: 0, back: 6, depthCm: 36, widthCm: 60 };
    expect(substrateHeight(p, 25, 18)).toBeCloseTo(0, 5);
    expect(substrateHeight(p, 25, -18)).toBeGreaterThan(5.5);
  });
});
