import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FrontalTank, speciesLook } from "../src/index.js";
import { footprintContains, hardscapeAnchors } from "../src/index.js";
import type {
  BotanyRecordLike,
  CompositionGuide,
  EditMoveEvent,
  EditTarget,
  HardscapeVisual,
  PlantVisual,
  SpeciesLook,
} from "../src/contract.js";

// Subset of aquascape-botany records (structural BotanyRecordLike only).
const RECORDS: BotanyRecordLike[] = [
  { id: "glossostigma-elatinoides", growthForm: "carpeting", colorHex: "#7cc35a", colorRange: ["light-green"] },
  { id: "micranthemum-monte-carlo", growthForm: "carpeting", colorHex: "#5fae45", colorRange: ["bright-green"] },
  { id: "taxiphyllum-christmas", growthForm: "moss", colorHex: "#4f8a3c", colorRange: ["green"] },
  { id: "cryptocoryne-wendtii", growthForm: "rosette", colorHex: "#5e7f3a", colorRange: ["green", "brown"], growth: { maxHeightCm: 15 } },
  { id: "vallisneria-spiralis", growthForm: "rosette", colorHex: "#68a84a", colorRange: ["green"], growth: { maxHeightCm: 50 } },
  { id: "anubias-barteri-nana-petite", growthForm: "epiphyte", colorHex: "#2d5a32", colorRange: ["dark-green"], visual: { leafLengthCm: 2.2, leafWidthCm: 1.4 } },
  { id: "bucephalandra-kedagang", growthForm: "epiphyte", colorHex: "#4a5c3a", colorRange: ["dark-green", "red-veined"], visual: { leafShape: "lanceolate", leafLengthCm: 2.6, leafWidthCm: 0.9 } },
  { id: "vesicularia-dubyana", growthForm: "moss", colorHex: "#5c9a40", colorRange: ["green"] },
  { id: "microsorum-pteropus", growthForm: "epiphyte", colorHex: "#3f7a3a", colorRange: ["green"], visual: { leafShape: "lanceolate", leafLengthCm: 9, leafWidthCm: 2.2 } },
  { id: "rotala-rotundifolia", growthForm: "stem", colorHex: "#86b55e", colorRange: ["green", "pink-red-high-light"], visual: { leafLengthCm: 1.2, leafWidthCm: 0.45 } },
  { id: "ludwigia-repens-rubin", growthForm: "stem", colorHex: "#a04a38", colorRange: ["red"], visual: { leafShape: "ovate", leafLengthCm: 2.2, leafWidthCm: 1.2, tipColorHex: "#e8735a" } },
  { id: "hygrophila-polysperma", growthForm: "stem", colorHex: "#92b65a", colorRange: ["light-green"], visual: { leafLengthCm: 2.4, leafWidthCm: 0.8 } },
  { id: "cabomba-caroliniana", growthForm: "stem", colorHex: "#5fbf3a", colorRange: ["bright-green"], visual: { leafShape: "linear", arrangement: "whorled", leafLengthCm: 1.6, leafWidthCm: 0.18 } },
  { id: "bacopa-caroliniana", growthForm: "stem", colorHex: "#7aa56a", colorRange: ["green"], visual: { leafShape: "ovate", leafLengthCm: 1.8, leafWidthCm: 1.0 } },
  // Iwagumi set
  { id: "hemianthus-callitrichoides", growthForm: "carpeting", colorHex: "#6cc04a", colorRange: ["bright-green"], visual: { leafShape: "round", arrangement: "mat", leafLengthCm: 0.3, leafWidthCm: 0.28, leafDensity: 1 } },
  { id: "eleocharis-acicularis", growthForm: "rosette", colorHex: "#74b94e", colorRange: ["green"], growth: { maxHeightCm: 10 }, visual: { leafShape: "needle", arrangement: "rosette", leafLengthCm: 7, leafWidthCm: 0.26, leafDensity: 1 } },
  { id: "eleocharis-mini", growthForm: "rosette", colorHex: "#82c45a", colorRange: ["green"], growth: { maxHeightCm: 5 }, visual: { leafShape: "needle", arrangement: "rosette", leafLengthCm: 3.5, leafWidthCm: 0.18, leafDensity: 1 } },
  { id: "rotala-hra", growthForm: "stem", colorHex: "#8fbf5a", colorRange: ["green", "orange-red"], visual: { leafShape: "lanceolate", arrangement: "opposite", leafLengthCm: 1.3, leafWidthCm: 0.5, tipColorHex: "#e8735a" } },
  { id: "alternanthera-reineckii-mini", growthForm: "stem", colorHex: "#b2563f", colorRange: ["red"], visual: { leafShape: "lanceolate", arrangement: "opposite", leafLengthCm: 1.6, leafWidthCm: 0.6, tipColorHex: "#e8735a" } },
  { id: "pogostemon-erectus", growthForm: "stem", colorHex: "#6fb34c", colorRange: ["green"], visual: { leafShape: "linear", arrangement: "whorled", leafLengthCm: 1.4, leafWidthCm: 0.15 } },
];

