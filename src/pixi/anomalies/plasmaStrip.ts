import { Geometry, GlProgram, GpuProgram, Mesh, Shader, UniformGroup } from 'pixi.js';
import type { ProjectedPoint } from '../projection';
import { rgba } from './collectorPanels';

export interface PlasmaLook {
  core: number;
  coreWidth: number;
  sheath: number;
  sheathStrength: number;
  sheathFar: number;
  flowScale: number;
  flowSpeed: number;
  knots: number;
  knotStrength: number;
  turbulence: number;
}

export const STREAM_LOOK: PlasmaLook = {
  core: 0xffc27a,
  coreWidth: 0.35,
  sheath: 0xff8a3a,
  sheathStrength: 0.35,
  sheathFar: 0xff8a3a,
  flowScale: 9,
  flowSpeed: 1.6,
  knots: 0,
  knotStrength: 0,
  turbulence: 0.8,
};

export interface PlasmaStrip {
  segments: Mesh<Geometry, Shader>[];
  update(points: readonly ProjectedPoint[], halfWidths: ArrayLike<number>, along: ArrayLike<number>, intensity: ArrayLike<number>, time: number): void;
  destroy(): void;
}

const glVertex = `
in vec2 aPosition;
in vec2 aUV;
in float aIntensity;
out vec2 vUV;
out float vIntensity;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main(void) {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
  vIntensity = aIntensity;
}`;

const glFragment = `
in vec2 vUV;
in float vIntensity;
out vec4 finalColor;

uniform vec4 uCore;
uniform vec4 uSheath;
uniform vec4 uSheathFar;
uniform vec4 uFlow;
uniform vec2 uShape;
uniform float uTime;
uniform vec4 uColor;
uniform vec4 uWorldColorAlpha;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main(void) {
  float across = vUV.y;
  float y = abs(across);
  float along = vUV.x;
  vec2 flow = vec2(along * uFlow.x - uTime * uFlow.y, across * 2.2);
  float turbulence = noise(flow) * 0.6 + noise(flow * 2.3 + vec2(5.1, 1.7)) * 0.4;
  float wobble = (noise(vec2(along * uFlow.x * 0.5 - uTime * uFlow.y * 0.6, 3.0)) - 0.5) * uShape.y;
  float r = abs(across - wobble);
  float coreWidth = uCore.a;
  float core = exp(-r * r / (coreWidth * coreWidth));
  float sheath = exp(-y * y * 3.2) * (1.0 - uShape.y + uShape.y * 2.0 * turbulence) * (1.0 - smoothstep(0.7, 1.0, y));
  float knot = pow(0.5 + 0.5 * cos(along * uFlow.z * 6.2831853), 8.0) * uFlow.w;
  vec3 sheathColor = mix(uSheath.rgb, uSheathFar.rgb, smoothstep(0.05, 0.6, along));
  vec3 color = uCore.rgb * core * (1.0 + knot) + sheathColor * sheath * uSheath.a * (1.0 + knot * 0.5);
  color *= vIntensity;
  float alpha = clamp(max(color.r, max(color.g, color.b)), 0.0, 1.0);
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

struct PlasmaUniforms {
  uCore: vec4<f32>,
  uSheath: vec4<f32>,
  uSheathFar: vec4<f32>,
  uFlow: vec4<f32>,
  uShape: vec2<f32>,
  uTime: f32,
};

@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;
@group(2) @binding(0) var<uniform> plasmaUniforms: PlasmaUniforms;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) intensity: f32,
};

fn hash(p: vec2<f32>) -> f32 {
  var q = fract(vec3<f32>(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

fn noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2<f32>(1.0, 0.0)), u.x), mix(hash(i + vec2<f32>(0.0, 1.0)), hash(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>, @location(1) aUV: vec2<f32>, @location(2) aIntensity: f32) -> VSOutput {
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  let clip = mvp * vec3<f32>(aPosition, 1.0);
  return VSOutput(vec4<f32>(clip.xy, 0.0, 1.0), aUV, aIntensity);
}

@fragment
fn mainFragment(@location(0) vUV: vec2<f32>, @location(1) vIntensity: f32) -> @location(0) vec4<f32> {
  let u = plasmaUniforms;
  let across = vUV.y;
  let y = abs(across);
  let along = vUV.x;
  let flow = vec2<f32>(along * u.uFlow.x - u.uTime * u.uFlow.y, across * 2.2);
  let turbulence = noise(flow) * 0.6 + noise(flow * 2.3 + vec2<f32>(5.1, 1.7)) * 0.4;
  let wobble = (noise(vec2<f32>(along * u.uFlow.x * 0.5 - u.uTime * u.uFlow.y * 0.6, 3.0)) - 0.5) * u.uShape.y;
  let r = abs(across - wobble);
  let coreWidth = u.uCore.a;
  let core = exp(-r * r / (coreWidth * coreWidth));
  let sheath = exp(-y * y * 3.2) * (1.0 - u.uShape.y + u.uShape.y * 2.0 * turbulence) * (1.0 - smoothstep(0.7, 1.0, y));
  let knot = pow(0.5 + 0.5 * cos(along * u.uFlow.z * 6.2831853), 8.0) * u.uFlow.w;
  let sheathColor = mix(u.uSheath.rgb, u.uSheathFar.rgb, smoothstep(0.05, 0.6, along));
  var color = u.uCore.rgb * core * (1.0 + knot) + sheathColor * sheath * u.uSheath.a * (1.0 + knot * 0.5);
  color *= vIntensity;
  let alpha = clamp(max(color.r, max(color.g, color.b)), 0.0, 1.0);
  return vec4<f32>(color, alpha) * localUniforms.uColor.a * globalUniforms.uWorldColorAlpha.a;
}`;

