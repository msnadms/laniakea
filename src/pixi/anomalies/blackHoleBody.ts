import { Geometry, GlProgram, GpuProgram, Mesh, Point, Shader, Texture, UniformGroup } from 'pixi.js';
import { SKY_TWINKLE_DEPTH, SKY_TWINKLE_SPEED } from '../../game/constants';
import { viewSpaceDirectionWithBasis, type Point3D, type ProjectionBasis } from '../projection';
import type { SkyLens } from '../sky';

export const BLACK_HOLE_EXTENT = 8.5;
const RAY_START = 12;
const RAY_STEPS = 240;
const PROFILE_PEAK = 0.4879;
const LENS_DISTANCE = 10;
const E = BLACK_HOLE_EXTENT;

export type BlackHoleLook = {
  innerRadius: number;
  outerRadius: number;
  peakTemperature: number;
  opacity: number;
  spin: number;
  flowCycle: number;
  exposure: number;
};

export type BlackHoleAxes = { x: Point3D; normal: Point3D; z: Point3D };

export type BlackHoleBody = {
  mesh: Mesh<Geometry, Shader>;
  update: (elapsed: number, exposure: number, basis: ProjectionBasis, sky: SkyLens | null) => void;
  destroy: () => void;
};

const glVertex = `
in vec2 aPosition;
out vec2 vDisc;
out float vPixels;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec2 uResolution;

void main(void) {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vDisc = aPosition;
  vec2 axis = (mvp * vec3(1.0, 0.0, 0.0)).xy * uResolution * 0.5;
  vPixels = max(length(axis), 0.001);
}`;