type P = Omit<PlantVisual, "id" | "health" | "y"> & { y?: number; health?: number };
const BASE: P[] = [
  // background stems (red + green)
  { speciesId: "cabomba-caroliniana", x: -25, z: -13, heightCm: 27, spreadCm: 9 },
  { speciesId: "rotala-rotundifolia", x: -18, z: -12, heightCm: 26, spreadCm: 10 },
  { speciesId: "hygrophila-polysperma", x: -10, z: -14, heightCm: 28, spreadCm: 9 },
  { speciesId: "ludwigia-repens-rubin", x: -3, z: -12, heightCm: 24, spreadCm: 9 },
  { speciesId: "rotala-rotundifolia", x: 4, z: -14, heightCm: 27, spreadCm: 10 },
  { speciesId: "bacopa-caroliniana", x: 11, z: -12, heightCm: 22, spreadCm: 8 },
  { speciesId: "ludwigia-repens-rubin", x: 17, z: -13, heightCm: 25, spreadCm: 9 },
  { speciesId: "cabomba-caroliniana", x: 24, z: -12, heightCm: 26, spreadCm: 9 },
  { speciesId: "vallisneria-spiralis", x: -27, z: -6, heightCm: 30, spreadCm: 8 },
  { speciesId: "vallisneria-spiralis", x: 27, z: -7, heightCm: 29, spreadCm: 8 },
  { speciesId: "hygrophila-polysperma", x: 20, z: -6, heightCm: 17, spreadCm: 8 },
  { speciesId: "rotala-rotundifolia", x: -20, z: -5, heightCm: 16, spreadCm: 8 },
  // midground rosettes / epiphytes
  { speciesId: "cryptocoryne-wendtii", x: -14, z: -1, heightCm: 11, spreadCm: 12 },
  { speciesId: "cryptocoryne-wendtii", x: 13, z: 0, heightCm: 10, spreadCm: 11 },
  { speciesId: "microsorum-pteropus", x: -16, z: -6, heightCm: 15, spreadCm: 10 },
  { speciesId: "anubias-barteri-nana-petite", x: -4, z: 4.5, heightCm: 5, spreadCm: 8 },
  { speciesId: "bucephalandra-kedagang", x: 2, z: 3, heightCm: 6, spreadCm: 7 },
  { speciesId: "anubias-barteri-nana-petite", x: 18, z: 3, heightCm: 5, spreadCm: 8 },
  { speciesId: "bucephalandra-kedagang", x: -20, z: 4, heightCm: 5, spreadCm: 7 },
  { speciesId: "taxiphyllum-christmas", x: -3, z: 3, heightCm: 3.5, spreadCm: 9, y: 2 },
  { speciesId: "taxiphyllum-christmas", x: 9, z: -2, heightCm: 3, spreadCm: 8, y: 4 },
  // foreground carpet
  { speciesId: "glossostigma-elatinoides", x: -21, z: 11, heightCm: 2.6, spreadCm: 20 },
  { speciesId: "micranthemum-monte-carlo", x: -7, z: 12, heightCm: 2.4, spreadCm: 19 },
  { speciesId: "glossostigma-elatinoides", x: 6, z: 11, heightCm: 2.8, spreadCm: 20 },
  { speciesId: "micranthemum-monte-carlo", x: 19, z: 12, heightCm: 2.3, spreadCm: 19 },
  { speciesId: "glossostigma-elatinoides", x: 25, z: 10, heightCm: 2.5, spreadCm: 12 },
  { speciesId: "micranthemum-monte-carlo", x: -27, z: 4, heightCm: 2.2, spreadCm: 8 },
  { speciesId: "glossostigma-elatinoides", x: 25, z: 2, heightCm: 2.4, spreadCm: 8 },
  { speciesId: "micranthemum-monte-carlo", x: -14, z: 7, heightCm: 2.2, spreadCm: 10 },
  { speciesId: "glossostigma-elatinoides", x: 9, z: 6, heightCm: 2.3, spreadCm: 10 },
];

