import { Geometry, GlProgram, GpuProgram, Mesh, Shader, UniformGroup } from 'pixi.js';
import { createRng } from '../game/galaxyGen';
import type { StarType } from '../game/types';
import { viewSpaceDirectionWithBasis, type Point3D, type ProjectionBasis } from './projection';

export const SUN_PHOTOSPHERE_FRACTION = 0.7;
const SUN_EXTENT = 5;
const GRANULE_FREQUENCY = 42;
const SUN_SPIN = 0.012;

type SunLook = {
  photosphere: [number, number, number];
  chromosphere: [number, number, number];
  granulation: number;
  spots: number;
  prominences: number;
  limbDarkening: number;
};

const SUN_LOOKS: Partial<Record<StarType, SunLook>> = {
  A: { photosphere: [0.78, 0.86, 1], chromosphere: [0.75, 0.82, 1], granulation: 0.35, spots: 0, prominences: 0.25, limbDarkening: 0.55 },
  F: { photosphere: [1, 0.95, 0.86], chromosphere: [1, 0.55, 0.55], granulation: 0.8, spots: 0.35, prominences: 0.7, limbDarkening: 0.8 },
  G: { photosphere: [1, 0.88, 0.68], chromosphere: [1, 0.36, 0.38], granulation: 1, spots: 0.75, prominences: 1, limbDarkening: 1 },
  K: { photosphere: [1, 0.74, 0.48], chromosphere: [1, 0.32, 0.3], granulation: 1, spots: 0.9, prominences: 1, limbDarkening: 1.05 },
  M: { photosphere: [1, 0.56, 0.34], chromosphere: [1, 0.28, 0.24], granulation: 1, spots: 1, prominences: 1.2, limbDarkening: 1.1 },
};

export function sunGlowColor(starType: StarType): number {
  const [red, green, blue] = (SUN_LOOKS[starType] ?? SUN_LOOKS.G!).photosphere;
  return (Math.round(red * 255) << 16) | (Math.round(green * 255) << 8) | Math.round(blue * 255);
}

export type SunBody = {
  mesh: Mesh<Geometry, Shader>;
  update: (elapsed: number, basis: ProjectionBasis) => void;
  destroy: () => void;
};

const glVertex = `
in vec2 aPosition;
out vec2 vDisc;
out float vEdge;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec2 uResolution;

void main(void) {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vDisc = aPosition;
  vec2 axis = (mvp * vec3(1.0, 0.0, 0.0)).xy * uResolution * 0.5;
  vEdge = 1.5 / max(length(axis), 1.0);
}`;