let glProgram: GlProgram | null = null;
let gpuProgram: GpuProgram | null = null;

function programs() {
  glProgram ??= GlProgram.from({ vertex: glVertex, fragment: glFragment, name: 'plasma-strip' });
  gpuProgram ??= GpuProgram.from({
    vertex: { source: wgslSource, entryPoint: 'mainVertex' },
    fragment: { source: wgslSource, entryPoint: 'mainFragment' },
  });
  return { glProgram, gpuProgram };
}

export function createPlasmaStrip(segmentCount: number, look: PlasmaLook): PlasmaStrip {
  const uniforms = new UniformGroup({
    uCore: { value: rgba(look.core, look.coreWidth), type: 'vec4<f32>' },
    uSheath: { value: rgba(look.sheath, look.sheathStrength), type: 'vec4<f32>' },
    uSheathFar: { value: rgba(look.sheathFar, 0), type: 'vec4<f32>' },
    uFlow: { value: new Float32Array([look.flowScale, look.flowSpeed, look.knots, look.knotStrength]), type: 'vec4<f32>' },
    uShape: { value: new Float32Array([0, look.turbulence]), type: 'vec2<f32>' },
    uTime: { value: 0, type: 'f32' },
  });
  const shader = new Shader({ ...programs(), resources: { plasmaUniforms: uniforms } });

  const segments = Array.from({ length: segmentCount }, () => {
    const geometry = new Geometry({
      attributes: {
        aPosition: new Float32Array(8),
        aUV: new Float32Array(8),
        aIntensity: new Float32Array(4),
      },
      indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    const mesh = new Mesh<Geometry, Shader>({ geometry, shader });
    mesh.blendMode = 'add';
    mesh.eventMode = 'none';
    return mesh;
  });

  return {
    segments,
    update(points, halfWidths, along, intensity, time) {
      uniforms.uniforms.uTime = time;
      uniforms.update();
      segments.forEach((mesh, i) => {
        const from = points[i];
        const to = points[i + 1];
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.hypot(dx, dy) || 1e-3;
        const nx = -dy / length;
        const ny = dx / length;
        const w0 = halfWidths[i];
        const w1 = halfWidths[i + 1];
        const position = mesh.geometry.getBuffer('aPosition');
        const uv = mesh.geometry.getBuffer('aUV');
        const light = mesh.geometry.getBuffer('aIntensity');
        (position.data as Float32Array).set([
          from.x + nx * w0, from.y + ny * w0,
          to.x + nx * w1, to.y + ny * w1,
          to.x - nx * w1, to.y - ny * w1,
          from.x - nx * w0, from.y - ny * w0,
        ]);
        (uv.data as Float32Array).set([along[i], 1, along[i + 1], 1, along[i + 1], -1, along[i], -1]);
        (light.data as Float32Array).set([intensity[i], intensity[i + 1], intensity[i + 1], intensity[i]]);
        position.update();
        uv.update();
        light.update();
        mesh.zIndex = (from.depth + to.depth) / 2;
      });
    },
    destroy() {
      for (const mesh of segments) {
        mesh.geometry.destroy();
        mesh.destroy();
      }
      shader.destroy();
    },
  };
}