const HARDSCAPE: HardscapeVisual[] = [
  { id: "s1", kind: "stone", x: -7, z: -2, rotationY: 0.4, sizeCm: [15, 12, 11], seed: 11 },
  { id: "s2", kind: "stone", x: 7, z: -1, rotationY: -0.6, sizeCm: [10, 8, 8], seed: 22 },
  { id: "s3", kind: "stone", x: 17, z: 4, rotationY: 1.1, sizeCm: [6, 4.5, 5.5], seed: 37 },
];

// ---- Iwagumi template: 3 main stones + 2 suteishi, steep bed 2 → 9 cm ----
const IWAGUMI_STONES: HardscapeVisual[] = [
  // oyaishi on the left third, peak near the upper-left thirds intersection
  { id: "oya", kind: "stone", role: "oyaishi", x: -12, z: -3, rotationY: 0.35, sizeCm: [13, 23, 10], seed: 101, buriedFrac: 0.2 },
  { id: "fuku", kind: "stone", role: "fukuishi", x: 4, z: -1, rotationY: -0.5, sizeCm: [11, 13, 9], seed: 202, buriedFrac: 0.18 },
  { id: "soe", kind: "stone", role: "soeishi", x: -20, z: 1, rotationY: 0.9, sizeCm: [10, 9.5, 8], seed: 303 },
  { id: "sute1", kind: "stone", role: "suteishi", x: 15, z: 5, rotationY: 1.4, sizeCm: [7.5, 7, 6], seed: 404, buriedFrac: 0.3 },
  { id: "sute2", kind: "stone", role: "suteishi", x: 23, z: 1, rotationY: -0.8, sizeCm: [5.5, 5.5, 5], seed: 505, buriedFrac: 0.35 },
];

const IWAGUMI: P[] = (() => {
  const out: P[] = [];
  // HC carpet across the whole front and middle
  for (let xi = 0; xi < 7; xi++) {
    for (const [ri, z] of [13, 8.5, 4, -0.5].entries()) {
      out.push({ speciesId: "hemianthus-callitrichoides", x: -27 + xi * 9 + (ri % 2) * 4.5, z, heightCm: 2, spreadCm: 15 });
    }
  }
  // Eleocharis meadow behind and between the stones
  for (let i = 0; i < 34; i++) {
    const x = -27.5 + i * 1.65 + ((i * 7) % 3) * 0.5;
    const z = -9 - ((i * 5) % 4) * 1.6;
    out.push({ speciesId: "eleocharis-acicularis", x, z, heightCm: 7.5 + ((i * 3) % 5) * 1.1, spreadCm: 8 });
  }
  for (let i = 0; i < 16; i++) {
    out.push({ speciesId: "eleocharis-mini", x: -26 + i * 3.5, z: -4.5 + ((i * 3) % 3), heightCm: 4, spreadCm: 6 });
  }
  return out;
})();