const glFragment = `
in vec2 vDisc;
in float vEdge;
out vec4 finalColor;

uniform vec4 uAxisX;
uniform vec4 uAxisY;
uniform vec4 uAxisZ;
uniform vec4 uTint;
uniform vec4 uChromo;
uniform vec4 uLook;
uniform vec4 uSeed;
uniform float uTime;
uniform vec4 uColor;
uniform vec4 uWorldColorAlpha;

vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float valueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z);
}

float fbm(vec3 p) {
  float sum = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 4; octave++) {
    sum += valueNoise(p) * amplitude;
    p = p * 2.03 + 17.1;
    amplitude *= 0.5;
  }
  return sum / 0.9375;
}

float granules(vec3 p, float time) {
  vec3 cell = floor(p);
  vec3 inCell = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      for (int z = -1; z <= 1; z++) {
        vec3 offset = vec3(float(x), float(y), float(z));
        vec3 jitter = hash33(cell + offset);
        vec3 delta = offset + 0.5 + 0.38 * sin(time + 6.2831 * jitter) - inCell;
        float dist = dot(delta, delta);
        if (dist < f1) {
          f2 = f1;
          f1 = dist;
        } else if (dist < f2) {
          f2 = dist;
        }
      }
    }
  }
  return smoothstep(0.0, 0.3, sqrt(f2) - sqrt(f1)) * (1.0 - 0.5 * sqrt(f1));
}

void main(void) {
  float radius = length(vDisc);
  float coverage = clamp((1.0 - radius) / vEdge + 0.5, 0.0, 1.0);
  vec3 tint = uTint.rgb;

  vec3 surface = vec3(0.0);
  if (coverage > 0.0) {
    vec2 disc = vDisc / max(radius, 1.0);
    float mu = sqrt(max(0.0, 1.0 - dot(disc, disc)));
    vec3 normal = vec3(disc, mu);
    vec3 star = vec3(dot(normal, uAxisX.xyz), dot(normal, uAxisY.xyz), dot(normal, uAxisZ.xyz));
    float spin = uTime * uLook.w;
    float c = cos(spin);
    float s = sin(spin);
    star = vec3(c * star.x + s * star.z, star.y, c * star.z - s * star.x);

    float granulePx = 1.5 / (vEdge * ${GRANULE_FREQUENCY.toFixed(1)});
    float detail = smoothstep(1.5, 5.0, granulePx);
    float granule = granules(star * ${GRANULE_FREQUENCY.toFixed(1)} + uSeed.xyz, uTime * 0.35);
    float mottle = fbm(star * 7.0 + uSeed.yzx);
    float spotField = valueNoise(star * 5.0 + uSeed.zxy) * 0.6 + valueNoise(star * 16.0 + uSeed.xzy) * 0.4;
    float latitude = abs(star.y);
    float band = smoothstep(0.06, 0.2, latitude) * (1.0 - smoothstep(0.42, 0.6, latitude)) * uLook.y;
    float penumbra = smoothstep(0.66, 0.7, spotField) * band;
    float umbra = smoothstep(0.71, 0.74, spotField) * band;
    float facula = smoothstep(0.56, 0.66, spotField) * band * (1.0 - penumbra);

    float brightness = 1.0 + (granule - 0.4) * 0.16 * uLook.x * detail * sqrt(mu) + (mottle - 0.5) * 0.12;
    brightness *= 1.0 - penumbra * 0.3 - umbra * 0.35;
    brightness += facula * pow(1.0 - mu, 1.5) * 0.45;
    float edge = (1.0 - mu) * uTint.a;
    vec3 limb = vec3(1.0) - vec3(0.4, 0.52, 0.66) * edge - vec3(0.1, 0.12, 0.14) * edge * edge;
    surface = vec3(1.0) - exp(-tint * brightness * limb * 4.2) + tint * 0.16 * pow(1.0 - mu, 3.0);
  }

  float height = max(radius - 1.0, 0.0);
  vec2 outward = vDisc / max(radius, 0.0001);
  float spicule = valueNoise(vec3(outward * 60.0, uTime * 0.4) + uSeed.xyz);
  float chromosphere = exp(-height / (0.01 + 0.014 * spicule));
  float prominence = smoothstep(0.6, 0.8, fbm(vec3(outward * 5.0, height * 5.0 - uTime * 0.02) + uSeed.yzx)) * exp(-height / 0.07) * uLook.z;
  float streamer = valueNoise(vec3(outward * 2.2, 0.5) + uSeed.zxy);
  float rays = valueNoise(vec3(outward * 16.0, height * 0.8 - uTime * 0.015) + uSeed.xzy);
  float structure = 0.35 + 1.2 * streamer * streamer + 0.35 * rays;
  float corona = 0.22 * pow(max(radius, 1.0), -8.0) + 0.07 * pow(max(radius, 1.0), -3.0) * structure;
  float glow = 0.3 * exp(-height * 6.0) + 0.12 * exp(-height * 1.4);
  vec3 coronaColor = mix(tint, vec3(1.0), 0.55);
  float fade = 1.0 - smoothstep(${(SUN_EXTENT * 0.6).toFixed(2)}, ${SUN_EXTENT.toFixed(2)}, radius);
  vec3 outside = ((uChromo.rgb * (chromosphere * 0.4 + prominence * 0.6) + coronaColor * corona) * uChromo.a + tint * glow) * fade;

  vec4 color = vec4(surface * coverage + outside * (1.0 - coverage), coverage);
  finalColor = color * uColor.a * uWorldColorAlpha.a;
}`;

