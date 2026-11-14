import * as THREE from "three";
import { useMemo } from "react";
import type { TankSizeCm } from "../types.js";
import { palette } from "../palette.js";

interface LightingProps {
  sizeCm: TankSizeCm;
}

/**
 * Three-light rig matching the design brief ("still photograph of a mature
 * planted tank at dusk"):
 *  - Ambient: ink-800 wash, very low intensity.
 *  - Key: a wide directional fixture overhead, bone-tinted warm white to read
 *    against the moss greens.
 *  - Fill: moss-200 bounce from the front to lift shadows without washing colour.
 *
 * No shadow maps in phase 1 — they spike draw calls and a dusk render reads
 * fine with just contact darkening in the shaders.
 */
export function Lighting({ sizeCm }: LightingProps) {
  const [, , h] = sizeCm;
  const ambient = useMemo(() => new THREE.Color(palette.ink[800]), []);
  const key = useMemo(() => new THREE.Color(palette.bone[100]), []);
  const fill = useMemo(() => new THREE.Color(palette.moss[200]), []);

  return (
    <>
      <ambientLight color={ambient} intensity={0.35} />
      <directionalLight
        color={key}
        intensity={0.9}
        position={[0, h * 1.6, 0]}
      />
      <directionalLight
        color={fill}
        intensity={0.35}
        position={[0, h * 0.6, h * 2.0]}
      />
    </>
  );
}