// ---- Dense Nature / Dutch scene (stems + rosettes + carpets) ----
const DENSE_EXTRA: P[] = [
  { speciesId: "rotala-hra", x: -22, z: -9, heightCm: 22, spreadCm: 9 },
  { speciesId: "alternanthera-reineckii-mini", x: -8, z: -8, heightCm: 12, spreadCm: 9 },
  { speciesId: "pogostemon-erectus", x: 0, z: -15, heightCm: 29, spreadCm: 9 },
  { speciesId: "rotala-hra", x: 8, z: -8, heightCm: 19, spreadCm: 9 },
  { speciesId: "alternanthera-reineckii-mini", x: 23, z: -3, heightCm: 10, spreadCm: 8 },
  { speciesId: "pogostemon-erectus", x: -13, z: -15, heightCm: 28, spreadCm: 8 },
  // fill the mid-foreground so no bare sand band shows
  { speciesId: "micranthemum-monte-carlo", x: -18, z: 6, heightCm: 2.4, spreadCm: 14 },
  { speciesId: "glossostigma-elatinoides", x: 0, z: 7, heightCm: 2.4, spreadCm: 16 },
  { speciesId: "micranthemum-monte-carlo", x: 16, z: 7, heightCm: 2.3, spreadCm: 14 },
  { speciesId: "taxiphyllum-christmas", x: 10, z: 3, heightCm: 3, spreadCm: 8 },
];

// ---- 1.3.0 driftwood: three wood styles side by side (?scene=woods) ----
const WOOD_TANK = { widthCm: 90, depthCm: 45, heightCm: 45 };
const WOODS_HS: HardscapeVisual[] = [
  { id: "w-branchy", kind: "wood", woodStyle: "branchy", x: -29, z: -3, rotationY: 0.2, sizeCm: [24, 27, 14], seed: 31 },
  { id: "w-root", kind: "wood", woodStyle: "root", x: 0, z: -4, rotationY: -0.15, sizeCm: [26, 30, 16], seed: 12 },
  { id: "w-log", kind: "wood", woodStyle: "log", x: 29, z: 1, rotationY: 0.25, sizeCm: [26, 11, 12], seed: 5 },
];
const WOODS: P[] = (() => {
  const out: P[] = [];
  for (let xi = 0; xi < 9; xi++) {
    for (const [ri, z] of [17, 12, 7].entries()) {
      out.push({ speciesId: ri === 1 ? "micranthemum-monte-carlo" : "hemianthus-callitrichoides", x: -40 + xi * 10 + (ri % 2) * 5, z, heightCm: 2.2, spreadCm: 15 });
    }
  }
  // low background
  for (let i = 0; i < 12; i++) {
    out.push({ speciesId: i % 3 === 0 ? "eleocharis-mini" : "eleocharis-acicularis", x: -41 + i * 7.4, z: -17 + (i % 2) * 2, heightCm: 6 + (i % 3) * 1.5, spreadCm: 9 });
  }
  // moss / epiphytes on the wood
  out.push({ speciesId: "taxiphyllum-christmas", x: -29, z: -2, y: 3, heightCm: 3, spreadCm: 7 });
  out.push({ speciesId: "taxiphyllum-christmas", x: -8, z: -2, y: 0, heightCm: 3, spreadCm: 8 });
  out.push({ speciesId: "bucephalandra-kedagang", x: 4, z: -1, y: 0, heightCm: 5, spreadCm: 6 });
  out.push({ speciesId: "taxiphyllum-christmas", x: 26, z: 2, y: 6, heightCm: 3, spreadCm: 8 });
  out.push({ speciesId: "anubias-barteri-nana-petite", x: 33, z: 3, y: 0, heightCm: 5, spreadCm: 7 });
  return out;
})();