const glFragment = `
in vec2 vDisc;
in float vPixels;
out vec4 finalColor;

uniform vec4 uAxisX;
uniform vec4 uAxisN;
uniform vec4 uAxisZ;
uniform vec4 uDisk;
uniform vec4 uFlow;
uniform vec4 uSeed;
uniform vec4 uSky;
uniform vec4 uLens;
uniform float uTime;
uniform sampler2D uNebula;
uniform sampler2D uStars;
uniform vec4 uColor;
uniform vec4 uWorldColorAlpha;

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
  for (int octave = 0; octave < 3; octave++) {
    sum += valueNoise(p) * amplitude;
    p = p * 2.07 + 17.1;
    amplitude *= 0.5;
  }
  return sum / 0.875;
}

vec3 planck(float temperature) {
  vec3 lambda = vec3(0.63, 0.532, 0.465);
  vec3 l5 = lambda * lambda * lambda * lambda * lambda;
  vec3 radiance = 1.0 / (l5 * (exp(14.388 / (lambda * temperature)) - 1.0));
  return radiance / max(max(radiance.r, radiance.g), radiance.b);
}

vec3 skyAt(vec2 uv) {
  vec4 star = texture(uStars, uv);
  float speed = uLens.z * (0.5 + fract(star.a * 7.13));
  float dim = uLens.w * (0.5 + 0.5 * sin(uLens.y * speed + star.a * 6.2832));
  return texture(uNebula, uv).rgb + star.rgb * (1.0 - dim);
}

float flowLayer(float phi, float logR, float omega, float time, vec3 seed, float detail) {
  float angle = phi - omega * time;
  vec2 ring = vec2(cos(angle), sin(angle));
  float body = fbm(vec3(ring * 2.2, logR * 6.0) + seed);
  float lanes = valueNoise(vec3(ring * 7.0, logR * 34.0) + seed.zxy);
  return body + (lanes - 0.5) * 0.5 * detail;
}

vec4 diskLight(vec3 hit, vec3 velocity) {
  float r = length(hit.xz);
  float x = r / uDisk.x;
  float profile = pow(x, -0.75) * pow(max(1.0 - inversesqrt(x), 0.0), 0.25) / ${PROFILE_PEAK.toFixed(4)};
  float beta = min(sqrt(0.5 / max(r - 1.0, 0.05)), 0.95);
  vec3 orbit = normalize(vec3(-hit.z, 0.0, hit.x));
  vec3 toward = -normalize(velocity);
  float doppler = sqrt(1.0 - beta * beta) / (1.0 - beta * dot(orbit, toward));
  float shift = doppler * sqrt(max(1.0 - 1.0 / r, 0.0));
  float temperature = uDisk.z * profile * shift;

  float omega = uFlow.x * pow(x, -1.5);
  float phase = fract(uTime / uFlow.y);
  float phi = atan(hit.z, hit.x);
  float logR = log(r);
  float detail = smoothstep(1.5, 4.0, r * vPixels / 34.0);
  float early = flowLayer(phi, logR, omega, phase * uFlow.y, uSeed.xyz, detail);
  float late = flowLayer(phi, logR, omega, fract(phase + 0.5) * uFlow.y, uSeed.yzx + 11.0, detail);
  float density = mix(late, early, 1.0 - abs(2.0 * phase - 1.0));
  density = clamp(0.35 + (density - 0.5) * 1.9, 0.04, 1.0);

  float edges = smoothstep(uDisk.x * 0.85, uDisk.x * 1.1, r) * (1.0 - smoothstep(uDisk.y * 0.55, uDisk.y, r));
  float alpha = uDisk.w * edges * mix(0.3, 1.0, density);
  float ratio = temperature / uDisk.z;
  float luminosity = ratio * ratio * ratio * ratio;
  vec3 light = planck(max(temperature, 0.8)) * luminosity * (0.3 + density) * edges;
  return vec4(light, alpha);
}

void main(void) {
  float impact = length(vDisc);
  float start = sqrt(max(${RAY_START.toFixed(1)} * ${RAY_START.toFixed(1)} - impact * impact, 0.0));
  vec3 origin = vec3(vDisc, start);
  vec3 pos = vec3(dot(origin, uAxisX.xyz), dot(origin, uAxisN.xyz), dot(origin, uAxisZ.xyz));
  vec3 vel = -vec3(uAxisX.z, uAxisN.z, uAxisZ.z);
  vec3 momentum = cross(pos, vel);
  float h2 = dot(momentum, momentum);

  vec3 light = vec3(0.0);
  float transmit = 1.0;
  float escaped = 0.0;
  for (int i = 0; i < ${RAY_STEPS}; i++) {
    float r2 = dot(pos, pos);
    float r = sqrt(r2);
    if (r < 1.0 || transmit < 0.02) break;
    if (r > ${(RAY_START + 0.5).toFixed(1)} && dot(pos, vel) > 0.0) {
      escaped = 1.0;
      break;
    }
    float dt = 0.07 * r + 0.015;
    vel -= 1.5 * h2 * pos / (r2 * r2 * r) * dt;
    vec3 next = pos + vel * dt;
    if (pos.y * next.y < 0.0) {
      vec3 hit = mix(pos, next, pos.y / (pos.y - next.y));
      float hitRadius = length(hit.xz);
      if (hitRadius > uDisk.x * 0.85 && hitRadius < uDisk.y) {
        vec4 disk = diskLight(hit, vel);
        light += transmit * disk.rgb * disk.a;
        transmit *= 1.0 - disk.a;
      }
    }
    pos = next;
  }

  vec3 exitView = pos.x * uAxisX.xyz + pos.y * uAxisN.xyz + pos.z * uAxisZ.xyz;
  vec3 heading = normalize(vel.x * uAxisX.xyz + vel.y * uAxisN.xyz + vel.z * uAxisZ.xyz);
  vec2 source = exitView.xy + heading.xy * (${LENS_DISTANCE.toFixed(1)} + exitView.z) / max(-heading.z, 0.2);
  float bend = 1.0 - smoothstep(${(E * 0.5).toFixed(3)}, ${(E * 0.95).toFixed(3)}, impact);
  vec2 uv = clamp(uSky.xy + mix(vDisc, source, bend) * uSky.zw, 0.0, 1.0);
  vec3 sky = skyAt(uv);
  float skyAlpha = escaped * uLens.x * (1.0 - smoothstep(${(E * 0.65).toFixed(3)}, ${(E * 0.97).toFixed(3)}, impact));

  vec3 color = 1.0 - exp(-light * uFlow.z) + transmit * skyAlpha * sky;
  float alpha = escaped > 0.5 ? 1.0 - transmit + transmit * skyAlpha : 1.0;
  finalColor = vec4(color, alpha) * uColor.a * uWorldColorAlpha.a;
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

struct BlackHoleUniforms {
  uAxisX: vec4<f32>,
  uAxisN: vec4<f32>,
  uAxisZ: vec4<f32>,
  uDisk: vec4<f32>,
  uFlow: vec4<f32>,
  uSeed: vec4<f32>,
  uSky: vec4<f32>,
  uLens: vec4<f32>,
  uTime: f32,
};

@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;
@group(2) @binding(0) var<uniform> holeUniforms: BlackHoleUniforms;
@group(2) @binding(1) var uNebula: texture_2d<f32>;
@group(2) @binding(2) var uNebulaSampler: sampler;
@group(2) @binding(3) var uStars: texture_2d<f32>;
@group(2) @binding(4) var uStarsSampler: sampler;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) disc: vec2<f32>,
  @location(1) pixels: f32,
};

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
  for (var octave = 0; octave < 3; octave++) {
    sum += valueNoise(p) * amplitude;
    p = p * 2.07 + 17.1;
    amplitude *= 0.5;
  }
  return sum / 0.875;
}

fn planck(temperature: f32) -> vec3<f32> {
  let lambda = vec3<f32>(0.63, 0.532, 0.465);
  let l5 = lambda * lambda * lambda * lambda * lambda;
  let radiance = 1.0 / (l5 * (exp(14.388 / (lambda * temperature)) - 1.0));
  return radiance / max(max(radiance.r, radiance.g), radiance.b);
}

fn skyAt(uv: vec2<f32>) -> vec3<f32> {
  let lens = holeUniforms.uLens;
  let star = textureSampleLevel(uStars, uStarsSampler, uv, 0.0);
  let speed = lens.z * (0.5 + fract(star.a * 7.13));
  let dim = lens.w * (0.5 + 0.5 * sin(lens.y * speed + star.a * 6.2832));
  return textureSampleLevel(uNebula, uNebulaSampler, uv, 0.0).rgb + star.rgb * (1.0 - dim);
}

fn flowLayer(phi: f32, logR: f32, omega: f32, time: f32, seed: vec3<f32>, detail: f32) -> f32 {
  let angle = phi - omega * time;
  let ring = vec2<f32>(cos(angle), sin(angle));
  let body = fbm(vec3<f32>(ring * 2.2, logR * 6.0) + seed);
  let lanes = valueNoise(vec3<f32>(ring * 7.0, logR * 34.0) + seed.zxy);
  return body + (lanes - 0.5) * 0.5 * detail;
}

fn diskLight(hit: vec3<f32>, velocity: vec3<f32>, pixels: f32) -> vec4<f32> {
  let disk = holeUniforms.uDisk;
  let flow = holeUniforms.uFlow;
  let seed = holeUniforms.uSeed;
  let r = length(hit.xz);
  let x = r / disk.x;
  let profile = pow(x, -0.75) * pow(max(1.0 - inverseSqrt(x), 0.0), 0.25) / ${PROFILE_PEAK.toFixed(4)};
  let beta = min(sqrt(0.5 / max(r - 1.0, 0.05)), 0.95);
  let orbit = normalize(vec3<f32>(-hit.z, 0.0, hit.x));
  let toward = -normalize(velocity);
  let doppler = sqrt(1.0 - beta * beta) / (1.0 - beta * dot(orbit, toward));
  let shift = doppler * sqrt(max(1.0 - 1.0 / r, 0.0));
  let temperature = disk.z * profile * shift;

  let omega = flow.x * pow(x, -1.5);
  let phase = fract(holeUniforms.uTime / flow.y);
  let phi = atan2(hit.z, hit.x);
  let logR = log(r);
  let detail = smoothstep(1.5, 4.0, r * pixels / 34.0);
  let early = flowLayer(phi, logR, omega, phase * flow.y, seed.xyz, detail);
  let late = flowLayer(phi, logR, omega, fract(phase + 0.5) * flow.y, seed.yzx + 11.0, detail);
  var density = mix(late, early, 1.0 - abs(2.0 * phase - 1.0));
  density = clamp(0.35 + (density - 0.5) * 1.9, 0.04, 1.0);

  let edges = smoothstep(disk.x * 0.85, disk.x * 1.1, r) * (1.0 - smoothstep(disk.y * 0.55, disk.y, r));
  let alpha = disk.w * edges * mix(0.3, 1.0, density);
  let ratio = temperature / disk.z;
  let luminosity = ratio * ratio * ratio * ratio;
  let light = planck(max(temperature, 0.8)) * luminosity * (0.3 + density) * edges;
  return vec4<f32>(light, alpha);
}

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  let clip = mvp * vec3<f32>(aPosition, 1.0);
  let axis = (mvp * vec3<f32>(1.0, 0.0, 0.0)).xy * globalUniforms.uResolution * 0.5;
  return VSOutput(vec4<f32>(clip.xy, 0.0, 1.0), aPosition, max(length(axis), 0.001));
}

@fragment
fn mainFragment(@location(0) vDisc: vec2<f32>, @location(1) vPixels: f32) -> @location(0) vec4<f32> {
  let axisX = holeUniforms.uAxisX.xyz;
  let axisN = holeUniforms.uAxisN.xyz;
  let axisZ = holeUniforms.uAxisZ.xyz;
  let impact = length(vDisc);
  let start = sqrt(max(${RAY_START.toFixed(1)} * ${RAY_START.toFixed(1)} - impact * impact, 0.0));
  let origin = vec3<f32>(vDisc, start);
  var pos = vec3<f32>(dot(origin, axisX), dot(origin, axisN), dot(origin, axisZ));
  var vel = -vec3<f32>(axisX.z, axisN.z, axisZ.z);
  let momentum = cross(pos, vel);
  let h2 = dot(momentum, momentum);
  let inner = holeUniforms.uDisk.x;
  let outer = holeUniforms.uDisk.y;

  var light = vec3<f32>(0.0);
  var transmit = 1.0;
  var escaped = 0.0;
  for (var i = 0; i < ${RAY_STEPS}; i++) {
    let r2 = dot(pos, pos);
    let r = sqrt(r2);
    if (r < 1.0 || transmit < 0.02) {
      break;
    }
    if (r > ${(RAY_START + 0.5).toFixed(1)} && dot(pos, vel) > 0.0) {
      escaped = 1.0;
      break;
    }
    let dt = 0.07 * r + 0.015;
    vel -= 1.5 * h2 * pos / (r2 * r2 * r) * dt;
    let next = pos + vel * dt;
    if (pos.y * next.y < 0.0) {
      let hit = mix(pos, next, pos.y / (pos.y - next.y));
      let hitRadius = length(hit.xz);
      if (hitRadius > inner * 0.85 && hitRadius < outer) {
        let disk = diskLight(hit, vel, vPixels);
        light += transmit * disk.rgb * disk.a;
        transmit *= 1.0 - disk.a;
      }
    }
    pos = next;
  }

  let exitView = pos.x * axisX + pos.y * axisN + pos.z * axisZ;
  let heading = normalize(vel.x * axisX + vel.y * axisN + vel.z * axisZ);
  let source = exitView.xy + heading.xy * (${LENS_DISTANCE.toFixed(1)} + exitView.z) / max(-heading.z, 0.2);
  let bend = 1.0 - smoothstep(${(E * 0.5).toFixed(3)}, ${(E * 0.95).toFixed(3)}, impact);
  let uv = clamp(holeUniforms.uSky.xy + mix(vDisc, source, bend) * holeUniforms.uSky.zw, vec2<f32>(0.0), vec2<f32>(1.0));
  let sky = skyAt(uv);
  let skyAlpha = escaped * holeUniforms.uLens.x * (1.0 - smoothstep(${(E * 0.65).toFixed(3)}, ${(E * 0.97).toFixed(3)}, impact));

  let color = 1.0 - exp(-light * holeUniforms.uFlow.z) + transmit * skyAlpha * sky;
  let alpha = select(1.0, 1.0 - transmit + transmit * skyAlpha, escaped > 0.5);
  return vec4<f32>(color, alpha) * localUniforms.uColor.a * globalUniforms.uWorldColorAlpha.a;
}`;

