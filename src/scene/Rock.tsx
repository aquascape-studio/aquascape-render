import { useMemo } from "react";
import * as THREE from "three";
import { ROCK_BASE, ROCK_HIGHLIGHT } from "../palette.js";
import type { RockSpec } from "../types.js";

interface RockProps {
  spec: RockSpec;
}

/**
 * Procedural rock: a subdivided icosahedron deformed by low-frequency value
 * noise, shaded with a single MeshStandardMaterial. Flecks toward
 * `ROCK_HIGHLIGHT` are faked by painting vertex colors on peaks so the material
 * reads as ink-700 stone with the occasional stone-500 highlight, without
 * spending a second draw call on a speckle mesh.
 *
 * Draw-call budget: exactly 1 mesh per rock.
 */
export function Rock({ spec }: RockProps) {
  const { position, rotationY = 0, radiusCm, seed = 0.42 } = spec;

  const geometry = useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(radiusCm, 2);
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;
    const count = posAttr.count;

    // Deterministic hash keyed on (seed, vertex index-ish) — same seed same rock.
    const hash3 = (x: number, y: number, z: number, s: number): number => {
      const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + s * 57.3) * 43758.5453;
      return n - Math.floor(n);
    };

    // Low-freq noise: sample hashes around the unit direction and blend.
    const noise3 = (x: number, y: number, z: number, s: number): number => {
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const iz = Math.floor(z);
      const fx = x - ix;
      const fy = y - iy;
      const fz = z - iz;
      const smooth = (t: number): number => t * t * (3 - 2 * t);
      const u = smooth(fx);
      const v = smooth(fy);
      const w = smooth(fz);
      const c000 = hash3(ix, iy, iz, s);
      const c100 = hash3(ix + 1, iy, iz, s);
      const c010 = hash3(ix, iy + 1, iz, s);
      const c110 = hash3(ix + 1, iy + 1, iz, s);
      const c001 = hash3(ix, iy, iz + 1, s);
      const c101 = hash3(ix + 1, iy, iz + 1, s);
      const c011 = hash3(ix, iy + 1, iz + 1, s);
      const c111 = hash3(ix + 1, iy + 1, iz + 1, s);
      const x00 = c000 * (1 - u) + c100 * u;
      const x10 = c010 * (1 - u) + c110 * u;
      const x01 = c001 * (1 - u) + c101 * u;
      const x11 = c011 * (1 - u) + c111 * u;
      const y0 = x00 * (1 - v) + x10 * v;
      const y1 = x01 * (1 - v) + x11 * v;
      return y0 * (1 - w) + y1 * w;
    };

    const colors = new Float32Array(count * 3);
    const base = new THREE.Color(ROCK_BASE);
    const hi = new THREE.Color(ROCK_HIGHLIGHT);

    // Three octaves of displacement, each pulling the vertex along its outward
    // normal. Amplitudes sized relative to radius so small rocks stay jagged.
    for (let i = 0; i < count; i++) {
      const px = posAttr.getX(i);
      const py = posAttr.getY(i);
      const pz = posAttr.getZ(i);
      const len = Math.hypot(px, py, pz) || 1;
      const nx = px / len;
      const ny = py / len;
      const nz = pz / len;

      const n1 = noise3(nx * 1.3, ny * 1.3, nz * 1.3, seed);
      const n2 = noise3(nx * 2.7, ny * 2.7, nz * 2.7, seed + 1);
      const n3 = noise3(nx * 5.1, ny * 5.1, nz * 5.1, seed + 2);
      const disp = (n1 - 0.5) * 0.35 + (n2 - 0.5) * 0.18 + (n3 - 0.5) * 0.08;

      const scale = 1 + disp;
      posAttr.setXYZ(i, nx * radiusCm * scale, ny * radiusCm * scale, nz * radiusCm * scale);

      // Paint flecks: high-freq noise peaks pick up ROCK_HIGHLIGHT.
      const fleck = Math.max(0, n3 - 0.72) / 0.28;
      const r = base.r + (hi.r - base.r) * fleck;
      const g = base.g + (hi.g - base.g) * fleck;
      const b = base.b + (hi.b - base.b) * fleck;
      colors[i * 3 + 0] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }

    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    posAttr.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }, [radiusCm, seed]);

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: ROCK_BASE,
        vertexColors: true,
        roughness: 0.88,
        metalness: 0.02,
        flatShading: false,
      }),
    [],
  );

  // Y so the rock sits on the substrate top (substrate is 3 cm thick in Tank).
  const substrateTopY = 3;
  const yCenter = substrateTopY + radiusCm * 0.6;
  const [x, z] = position;

  return (
    <mesh
      geometry={geometry}
      material={material}
      position={[x, yCenter, z]}
      rotation={[0, rotationY, 0]}
      castShadow={false}
      receiveShadow={false}
    />
  );
}