// ---- 1.3.0 "Nature" scene: root tree on the left third, two stones, carpet + stems ----
const NATURE_HS: HardscapeVisual[] = [
  { id: "tree", kind: "wood", woodStyle: "root", x: -21, z: -5, rotationY: 0.1, sizeCm: [40, 34, 20], seed: 14 },
  { id: "st1", kind: "stone", role: "fukuishi", x: 13, z: 3, rotationY: -0.5, sizeCm: [13, 11, 10], seed: 202 },
  { id: "st2", kind: "stone", role: "suteishi", x: 27, z: 8, rotationY: 0.9, sizeCm: [8, 6, 7], seed: 505 },
];
const NATURE: P[] = (() => {
  const out: P[] = [];
  // HC + Monte Carlo carpet
  for (let xi = 0; xi < 9; xi++) {
    for (const [ri, z] of [17, 12.5, 8, 3.5].entries()) {
      out.push({ speciesId: (xi + ri) % 3 === 0 ? "micranthemum-monte-carlo" : "hemianthus-callitrichoides", x: -40 + xi * 10 + (ri % 2) * 5, z, heightCm: 2.2, spreadCm: 15 });
    }
  }
  // background stems, taller on the right (behind the empty side), lower behind the tree
  const stems = ["rotala-rotundifolia", "rotala-hra", "pogostemon-erectus", "hygrophila-polysperma", "ludwigia-repens-rubin", "cabomba-caroliniana", "bacopa-caroliniana"];
  for (let i = 0; i < 15; i++) {
    const x = -40 + i * 5.7;
    const hgt = 20 + 14 * Math.min(1, Math.max(0, (x + 25) / 55)) + ((i * 7) % 4);
    out.push({ speciesId: stems[i % stems.length]!, x, z: -17 + ((i * 5) % 3) * 1.3, heightCm: hgt, spreadCm: 9 });
  }
  for (let i = 0; i < 6; i++) {
    out.push({ speciesId: i % 2 ? "alternanthera-reineckii-mini" : "rotala-hra", x: 6 + i * 6, z: -9 - (i % 2) * 2, heightCm: 13 + (i % 3) * 3, spreadCm: 8 });
  }
  // midground + moss on the tree
  out.push({ speciesId: "cryptocoryne-wendtii", x: 3, z: -3, heightCm: 10, spreadCm: 11 });
  out.push({ speciesId: "eleocharis-mini", x: 21, z: 0, heightCm: 4, spreadCm: 8 });
  out.push({ speciesId: "eleocharis-mini", x: 34, z: 3, heightCm: 4, spreadCm: 8 });
  out.push({ speciesId: "taxiphyllum-christmas", x: -26, z: -3, y: 1.5, heightCm: 3, spreadCm: 9 });
  out.push({ speciesId: "bucephalandra-kedagang", x: -14, z: -1, heightCm: 5, spreadCm: 7 });
  out.push({ speciesId: "anubias-barteri-nana-petite", x: -31, z: 1, heightCm: 5, spreadCm: 8 });
  out.push({ speciesId: "taxiphyllum-christmas", x: 9, z: 6, heightCm: 3, spreadCm: 8 });
  return out;
})();