let glProgram: GlProgram | null = null;
let gpuProgram: GpuProgram | null = null;

function programs() {
  glProgram ??= GlProgram.from({ vertex: glVertex, fragment: glFragment, name: 'black-hole-body' });
  gpuProgram ??= GpuProgram.from({
    vertex: { source: wgslSource, entryPoint: 'mainVertex' },
    fragment: { source: wgslSource, entryPoint: 'mainFragment' },
  });
  return { glProgram, gpuProgram };
}

export function createBlackHoleBody(look: BlackHoleLook, axes: BlackHoleAxes, seed: [number, number, number]): BlackHoleBody {
  const axisX = new Float32Array(4);
  const axisN = new Float32Array(4);
  const axisZ = new Float32Array(4);
  const flow = new Float32Array([look.spin, look.flowCycle, look.exposure, 0]);
  const skyFrame = new Float32Array(4);
  const lens = new Float32Array([0, 0, SKY_TWINKLE_SPEED, SKY_TWINKLE_DEPTH]);
  const holeUniforms = new UniformGroup({
    uAxisX: { value: axisX, type: 'vec4<f32>' },
    uAxisN: { value: axisN, type: 'vec4<f32>' },
    uAxisZ: { value: axisZ, type: 'vec4<f32>' },
    uDisk: { value: new Float32Array([look.innerRadius, look.outerRadius, look.peakTemperature, look.opacity]), type: 'vec4<f32>' },
    uFlow: { value: flow, type: 'vec4<f32>' },
    uSeed: { value: new Float32Array([...seed, 0]), type: 'vec4<f32>' },
    uSky: { value: skyFrame, type: 'vec4<f32>' },
    uLens: { value: lens, type: 'vec4<f32>' },
    uTime: { value: 0, type: 'f32' },
  });
  const extent = BLACK_HOLE_EXTENT;
  const geometry = new Geometry({
    attributes: { aPosition: new Float32Array([-extent, -extent, extent, -extent, extent, extent, -extent, extent]) },
    indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });
  const blank = Texture.WHITE.source;
  const shader = new Shader({
    ...programs(),
    resources: {
      holeUniforms,
      uNebula: blank,
      uNebulaSampler: blank.style,
      uStars: blank,
      uStarsSampler: blank.style,
    },
  });
  let boundNebula: Texture | null = null;
  let boundStars: Texture | null = null;
  const centre = new Point();
  const unit = new Point();
  const mesh = new Mesh({ geometry, shader });
  const scratch: Point3D = { x: 0, y: 0, z: 0 };

  function writeAxis(direction: Point3D, target: Float32Array, basis: ProjectionBasis) {
    viewSpaceDirectionWithBasis(direction, basis, scratch);
    target[0] = scratch.x;
    target[1] = scratch.y;
    target[2] = scratch.z;
  }

  function followSky(sky: SkyLens | null) {
    const parent = mesh.parent;
    if (!sky || !parent) {
      lens[0] = 0;
      return;
    }
    if (sky.nebula !== boundNebula) {
      boundNebula = sky.nebula;
      shader.resources.uNebula = sky.nebula.source;
      shader.resources.uNebulaSampler = sky.nebula.source.style;
    }
    if (sky.stars !== boundStars) {
      boundStars = sky.stars;
      shader.resources.uStars = sky.stars.source;
      shader.resources.uStarsSampler = sky.stars.source.style;
    }
    parent.toGlobal(mesh.position, centre);
    unit.set(mesh.position.x + 1, mesh.position.y);
    parent.toGlobal(unit, unit);
    const pixelsPerUnit = Math.hypot(unit.x - centre.x, unit.y - centre.y) * mesh.scale.x;
    skyFrame[0] = (centre.x - sky.x) / sky.width;
    skyFrame[1] = (centre.y - sky.y) / sky.height;
    skyFrame[2] = pixelsPerUnit / sky.width;
    skyFrame[3] = pixelsPerUnit / sky.height;
    lens[0] = 1;
    lens[1] = sky.seconds;
  }

  return {
    mesh,
    update(elapsed, exposure, basis, sky) {
      followSky(sky);
      writeAxis(axes.x, axisX, basis);
      writeAxis(axes.normal, axisN, basis);
      writeAxis(axes.z, axisZ, basis);
      flow[2] = exposure;
      holeUniforms.uniforms.uTime = elapsed;
      holeUniforms.update();
    },
    destroy() {
      shader.destroy();
      geometry.destroy();
    },
  };
}
