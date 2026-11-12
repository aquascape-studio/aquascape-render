/**
 * Leaf material: MeshStandardMaterial (no `transmission` — that forces an
 * extra opaque-scene pass) plus an onBeforeCompile patch that adds
 *   • fake back-light translucency (light from behind passing through the
 *     leaf towards the viewer) + soft wrap/rim term,
 *   • GPU idle sway driven by a shared `uTime` uniform (no CPU work).
 */
import * as THREE from "three";

export interface SharedUniforms {
  uTime: { value: number };
  uSway: { value: number };
  /** world-space direction *towards* the back light */
  uBackDir: { value: THREE.Vector3 };
  uTransl: { value: number };
}

export function makeSharedUniforms(): SharedUniforms {
  return {
    uTime: { value: 0 },
    uSway: { value: 1 },
    uBackDir: { value: new THREE.Vector3(0.15, 0.55, -1).normalize() },
    uTransl: { value: 0.55 },
  };
}

const SWAY_VERTEX = /* glsl */ `
#include <project_vertex>
{
  vec4 swWorld = modelMatrix * vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    swWorld = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  #endif
  float hgt = clamp(swWorld.y / 30.0, 0.0, 1.4);
  float tip = 0.6 + 0.4 * clamp(position.z, 0.0, 1.0);
  float ph = swWorld.x * 0.13 + swWorld.z * 0.07;
  vec3 sw = vec3(
    sin(uTime * 0.85 + ph) + 0.35 * sin(uTime * 1.9 + ph * 2.3),
    0.0,
    0.4 * cos(uTime * 0.7 + ph * 1.3)
  ) * (0.32 * hgt * hgt * tip * uSway);
  mvPosition.xyz += (viewMatrix * vec4(sw, 0.0)).xyz;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const TRANSLUCENCY_FRAGMENT = /* glsl */ `
#include <lights_fragment_end>
{
  vec3 Lb = normalize((viewMatrix * vec4(uBackDir, 0.0)).xyz);
  vec3 Nn = normalize(normal);
  // light arriving on the far side of the leaf and exiting towards the eye
  float back = clamp(dot(-Nn, Lb), 0.0, 1.0);
  float through = pow(clamp(dot(geometryViewDir, -Lb), 0.0, 1.0), 2.0);
  float wrap = clamp((dot(Nn, Lb) + 0.6) / 1.6, 0.0, 1.0);
  float rim = pow(1.0 - clamp(dot(Nn, geometryViewDir), 0.0, 1.0), 2.5);
  vec3 tint = diffuseColor.rgb * vec3(1.05, 1.18, 0.72);
  reflectedLight.indirectDiffuse += tint * uTransl * (0.55 * back + 0.35 * through * wrap + 0.3 * rim);
}
`;

export function patchFoliage(material: THREE.Material, u: SharedUniforms, translucent: boolean): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = u.uTime;
    shader.uniforms.uSway = u.uSway;
    shader.uniforms.uBackDir = u.uBackDir;
    shader.uniforms.uTransl = u.uTransl;
    shader.vertexShader =
      "uniform float uTime;\nuniform float uSway;\n" +
      shader.vertexShader.replace("#include <project_vertex>", SWAY_VERTEX);
    if (translucent) {
      shader.fragmentShader =
        "uniform vec3 uBackDir;\nuniform float uTransl;\n" +
        shader.fragmentShader.replace("#include <lights_fragment_end>", TRANSLUCENCY_FRAGMENT);
    }
  };
  material.customProgramCacheKey = () => (translucent ? "aq-foliage-t" : "aq-foliage");
}

export function makeFoliageMaterial(u: SharedUniforms, kind: "leaf" | "moss" | "stem"): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: kind === "moss" ? 0.85 : 0.5,
    metalness: 0,
    envMapIntensity: kind === "moss" ? 0.6 : 0.9,
  });
  patchFoliage(m, u, kind !== "stem");
  return m;
}
