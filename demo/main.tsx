import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import { FrontalTank, speciesLook } from "../src/index";
import type { BotanyRecordLike, HardscapeVisual, PlantVisual, SpeciesLook } from "../src/contract";

// Subset of aquascape-botany records (structural BotanyRecordLike only).
const RECORDS: BotanyRecordLike[] = [
  { id: "glossostigma-elatinoides", growthForm: "carpeting", colorHex: "#7cc35a", colorRange: ["light-green"] },
  { id: "micranthemum-monte-carlo", growthForm: "carpeting", colorHex: "#5fae45", colorRange: ["bright-green"] },
  { id: "taxiphyllum-christmas", growthForm: "moss", colorHex: "#4f8a3c", colorRange: ["green"] },
  { id: "cryptocoryne-wendtii", growthForm: "rosette", colorHex: "#5e7f3a", colorRange: ["green", "brown"], growth: { maxHeightCm: 15 } },
  { id: "vallisneria-spiralis", growthForm: "rosette", colorHex: "#68a84a", colorRange: ["green"], growth: { maxHeightCm: 50 } },
  { id: "anubias-barteri-nana-petite", growthForm: "epiphyte", colorHex: "#2d5a32", colorRange: ["dark-green"], visual: { leafLengthCm: 2.2, leafWidthCm: 1.4 } },
  { id: "bucephalandra-kedagang", growthForm: "epiphyte", colorHex: "#4a5c3a", colorRange: ["dark-green", "red-veined"], visual: { leafShape: "lanceolate", leafLengthCm: 2.6, leafWidthCm: 0.9 } },
  { id: "microsorum-pteropus", growthForm: "epiphyte", colorHex: "#3f7a3a", colorRange: ["green"], visual: { leafShape: "lanceolate", leafLengthCm: 9, leafWidthCm: 2.2 } },
  { id: "rotala-rotundifolia", growthForm: "stem", colorHex: "#86b55e", colorRange: ["green", "pink-red-high-light"], visual: { leafLengthCm: 1.2, leafWidthCm: 0.45 } },
  { id: "ludwigia-repens-rubin", growthForm: "stem", colorHex: "#a04a38", colorRange: ["red"], visual: { leafShape: "ovate", leafLengthCm: 2.2, leafWidthCm: 1.2, tipColorHex: "#e8735a" } },
  { id: "hygrophila-polysperma", growthForm: "stem", colorHex: "#92b65a", colorRange: ["light-green"], visual: { leafLengthCm: 2.4, leafWidthCm: 0.8 } },
  { id: "cabomba-caroliniana", growthForm: "stem", colorHex: "#5fbf3a", colorRange: ["bright-green"], visual: { leafShape: "linear", arrangement: "whorled", leafLengthCm: 1.6, leafWidthCm: 0.18 } },
  { id: "bacopa-caroliniana", growthForm: "stem", colorHex: "#7aa56a", colorRange: ["green"], visual: { leafShape: "ovate", leafLengthCm: 1.8, leafWidthCm: 1.0 } },
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

  const plants = useMemo<PlantVisual[]>(() => {
    const g = Math.min(1, t / 45);
    const ease = 1 - Math.pow(1 - g, 1.6);
    return BASE.map((p, i) => ({
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

  return (
    <FrontalTank
      tank={{ widthCm: 60, depthCm: 36, heightCm: 36 }}
      species={species}
      plants={plants}
      hardscape={HARDSCAPE}
      quality={quality}
      reducedMotion={params.get("rm") === "1"}
      data-testid="frontal-tank"
      onReady={() => {
        (window as unknown as { __ready: boolean }).__ready = true;
      }}
    />
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
    if (hud) hud.textContent = `${fps.toFixed(1)} fps`;
    frames = 0;
    last = now;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

createRoot(document.getElementById("root")!).render(<App />);