const wgslSource = `
struct GlobalUniforms {
  uProjectionMatrix: mat3x3<f32>,
  uWorldTransformMatrix: mat3x3<f32>,
  uWorldColorAlpha: vec4<f32>,
  uResolution: vec2<f32>,
};

struct LocalUniforms {
  uTransformMatrix: mat3x3<f32>,
  uColor: vec4<f32>,
  uRound: f32,
};

struct SunUniforms {
  uAxisX: vec4<f32>,
  uAxisY: vec4<f32>,
  uAxisZ: vec4<f32>,
  uTint: vec4<f32>,
  uChromo: vec4<f32>,
  uLook: vec4<f32>,
  uSeed: vec4<f32>,
  uTime: f32,
};

@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;
@group(2) @binding(0) var<uniform> sunUniforms: SunUniforms;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) disc: vec2<f32>,
  @location(1) edge: f32,
};

fn hash33(q: vec3<f32>) -> vec3<f32> {
  var p = fract(q * vec3<f32>(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

fn hash13(q: vec3<f32>) -> f32 {
  var p = fract(q * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

fn valueNoise(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let n000 = hash13(i);
  let n100 = hash13(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = hash13(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = hash13(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = hash13(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = hash13(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = hash13(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = hash13(i + vec3<f32>(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z);
}

fn fbm(start: vec3<f32>) -> f32 {
  var p = start;
  var sum = 0.0;
  var amplitude = 0.5;
  for (var octave = 0; octave < 4; octave++) {
    sum += valueNoise(p) * amplitude;
    p = p * 2.03 + 17.1;
    amplitude *= 0.5;
  }
  return sum / 0.9375;
}

fn granules(p: vec3<f32>, time: f32) -> f32 {
  let cell = floor(p);
  let inCell = fract(p);
  var f1 = 8.0;
  var f2 = 8.0;
  for (var x = -1; x <= 1; x++) {
    for (var y = -1; y <= 1; y++) {
      for (var z = -1; z <= 1; z++) {
        let offset = vec3<f32>(f32(x), f32(y), f32(z));
        let jitter = hash33(cell + offset);
        let delta = offset + 0.5 + 0.38 * sin(time + 6.2831 * jitter) - inCell;
        let dist = dot(delta, delta);
        if (dist < f1) {
          f2 = f1;
          f1 = dist;
        } else if (dist < f2) {
          f2 = dist;
        }
      }
    }
  }
  return smoothstep(0.0, 0.3, sqrt(f2) - sqrt(f1)) * (1.0 - 0.5 * sqrt(f1));
}

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  let clip = mvp * vec3<f32>(aPosition, 1.0);
  let axis = (mvp * vec3<f32>(1.0, 0.0, 0.0)).xy * globalUniforms.uResolution * 0.5;
  return VSOutput(vec4<f32>(clip.xy, 0.0, 1.0), aPosition, 1.5 / max(length(axis), 1.0));
}

@fragment
fn mainFragment(@location(0) vDisc: vec2<f32>, @location(1) vEdge: f32) -> @location(0) vec4<f32> {
  let look = sunUniforms.uLook;
  let seed = sunUniforms.uSeed;
  let time = sunUniforms.uTime;
  let tint = sunUniforms.uTint.rgb;
  let chromo = sunUniforms.uChromo;
  let radius = length(vDisc);
  let coverage = clamp((1.0 - radius) / vEdge + 0.5, 0.0, 1.0);

  var surface = vec3<f32>(0.0);
  if (coverage > 0.0) {
    let disc = vDisc / max(radius, 1.0);
    let mu = sqrt(max(0.0, 1.0 - dot(disc, disc)));
    let normal = vec3<f32>(disc, mu);
    let tilted = vec3<f32>(dot(normal, sunUniforms.uAxisX.xyz), dot(normal, sunUniforms.uAxisY.xyz), dot(normal, sunUniforms.uAxisZ.xyz));
    let spin = time * look.w;
    let c = cos(spin);
    let s = sin(spin);
    let star = vec3<f32>(c * tilted.x + s * tilted.z, tilted.y, c * tilted.z - s * tilted.x);

    let granulePx = 1.5 / (vEdge * ${GRANULE_FREQUENCY.toFixed(1)});
    let detail = smoothstep(1.5, 5.0, granulePx);
    let granule = granules(star * ${GRANULE_FREQUENCY.toFixed(1)} + seed.xyz, time * 0.35);
    let mottle = fbm(star * 7.0 + seed.yzx);
    let spotField = valueNoise(star * 5.0 + seed.zxy) * 0.6 + valueNoise(star * 16.0 + seed.xzy) * 0.4;
    let latitude = abs(star.y);
    let band = smoothstep(0.06, 0.2, latitude) * (1.0 - smoothstep(0.42, 0.6, latitude)) * look.y;
    let penumbra = smoothstep(0.66, 0.7, spotField) * band;
    let umbra = smoothstep(0.71, 0.74, spotField) * band;
    let facula = smoothstep(0.56, 0.66, spotField) * band * (1.0 - penumbra);

    var brightness = 1.0 + (granule - 0.4) * 0.16 * look.x * detail * sqrt(mu) + (mottle - 0.5) * 0.12;
    brightness *= 1.0 - penumbra * 0.3 - umbra * 0.35;
    brightness += facula * pow(1.0 - mu, 1.5) * 0.45;
    let edge = (1.0 - mu) * sunUniforms.uTint.a;
    let limb = vec3<f32>(1.0) - vec3<f32>(0.4, 0.52, 0.66) * edge - vec3<f32>(0.1, 0.12, 0.14) * edge * edge;
    surface = vec3<f32>(1.0) - exp(-tint * brightness * limb * 4.2) + tint * 0.16 * pow(1.0 - mu, 3.0);
  }

  let height = max(radius - 1.0, 0.0);
  let outward = vDisc / max(radius, 0.0001);
  let spicule = valueNoise(vec3<f32>(outward * 60.0, time * 0.4) + seed.xyz);
  let chromosphere = exp(-height / (0.01 + 0.014 * spicule));
  let prominence = smoothstep(0.6, 0.8, fbm(vec3<f32>(outward * 5.0, height * 5.0 - time * 0.02) + seed.yzx)) * exp(-height / 0.07) * look.z;
  let streamer = valueNoise(vec3<f32>(outward * 2.2, 0.5) + seed.zxy);
  let rays = valueNoise(vec3<f32>(outward * 16.0, height * 0.8 - time * 0.015) + seed.xzy);
  let structure = 0.35 + 1.2 * streamer * streamer + 0.35 * rays;
  let corona = 0.22 * pow(max(radius, 1.0), -8.0) + 0.07 * pow(max(radius, 1.0), -3.0) * structure;
  let glow = 0.3 * exp(-height * 6.0) + 0.12 * exp(-height * 1.4);
  let coronaColor = mix(tint, vec3<f32>(1.0), 0.55);
  let fade = 1.0 - smoothstep(${(SUN_EXTENT * 0.6).toFixed(2)}, ${SUN_EXTENT.toFixed(2)}, radius);
  let outside = ((chromo.rgb * (chromosphere * 0.4 + prominence * 0.6) + coronaColor * corona) * chromo.a + tint * glow) * fade;

  let result = vec4<f32>(surface * coverage + outside * (1.0 - coverage), coverage);
  return result * localUniforms.uColor.a * globalUniforms.uWorldColorAlpha.a;
}`;