// ---- 1.4.0 "Nature + epiphytes" (?scene=epiphytes): moss / Anubias / Buce tied onto hardscape ----
const EPI_HS: HardscapeVisual[] = [
  { id: "tree", kind: "wood", woodStyle: "root", x: -13, z: -4, rotationY: 0.12, sizeCm: [40, 33, 18], seed: 14, leanSide: "auto" },
  { id: "st1", kind: "stone", role: "fukuishi", x: 17, z: 3, rotationY: -0.5, sizeCm: [14, 12, 11], seed: 202 },
  { id: "st2", kind: "stone", role: "soeishi", x: 30, z: 9, rotationY: 0.9, sizeCm: [9, 7, 8], seed: 505 },
  // a low bog-wood ledge in front of the tree for the Anubias
  { id: "log", kind: "wood", woodStyle: "log", x: 0, z: 7, rotationY: -0.15, sizeCm: [17, 6.5, 8], seed: 5 },
];
const EPIPHYTES: P[] = (() => {
  const out: P[] = [];
  // HC carpet across the front
  for (let xi = 0; xi < 10; xi++) {
    for (const [ri, z] of [18, 13.5, 9, 4.5].entries()) {
      out.push({ speciesId: "hemianthus-callitrichoides", x: -41 + xi * 9.2 + (ri % 2) * 4.5, z, heightCm: 2, spreadCm: 14 });
    }
  }
  // background stems, taller on the right, lower behind the tree
  const stems = ["rotala-rotundifolia", "rotala-hra", "pogostemon-erectus", "hygrophila-polysperma", "ludwigia-repens-rubin", "cabomba-caroliniana", "bacopa-caroliniana"];
  for (let i = 0; i < 15; i++) {
    const x = -40 + i * 5.7;
    const hgt = 17 + 15 * Math.min(1, Math.max(0, (x + 20) / 55)) + ((i * 7) % 4);
    out.push({ speciesId: stems[i % stems.length]!, x, z: -17 + ((i * 5) % 3) * 1.3, heightCm: hgt, spreadCm: 9 });
  }
  for (let i = 0; i < 5; i++) {
    out.push({ speciesId: i % 2 ? "alternanthera-reineckii-mini" : "rotala-hra", x: 10 + i * 6.5, z: -9 - (i % 2) * 2, heightCm: 12 + (i % 3) * 3, spreadCm: 8 });
  }
  out.push({ speciesId: "eleocharis-mini", x: 9, z: 1, heightCm: 4, spreadCm: 8 });
  out.push({ speciesId: "cryptocoryne-wendtii", x: 11, z: -6, heightCm: 9, spreadCm: 10 });
  // epiphytes on anchors (contract 1.4.0)
  const tree = hardscapeAnchors(EPI_HS[0]!, 10);
  // moss on the front-most high branch anchor and on a second branch far from it;
  // Anubias on the log's top
  const high = tree.filter((a) => a.y > 15);
  const mossA = high[0] ?? tree[0]!;
  const mossB = high.find((a) => Math.hypot(a.x - mossA.x, a.z - mossA.z) > 12) ?? tree[1]!;
  const anu = hardscapeAnchors(EPI_HS[3]!, 3)[0]!;
  const stone = hardscapeAnchors(EPI_HS[1]!, 4);
  const buce = stone[0]!;
  out.push({ speciesId: "taxiphyllum-christmas", x: mossA.x, z: mossA.z, y: mossA.y, heightCm: 3, spreadCm: 9 });
  out.push({ speciesId: "vesicularia-dubyana", x: mossB.x, z: mossB.z, y: mossB.y, heightCm: 3, spreadCm: 8.5 });
  out.push({ speciesId: "anubias-barteri-nana-petite", x: anu.x, z: anu.z, y: anu.y, heightCm: 6, spreadCm: 10 });
  out.push({ speciesId: "bucephalandra-kedagang", x: buce.x, z: buce.z, y: buce.y, heightCm: 6, spreadCm: 9 });
  return out;
})();

