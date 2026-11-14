import { Tank } from "./Tank.js";
import { PlantSimple, type PlantSimpleProps } from "./PlantSimple.js";

/** A single plant descriptor passed to PlantedTank. */
export interface PlantEntry {
  /** World-space position in metres (x, y, z). Y is typically substrate surface. */
  position: [number, number, number];
  /** Plant height in metres. */
  height?: number;
  /** Leaf colour (CSS hex string or Three.js hex int). */
  color?: PlantSimpleProps["color"];
}

export interface PlantedTankProps {
  /** Tank interior width  (X axis) in metres. */
  width: number;
  /** Tank interior height (Y axis) in metres. */
  height: number;
  /** Tank interior depth  (Z axis) in metres. */
  depth: number;
  /** Plants to place inside the tank. Each entry maps 1-to-1 to a PlantSimple. */
  plants?: PlantEntry[];
}

/**
 * PlantedTank — composes a glass Tank with an array of PlantSimple instances.
 *
 * Coordinate system: 1 world unit = 1 metre, Y axis up.
 * The substrate top sits at Y ≈ 0.03 m; pass that as the Y component of each
 * plant's position so stems emerge from the gravel surface.
 *
 * Draw-call budget: 6 Tank meshes + 2 meshes per plant.
 */
export function PlantedTank({ width, height, depth, plants = [] }: PlantedTankProps) {
  return (
    <group>
      <Tank width={width} height={height} depth={depth} />
      {plants.map((plant, i) => (
        <PlantSimple
          key={i}
          position={plant.position}
          height={plant.height}
          color={plant.color}
        />
      ))}
    </group>
  );
}