let glProgram: GlProgram | null = null;
let gpuProgram: GpuProgram | null = null;

function programs() {
  glProgram ??= GlProgram.from({ vertex: glVertex, fragment: glFragment, name: 'sun-body' });
  gpuProgram ??= GpuProgram.from({
    vertex: { source: wgslSource, entryPoint: 'mainVertex' },
    fragment: { source: wgslSource, entryPoint: 'mainFragment' },
  });
  return { glProgram, gpuProgram };
}

function writeAxis(target: Float32Array, direction: Point3D) {
  target[0] = direction.x;
  target[1] = direction.y;
  target[2] = direction.z;
}

export function createSunBody(starType: StarType, seed: number, radius: number, coronaStrength: number): SunBody {
  const look = SUN_LOOKS[starType] ?? SUN_LOOKS.G!;
  const rng = createRng(seed ^ 0x2f6b9d13);
  const axisX = new Float32Array(4);
  const axisY = new Float32Array(4);
  const axisZ = new Float32Array(4);
  const sunUniforms = new UniformGroup({
    uAxisX: { value: axisX, type: 'vec4<f32>' },
    uAxisY: { value: axisY, type: 'vec4<f32>' },
    uAxisZ: { value: axisZ, type: 'vec4<f32>' },
    uTint: { value: new Float32Array([...look.photosphere, look.limbDarkening]), type: 'vec4<f32>' },
    uChromo: { value: new Float32Array([...look.chromosphere, coronaStrength]), type: 'vec4<f32>' },
    uLook: { value: new Float32Array([look.granulation, look.spots, look.prominences, SUN_SPIN]), type: 'vec4<f32>' },
    uSeed: { value: new Float32Array([rng() * 97, rng() * 97, rng() * 97, 0]), type: 'vec4<f32>' },
    uTime: { value: 0, type: 'f32' },
  });
  const extent = SUN_EXTENT;
  const geometry = new Geometry({
    attributes: { aPosition: new Float32Array([-extent, -extent, extent, -extent, extent, extent, -extent, extent]) },
    indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });
  const shader = new Shader({ ...programs(), resources: { sunUniforms } });
  const mesh = new Mesh({ geometry, shader });
  mesh.scale.set(radius * SUN_PHOTOSPHERE_FRACTION);
  mesh.eventMode = 'none';
  const scratch: Point3D = { x: 0, y: 0, z: 0 };

  function axis(x: number, y: number, z: number, target: Float32Array, basis: ProjectionBasis) {
    scratch.x = x;
    scratch.y = y;
    scratch.z = z;
    writeAxis(target, viewSpaceDirectionWithBasis(scratch, basis, scratch));
  }

  return {
    mesh,
    update(elapsed, basis) {
      axis(1, 0, 0, axisX, basis);
      axis(0, -1, 0, axisY, basis);
      axis(0, 0, 1, axisZ, basis);
      sunUniforms.uniforms.uTime = elapsed;
      sunUniforms.update();
    },
    destroy() {
      shader.destroy();
      geometry.destroy();
    },
  };
}
