import type {
  BotanyRecordLike,
  GrowthForm,
  LeafArrangement,
  LeafShape,
  SpeciesLook,
} from "../contract.js";

export const DEFAULT_LEAF_HEX = "#4a9a4f";
export const DEFAULT_CORAL_HEX = "#E8735A";

const GROWTH_FORMS: readonly GrowthForm[] = [
  "stem",
  "rosette",
  "carpeting",
  "epiphyte",
  "moss",
  "floating",
  "rhizome",
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function normalizeGrowthForm(g: string): GrowthForm {
  const v = g.trim().toLowerCase();
  if ((GROWTH_FORMS as readonly string[]).includes(v)) return v as GrowthForm;
  if (v === "carpet" || v === "groundcover") return "carpeting";
  if (v === "floater") return "floating";
  return "stem";
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface FormDefaults {
  leafShape: LeafShape;
  arrangement: LeafArrangement;
  leafLengthCm: number;
  leafWidthCm: number;
  leafDensity: number;
}

function formDefaults(form: GrowthForm, record: BotanyRecordLike): FormDefaults {
  const maxH = record.growth?.maxHeightCm;
  switch (form) {
    case "stem":
      return { leafShape: "lanceolate", arrangement: "opposite", leafLengthCm: 1.5, leafWidthCm: 0.4, leafDensity: 0.8 };
    case "carpeting":
      return { leafShape: "round", arrangement: "mat", leafLengthCm: 0.35, leafWidthCm: 0.3, leafDensity: 1 };
    case "moss":
      return { leafShape: "moss", arrangement: "mat", leafLengthCm: 0.25, leafWidthCm: 0.25, leafDensity: 1 };
    case "rosette": {
      // Tall rosettes (Vallisneria, Sagittaria subulata …) read as straps;
      // compact ones (Cryptocoryne, Echinodorus) as lanceolate blades.
      const tall = (maxH ?? 0) >= 30;
      const len = clamp((maxH ?? 15) * (tall ? 0.8 : 0.6), 3, 40);
      return tall
        ? { leafShape: "strap", arrangement: "rosette", leafLengthCm: len, leafWidthCm: clamp(len * 0.05, 0.5, 1.4), leafDensity: 0.6 }
        : { leafShape: "lanceolate", arrangement: "rosette", leafLengthCm: len, leafWidthCm: clamp(len * 0.24, 0.8, 4), leafDensity: 0.6 };
    }
    case "epiphyte":
      return { leafShape: "ovate", arrangement: "alternate", leafLengthCm: 3, leafWidthCm: 1.6, leafDensity: 0.6 };
    case "floating":
      return { leafShape: "round", arrangement: "alternate", leafLengthCm: 1.2, leafWidthCm: 1.2, leafDensity: 0.5 };
    case "rhizome":
      return { leafShape: "strap", arrangement: "rosette", leafLengthCm: clamp((maxH ?? 20) * 0.6, 4, 25), leafWidthCm: 1.2, leafDensity: 0.6 };
  }
}

function mentionsRed(colorRange: string[] | undefined): boolean {
  if (!colorRange) return false;
  return colorRange.some((c) => /\bred\b|red-|-red|crimson|scarlet|pink/i.test(c));
}

/**
 * Derive the render look for a botany record. Explicit `record.visual`
 * values win; anything missing falls back to growthForm defaults.
 */
export function speciesLook(record: BotanyRecordLike): SpeciesLook {
  const growthForm = normalizeGrowthForm(record.growthForm ?? "stem");
  const d = formDefaults(growthForm, record);
  const v = record.visual ?? {};

  const pos = (n: number | undefined, fallback: number) =>
    typeof n === "number" && Number.isFinite(n) && n > 0 ? n : fallback;

  const colorHex = record.colorHex && HEX_RE.test(record.colorHex) ? record.colorHex.toLowerCase() : DEFAULT_LEAF_HEX;

  let tipColorHex: string | undefined;
  if (v.tipColorHex && HEX_RE.test(v.tipColorHex)) tipColorHex = v.tipColorHex;
  else if (mentionsRed(record.colorRange)) tipColorHex = DEFAULT_CORAL_HEX;

  const look: SpeciesLook = {
    speciesId: record.id,
    growthForm,
    leafShape: v.leafShape ?? d.leafShape,
    arrangement: v.arrangement ?? d.arrangement,
    leafLengthCm: pos(v.leafLengthCm, d.leafLengthCm),
    leafWidthCm: pos(v.leafWidthCm, d.leafWidthCm),
    leafDensity: clamp(typeof v.leafDensity === "number" && Number.isFinite(v.leafDensity) ? v.leafDensity : d.leafDensity, 0, 1),
    colorHex,
  };
  if (tipColorHex) look.tipColorHex = tipColorHex;
  return look;
}