function App() {
  const params = new URLSearchParams(location.search);
  const quality = (params.get("q") as "high" | "low" | "auto" | null) ?? "auto";
  const day = Number(params.get("day") ?? 45);
  const scrub = params.get("scrub") === "1";
  const [t, setT] = useState(day);
  const species = useMemo(() => {
    const s: Record<string, SpeciesLook> = {};
    for (const r of RECORDS) s[r.id] = speciesLook(r);
    return s;
  }, []);

  useEffect(() => {
    if (!scrub) return;
    const id = setInterval(() => setT((v) => (v >= 60 ? 5 : v + 0.5)), 33);
    return () => clearInterval(id);
  }, [scrub]);

  const scene = params.get("scene") ?? "dense";
  const iwagumi = scene === "iwagumi";
  const woods = scene === "woods";
  const nature = scene === "nature";
  const epi = scene === "epiphytes";
  const bigTank = woods || nature || epi;
  const guides = (params.get("guides") as CompositionGuide | null) ?? (iwagumi ? "thirds" : "none");
  const plants = useMemo<PlantVisual[]>(() => {
    const g = Math.min(1, t / 45);
    const ease = 1 - Math.pow(1 - g, 1.6);
    const src = iwagumi ? IWAGUMI : woods ? WOODS : nature ? NATURE : epi ? EPIPHYTES : [...BASE, ...DENSE_EXTRA];
    return src.map((p, i) => ({
      id: `p${i}`,
      speciesId: p.speciesId,
      x: p.x,
      z: p.z,
      y: p.y ?? 0,
      heightCm: p.heightCm * (0.15 + 0.85 * ease),
      spreadCm: p.spreadCm * (0.25 + 0.75 * ease),
      health: p.health ?? Number(params.get("health") ?? 0.95),
    }));
  }, [t]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- editable mode (?edit=1, contract 1.2.0): controlled positions ----
  const edit = params.get("edit") === "1";
  const stones = iwagumi ? IWAGUMI_STONES : woods ? WOODS_HS : nature ? NATURE_HS : epi ? EPI_HS : HARDSCAPE;
  const [hsState, setHsState] = useState<HardscapeVisual[]>(stones);
  const [posOverride, setPosOverride] = useState<Record<string, { x: number; z: number }>>({});
  const [selected, setSelected] = useState<EditTarget | null>(() => {
    const sel = params.get("select");
    if (!sel) return null;
    return stones.some((h) => h.id === sel) ? { kind: "hardscape", id: sel } : { kind: "plant", id: sel };
  });
  const [lastEvent, setLastEvent] = useState<string>("");
  const shownPlants = useMemo(
    () => (edit ? plants.map((p) => (posOverride[p.id] ? { ...p, ...posOverride[p.id] } : p)) : plants),
    [edit, plants, posOverride],
  );
  const onMove = useCallback((e: EditMoveEvent) => {
    setLastEvent(`${e.phase} ${e.target.kind}:${e.target.id} x=${e.x.toFixed(1)} z=${e.z.toFixed(1)}`);
    if (e.target.kind === "hardscape") {
      setHsState((hs) => hs.map((h) => (h.id === e.target.id ? { ...h, x: e.x, z: e.z } : h)));
    } else {
      setPosOverride((o) => ({ ...o, [e.target.id]: { x: e.x, z: e.z } }));
    }
  }, []);
  // demo of the web-side rule: plants dropped on a stone footprint are flagged
  const onStone =
    selected?.kind === "plant" &&
    (() => {
      const p = shownPlants.find((v) => v.id === selected.id);
      return !!p && hsState.some((h) => footprintContains(h, p.x, p.z, 0.5));
    })();

  return (
    <>
      <FrontalTank
        tank={bigTank ? WOOD_TANK : { widthCm: 60, depthCm: 36, heightCm: 36 }}
        species={species}
        plants={shownPlants}
        hardscape={edit ? hsState : stones}
        quality={quality}
        guides={guides}
        focalPoint={iwagumi ? { x: -10, y: 20 } : undefined}
        bed={iwagumi ? { frontCm: 2, backCm: 9 } : bigTank ? { frontCm: 2.5, backCm: 8 } : undefined}
        reducedMotion={params.get("rm") === "1"}
        data-testid="frontal-tank"
        editable={edit}
        selected={edit ? selected : undefined}
        onSelect={edit ? setSelected : undefined}
        onMove={edit ? onMove : undefined}
        onReady={() => {
          (window as unknown as { __ready: boolean }).__ready = true;
        }}
      />
      {edit && !params.has("nohud") && (
        <div id="edit-hud" data-testid="edit-hud">
          {selected ? `${selected.kind}: ${selected.id}` : "click a stone or plant"}
          {onStone ? " — on a stone" : ""}
          {lastEvent ? ` · ${lastEvent}` : ""}
        </div>
      )}
    </>
  );
}

// simple fps meter for headless measurement
let frames = 0;
let last = performance.now();
function tick(now: number) {
  frames++;
  if (now - last >= 1000) {
    const fps = (frames * 1000) / (now - last);
    (window as unknown as { __fps: number[] }).__fps = [...((window as unknown as { __fps?: number[] }).__fps ?? []), fps];
    const hud = document.getElementById("hud");
    if (hud && !new URLSearchParams(location.search).has("nohud")) hud.textContent = `${fps.toFixed(1)} fps`;
    frames = 0;
    last = now;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

createRoot(document.getElementById("root")!).render(<App />);
