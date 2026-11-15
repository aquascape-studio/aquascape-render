/**
 * Incremental plant-field update (contract 1.2.0 perf requirement: moving one
 * item must not rebuild all instanced meshes).
 *
 * Wraps LayoutCache + InstanceBuffer and, per layer, reports the instance
 * range that actually changed since the previous update. Unchanged plants are
 * cache hits; if they also keep their slot (same offset + count in the layer)
 * their instances are not re-uploaded. Dragging one plant therefore uploads
 * just that plant's instances (or, if its leaf count changes, its slot to the
 * end of the layer). No three.js dependency.
 */
import type { PlantVisual, SpeciesLook } from "../contract.js";
import { InstanceBuffer, LAYER_KEYS, LayoutCache, type LayoutOptions } from "./layout.js";

const NL = LAYER_KEYS.length;

export interface DirtyRange {
  /** first changed instance (inclusive) */
  lo: number;
  /** last changed instance (exclusive); lo ≥ hi means nothing changed */
  hi: number;
}

export class FieldSync {
  readonly cache = new LayoutCache();
  readonly buf = new InstanceBuffer();
  /** per layer, valid after update() */
  readonly dirty: DirtyRange[] = LAYER_KEYS.map(() => ({ lo: 0, hi: 0 }));
  /** plant id → [off0, cnt0, off1, cnt1, …] in the previous update */
  private prev = new Map<string, Int32Array>();
  private next = new Map<string, Int32Array>();
  private lo = new Int32Array(NL);
  private hi = new Int32Array(NL);
  private first = true;
  /** total plants re-laid-out (cache misses) in the last update */
  lastMisses = 0;

  /**
   * Lay out all plants. `opts(p)` returns the LayoutOptions for plant p, or
   * null to skip it (unknown species).
   */
  update(
    plants: readonly PlantVisual[],
    species: Record<string, SpeciesLook>,
    opts: (p: PlantVisual, look: SpeciesLook) => LayoutOptions | null,
  ): void {
    const { buf, cache } = this;
    buf.reset();
    cache.beginFrame();
    const { lo, hi } = this;
    lo.fill(0x7fffffff);
    hi.fill(0);
    const misses0 = cache.misses;
    for (const p of plants) {
      const look = species[p.speciesId];
      if (!look) continue;
      const o = opts(p, look);
      if (!o) continue;
      const slot = new Int32Array(NL * 2);
      this.next.set(p.id, slot);
      for (let i = 0; i < NL; i++) slot[i * 2] = buf.layers[LAYER_KEYS[i]!].count;
      const m0 = cache.misses;
      cache.layout(buf, look, p, o);
      const missed = cache.misses !== m0;
      const old = this.prev.get(p.id);
      for (let i = 0; i < NL; i++) {
        const off = slot[i * 2]!;
        const cnt = buf.layers[LAYER_KEYS[i]!].count - off;
        slot[i * 2 + 1] = cnt;
        if (cnt === 0 && (!old || old[i * 2 + 1] === 0)) continue;
        const moved = !old || old[i * 2] !== off || old[i * 2 + 1] !== cnt;
        if (missed || moved) {
          if (off < lo[i]!) lo[i] = off;
          if (off + cnt > hi[i]!) hi[i] = off + cnt;
        }
      }
    }
    cache.endFrame();
    this.lastMisses = cache.misses - misses0;
    for (let i = 0; i < NL; i++) {
      const n = buf.layers[LAYER_KEYS[i]!].count;
      const d = this.dirty[i]!;
      if (this.first) {
        d.lo = 0;
        d.hi = n;
      } else {
        d.lo = lo[i]! === 0x7fffffff ? n : lo[i]!;
        d.hi = Math.min(n, hi[i]!);
      }
    }
    this.first = false;
    // swap slot maps; drop plants that disappeared
    const t = this.prev;
    this.prev = this.next;
    t.clear();
    this.next = t;
  }

  /** Force a full upload next time (e.g. the GPU buffers were recreated). */
  invalidateAll(): void {
    this.first = true;
  }

  /** Mark layer i fully dirty for the current state (after a buffer resize). */
  markLayerDirty(i: number): void {
    const d = this.dirty[i]!;
    d.lo = 0;
    d.hi = this.buf.layers[LAYER_KEYS[i]!].count;
  }

  /** Instances that will be uploaded for the last update (sum of dirty ranges). */
  dirtyInstances(): number {
    let n = 0;
    for (const d of this.dirty) n += Math.max(0, d.hi - d.lo);
    return n;
  }
}
