/**
 * 60-plant frame-layout benchmark (1.4.0 perf budget: ≤ 20% regression vs
 * 1.3.0 for a scene without attached plants). Runs on any version that has
 * FieldSync, so the same file can be run against main for comparison.
 */
import { describe, expect, it } from "vitest";
import type { PlantVisual, SpeciesLook } from "../contract.js";
import { FieldSync } from "./fieldSync.js";
import { substrateHeight, type LayoutOptions } from "./layout.js";
import { speciesLook } from "./speciesLook.js";
import { tankGeom } from "./tank.js";
import type { HardscapeVisual } from "../contract.js";
import { stonePlacement } from "./stones.js";
import { hardscapeAnchors, makeSurfaceField, pieceSurface } from "./surface.js";

const g = tankGeom({ widthCm: 90, depthCm: 45, heightCm: 45 }, { frontCm: 2.5, backCm: 8 });
const SPECIES: Record<string, SpeciesLook> = {
  stem: speciesLook({ id: "stem", growthForm: "stem", colorHex: "#86b55e", visual: { leafLengthCm: 1.2, leafWidthCm: 0.45 } }),
  red: speciesLook({ id: "red", growthForm: "stem", colorHex: "#a04a38", visual: { leafShape: "ovate", leafLengthCm: 2.2, leafWidthCm: 1.2, tipColorHex: "#e8735a" } }),
  hc: speciesLook({ id: "hc", growthForm: "carpeting", colorHex: "#6cc04a" }),
  moss: speciesLook({ id: "moss", growthForm: "moss", colorHex: "#4f8a3c" }),
  crypt: speciesLook({ id: "crypt", growthForm: "rosette", colorHex: "#5e7f3a", growth: { maxHeightCm: 15 } }),
  anubias: speciesLook({ id: "anubias", growthForm: "epiphyte", colorHex: "#2d5a32", visual: { leafLengthCm: 2.2, leafWidthCm: 1.4 } }),
};
const KINDS = ["stem", "stem", "red", "hc", "hc", "crypt", "moss", "anubias", "stem", "hc"];

function scene(): PlantVisual[] {
  return Array.from({ length: 60 }, (_, i) => {
    const k = KINDS[i % KINDS.length]!;
    const tall = k === "stem" || k === "red";
    return {
      id: `p${i}`, speciesId: k, x: -42 + (i * 1.41) % 84, z: tall ? -15 + (i % 3) * 2 : -5 + (i % 5) * 5, y: 0,
      heightCm: tall ? 24 : k === "crypt" ? 10 : k === "anubias" ? 5 : 2.5, spreadCm: k === "hc" ? 14 : 9, health: 0.95,
    };
  });
}

describe("60-plant frame layout benchmark", () => {
  it("scrubbing (every plant changes) stays well inside the frame budget", () => {
    const plants = scene();
    const sync = new FieldSync();
    const bounds = { halfW: 44.3, halfD: 21.8 };
    const frame = (day: number) => {
      const k = 0.4 + 0.6 * Math.min(1, day / 45);
      const ps = plants.map((p) => ({ ...p, heightCm: p.heightCm * k, spreadCm: p.spreadCm * k }));
      sync.update(ps, SPECIES, (p): LayoutOptions => ({ quality: "high", baseY: substrateHeight(g.profile, p.x, p.z), waterY: g.waterY, bounds }));
    };
    for (let d = 0; d < 15; d++) frame(d * 0.5);
    const times: number[] = [];
    for (let d = 0; d < 80; d++) {
      const t0 = performance.now();
      frame(8 + d * 0.5);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[times.length >> 1]!;
    console.log(`[bench60] 60 plants, ${sync.buf.total()} instances: median ${median.toFixed(2)} ms/frame, p90 ${times[Math.floor(times.length * 0.9)]!.toFixed(2)} ms`);
    expect(median).toBeLessThan(33);
  });

  it("1.4.0: same scene with its 12 moss / Anubias plants attached to driftwood", () => {
    const hs: HardscapeVisual[] = [
      { id: "tree", kind: "wood", woodStyle: "root", x: -13, z: -4, rotationY: 0.12, sizeCm: [40, 33, 18], seed: 14 },
      { id: "log", kind: "wood", woodStyle: "log", x: 18, z: 5, rotationY: -0.15, sizeCm: [24, 8, 10], seed: 5 },
    ];
    const pieces = hs.map((h) => ({ h, surf: pieceSurface(h, "high"), bedRef: stonePlacement(h, g.profile).bedRef }));
    const field = makeSurfaceField(pieces);
    const anchors = [...hardscapeAnchors(hs[0]!, 8).map((a) => ({ a, p: pieces[0]! })), ...hardscapeAnchors(hs[1]!, 4).map((a) => ({ a, p: pieces[1]! }))];
    let k = 0;
    const plants = scene().map((p) => {
      if ((p.speciesId === "moss" || p.speciesId === "anubias") && k < anchors.length) {
        const { a } = anchors[k++]!;
        return { ...p, x: a.x, z: a.z, y: a.y };
      }
      return p;
    });
    const refOf = new Map(plants.filter((p) => p.y > 0).map((p, i) => [p.id, anchors[i]!.p.bedRef]));
    const sync = new FieldSync();
    const bounds = { halfW: 44.3, halfD: 21.8 };
    const frame = (day: number) => {
      const kk = 0.4 + 0.6 * Math.min(1, day / 45);
      const ps = plants.map((p) => ({ ...p, heightCm: p.heightCm * kk, spreadCm: p.spreadCm * kk }));
      sync.update(ps, SPECIES, (p): LayoutOptions =>
        p.y > 0
          ? { quality: "high", baseY: refOf.get(p.id)!, waterY: g.waterY, bounds, surface: field, surfaceKey: "s" }
          : { quality: "high", baseY: substrateHeight(g.profile, p.x, p.z), waterY: g.waterY, bounds });
    };
    for (let d = 0; d < 15; d++) frame(d * 0.5);
    const times: number[] = [];
    for (let d = 0; d < 80; d++) {
      const t0 = performance.now();
      frame(8 + d * 0.5);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[times.length >> 1]!;
    console.log(`[bench60 attached] 60 plants (${k} attached), ${sync.buf.total()} instances: median ${median.toFixed(2)} ms/frame`);
    expect(k).toBe(12);
    expect(median).toBeLessThan(33);
  });
});
