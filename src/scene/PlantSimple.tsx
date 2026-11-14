import { useMemo } from "react";
import * as THREE from "three";
import { LEAF_BASE, STEM_COLOR } from "../palette.js";

export interface PlantSimpleProps {
  /** World-space position in metres (x, y, z). Y=0 is the tank floor. */
  position: [number, number, number];
  /** Total plant height in metres. Defaults to 0.12 m (12 cm). */
  height?: number | undefined;
  /** Leaf / sphere cluster colour as a CSS hex string or Three.js hex number. */
  color?: string | number | undefined;
}

/**
 * PlantSimple — minimal placeholder stem plant.
 *
 * Renders two meshes:
 *  - A `CylinderGeometry` stem (thin, vertical).
 *  - A `SphereGeometry` leaf-cluster at the top.
 *
 * Coordinate system: 1 world unit = 1 metre, Y axis up, matching Tank.tsx.
 * Place at Y = substrate surface (typically 0.03 m above tank floor, but
 * callers using PlantedTank pass absolute Y so they control placement).
 */
export function PlantSimple({ position, height = 0.12, color }: PlantSimpleProps) {
  const stemColor = useMemo(
    () => new THREE.Color(STEM_COLOR),
    [],
  );

  const leafColor = useMemo(
    () => (color !== undefined ? new THREE.Color(color) : new THREE.Color(LEAF_BASE)),
    [color],
  );

  const stemRadius = height * 0.035;
  const clusterRadius = height * 0.18;
  const stemHeight = height * 0.75;
  // Leaf cluster sits so its bottom tangent meets the top of the stem.
  const clusterY = stemHeight + clusterRadius * 0.8;

  const stemMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: stemColor,
        roughness: 0.6,
        metalness: 0.0,
      }),
    [stemColor],
  );

  const leafMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: leafColor,
        roughness: 0.55,
        metalness: 0.0,
      }),
    [leafColor],
  );

  return (
    <group position={position}>
      {/* Stem */}
      <mesh position={[0, stemHeight / 2, 0]} material={stemMat} castShadow={false}>
        <cylinderGeometry args={[stemRadius, stemRadius * 1.2, stemHeight, 6]} />
      </mesh>

      {/* Leaf cluster */}
      <mesh position={[0, clusterY, 0]} material={leafMat} castShadow={false}>
        <sphereGeometry args={[clusterRadius, 8, 6]} />
      </mesh>
    </group>
  );
}
