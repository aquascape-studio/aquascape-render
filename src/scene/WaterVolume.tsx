import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { WATER_BASE, WATER_DEEP } from "../palette.js";
import type { TankSizeCm } from "../types.js";

interface WaterVolumeProps {
  sizeCm: TankSizeCm;
  /** Fraction of tank height occupied by water (0..1). */
  fillRatio?: number;
}

/**
 * Single water-surface plane. Custom ShaderMaterial:
 *  - Fresnel between WATER_BASE (viewed face-on) and WATER_DEEP (glancing angle),
 *    inverted so grazing angles read darker — matches how a shaded-aquarium photo
 *    reads from the front.
 *  - Low-frequency noise ripple on normals, NO refraction, NO caustics.
 *
 * Phase 3 will replace this with a proper volumetric shader. For now: 1 draw call.
 */
export function WaterVolume({ sizeCm, fillRatio = 0.95 }: WaterVolumeProps) {
  const [w, d, h] = sizeCm;
  const surfaceY = h * fillRatio;
  const matRef = useRef<THREE.ShaderMaterial | null>(null);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uColorShallow: { value: new THREE.Color(WATER_BASE) },
        uColorDeep: { value: new THREE.Color(WATER_DEEP) },
        uOpacity: { value: 0.55 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying vec2 vUv;
        uniform float uTime;
        uniform vec3 uColorShallow;
        uniform vec3 uColorDeep;
        uniform float uOpacity;

        // Hash + value-noise — small, dependency-free, WebGL1-safe.
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }

        void main() {
          // Low-freq ripple; centimetre-scale so it reads from orbit distance.
          vec2 rp = vWorldPos.xz * 0.08;
          float n = noise(rp + uTime * 0.15) * 0.55
                  + noise(rp * 2.1 - uTime * 0.07) * 0.45;

          // Fresnel: viewer-facing surfaces show shallow color, grazing shows deep.
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float f = pow(1.0 - clamp(dot(vNormal, viewDir), 0.0, 1.0), 2.3);

          vec3 col = mix(uColorShallow, uColorDeep, f * 0.85);
          // Ripple modulates brightness slightly — still low saturation, no neon.
          col *= 0.88 + n * 0.18;

          gl_FragColor = vec4(col, uOpacity);
        }
      `,
    });
  }, []);

  useFrame((_state, delta) => {
    const uTime = matRef.current?.uniforms["uTime"];
    if (uTime) {
      uTime.value += delta;
    }
  });

  return (
    <mesh
      position={[0, surfaceY, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      material={material}
      ref={(m) => {
        if (m) matRef.current = m.material as THREE.ShaderMaterial;
      }}
    >
      <planeGeometry args={[w * 0.98, d * 0.98, 1, 1]} />
    </mesh>
  );
}
