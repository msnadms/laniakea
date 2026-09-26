import { Geometry, GlProgram, GpuProgram, Mesh, Shader, UniformGroup } from 'pixi.js';
import type { ProjectionBasis } from '../projection';
import type { ShellLattice } from './shellLattice';

export interface ShellLook {
  hull: number;
  heat: number;
  heatStrength: number;
  inner: number;
  interior: number;
  activity: number;
  rim: number;
  lights: boolean;
  subcells: number;
  gap: number;
}

export interface ShellSurface {
  back: Mesh<Geometry, Shader>;
  front: Mesh<Geometry, Shader>;
  orient(basis: ProjectionBasis, spin: number, elapsed: number): void;
  destroy(): void;
}

const EXTENT = 1.03;

const glVertex = `
in vec2 aPosition;
out vec2 vDisc;
out float vPixel;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec2 uResolution;

void main(void) {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vDisc = aPosition;
  vec2 axis = (mvp * vec3(1.0, 0.0, 0.0)).xy * uResolution * 0.5;
  vPixel = 1.0 / max(length(axis), 0.001);
}`;

const glFragment = `
in vec2 vDisc;
in float vPixel;
out vec4 finalColor;

uniform sampler2D uCells;
uniform vec3 uAxisX;
uniform vec3 uAxisY;
uniform vec3 uAxisZ;
uniform vec4 uGrid;
uniform vec4 uHull;
uniform vec4 uHeat;
uniform vec4 uInner;
uniform vec4 uActivity;
uniform float uTime;
uniform vec4 uColor;
uniform vec4 uWorldColorAlpha;

float hash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float edgeDistance(vec2 f) {
  return min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
}

void main(void) {
  float radius = length(vDisc);
  float coverage = clamp((1.0 - radius) / vPixel + 0.5, 0.0, 1.0);
  vec2 disc = vDisc / max(radius, 1.0);
  float facing = sqrt(max(0.0, 1.0 - dot(disc, disc)));
  float side = uGrid.w;
  vec3 view = vec3(disc, facing * side);
  vec3 p = vec3(dot(view, uAxisX), dot(view, uAxisY), dot(view, uAxisZ));
  vec3 a = abs(p);

  float cells = uGrid.x;
  float isX = step(a.y, a.x) * step(a.z, a.x);
  float isY = (1.0 - isX) * step(a.z, a.y);
  float isZ = 1.0 - isX - isY;
  float major = max(max(a.x, a.y), max(a.z, 0.0001));
  vec2 face = (vec2(p.z, p.y) * isX + vec2(p.x, p.z) * isY + vec2(p.x, p.y) * isZ) / major;
  float faceIndex = isX * (1.0 - step(0.0, p.x)) + isY * (3.0 - step(0.0, p.y)) + isZ * (5.0 - step(0.0, p.z));
  vec2 grid = (atan(face) * 0.63662 + 1.0) * 0.5 * cells;
  vec2 cell = min(floor(grid), vec2(cells - 1.0));
  vec2 f = grid - cell;
  vec4 data = texture(uCells, vec2((faceIndex * cells + cell.x + 0.5) / (6.0 * cells), (cell.y + 0.5) / cells));

  float footprint = vPixel * cells * 0.6366 / max(facing, 0.12);
  float gap = uGrid.z;
  float edge = edgeDistance(f);
  float panel = smoothstep(gap - footprint * 0.5, gap + footprint * 0.5, edge);
  float strutWidth = gap * 0.28;
  float strut = 1.0 - smoothstep(strutWidth - footprint * 0.5, strutWidth + footprint * 0.5, edge);

  float span = 1.0 - 2.0 * gap;
  vec2 inner = clamp((f - gap) / span, 0.0, 1.0);
  float subcells = uGrid.y;
  vec2 sub = inner * subcells;
  vec2 subCell = min(floor(sub), vec2(subcells - 1.0));
  vec2 subF = sub - subCell;
  float subFootprint = footprint * subcells / span;
  float detail = 1.0 - smoothstep(0.2, 0.55, subFootprint);
  float seam = (1.0 - smoothstep(0.05, 0.05 + subFootprint, edgeDistance(subF))) * detail;
  float frame = (1.0 - smoothstep(0.035, 0.035 + footprint / span, edgeDistance(inner))) * detail;
  float fin = (0.5 + 0.5 * cos(subF.y * 37.699)) * (1.0 - smoothstep(0.1, 0.3, subFootprint * 6.0));

  float cellId = faceIndex * 97.0 + cell.x * 13.0 + cell.y;
  float tone = hash(vec3(cellId, subCell.x * 7.0 + 1.0, subCell.y * 11.0 + 2.0));
  float chip = hash(vec3(subCell.y * 5.0 + 3.0, cellId * 0.37, subCell.x * 3.0 + 9.0));

  float present = step(0.5, data.r);
  float damage = data.g;
  float shade = data.b;
  float activity = data.a;
  float lossChance = clamp(damage * 0.8 - 0.1, 0.0, 1.0);
  float lost = mix(lossChance, step(chip, lossChance), detail);
  float solid = present * max(panel * (1.0 - lost), strut * (1.0 - panel) * (1.0 - damage * 0.7));

  float centre = smoothstep(0.0, 0.5, edgeDistance(inner));
  vec3 hull = uHull.rgb * (0.7 + 0.6 * shade) * (1.0 + (tone - 0.5) * 0.35 * detail);
  hull *= 1.0 - seam * 0.55;
  hull *= 0.85 + 0.3 * fin * (1.0 - frame);
  hull = mix(hull, uHull.rgb * 2.2 + 0.03, frame * 0.6);
  hull *= 1.0 - damage * 0.55;
  float heat = uHull.a * (0.35 + 0.65 * centre) * (0.75 + 0.5 * tone * detail) * (0.6 + 0.4 * fin) * (1.0 - damage * 0.85);
  vec3 outside = hull + uHeat.rgb * heat * (1.0 - frame * 0.6);
  outside += uInner.rgb * pow(1.0 - facing, 3.0) * uActivity.a;
  outside += uActivity.rgb * activity * (0.35 + 0.45 * tone + seam * 0.9);
  float beacon = step(0.9, fract(uTime * 0.37 + shade * 7.3));
  float beaconSize = max(0.025, 1.4 * footprint / span);
  float beaconGlow = 1.0 - smoothstep(beaconSize * 0.4, beaconSize, length(inner - 0.06));
  outside += vec3(1.0, 0.82, 0.55) * beaconGlow * beacon * uHeat.a * (1.0 - smoothstep(0.03, 0.09, footprint)) * (1.0 - damage);

  vec3 collector = vec3(0.035, 0.045, 0.075) * (0.75 + 0.5 * tone * detail);
  vec3 insideLit = collector + uInner.rgb * (0.08 + 0.1 * shade + 0.05 * tone * detail);
  insideLit = mix(insideLit, uInner.rgb * 0.42, seam * 0.7 + frame * 0.4);
  insideLit += uInner.rgb * pow(1.0 - facing, 2.0) * 0.3;
  insideLit *= uInner.a * (1.0 - damage * 0.6);

  vec3 color = side > 0.0 ? outside : insideLit;
  color = mix(color, uHull.rgb * 0.8, strut * (1.0 - panel));
  float alpha = coverage * solid;
  finalColor = vec4(color * alpha, alpha) * uColor.a * uWorldColorAlpha.a;
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

struct ShellUniforms {
  uAxisX: vec3<f32>,
  uAxisY: vec3<f32>,
  uAxisZ: vec3<f32>,
  uGrid: vec4<f32>,
  uHull: vec4<f32>,
  uHeat: vec4<f32>,
  uInner: vec4<f32>,
  uActivity: vec4<f32>,
  uTime: f32,
};

@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;
@group(2) @binding(0) var<uniform> shellUniforms: ShellUniforms;
@group(2) @binding(1) var uCells: texture_2d<f32>;
@group(2) @binding(2) var uCellsSampler: sampler;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) disc: vec2<f32>,
  @location(1) pixel: f32,
};

fn hash(q: vec3<f32>) -> f32 {
  var p = fract(q * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

fn edgeDistance(f: vec2<f32>) -> f32 {
  return min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
}

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  let clip = mvp * vec3<f32>(aPosition, 1.0);
  let axis = (mvp * vec3<f32>(1.0, 0.0, 0.0)).xy * globalUniforms.uResolution * 0.5;
  return VSOutput(vec4<f32>(clip.xy, 0.0, 1.0), aPosition, 1.0 / max(length(axis), 0.001));
}

@fragment
fn mainFragment(@location(0) vDisc: vec2<f32>, @location(1) vPixel: f32) -> @location(0) vec4<f32> {
  let u = shellUniforms;
  let radius = length(vDisc);
  let coverage = clamp((1.0 - radius) / vPixel + 0.5, 0.0, 1.0);
  let disc = vDisc / max(radius, 1.0);
  let facing = sqrt(max(0.0, 1.0 - dot(disc, disc)));
  let side = u.uGrid.w;
  let view = vec3<f32>(disc, facing * side);
  let p = vec3<f32>(dot(view, u.uAxisX), dot(view, u.uAxisY), dot(view, u.uAxisZ));
  let a = abs(p);

  let cells = u.uGrid.x;
  let isX = step(a.y, a.x) * step(a.z, a.x);
  let isY = (1.0 - isX) * step(a.z, a.y);
  let isZ = 1.0 - isX - isY;
  let major = max(max(a.x, a.y), max(a.z, 0.0001));
  let face = (vec2<f32>(p.z, p.y) * isX + vec2<f32>(p.x, p.z) * isY + vec2<f32>(p.x, p.y) * isZ) / major;
  let faceIndex = isX * (1.0 - step(0.0, p.x)) + isY * (3.0 - step(0.0, p.y)) + isZ * (5.0 - step(0.0, p.z));
  let grid = (atan(face) * 0.63662 + 1.0) * 0.5 * cells;
  let cell = min(floor(grid), vec2<f32>(cells - 1.0));
  let f = grid - cell;
  let data = textureSampleLevel(uCells, uCellsSampler, vec2<f32>((faceIndex * cells + cell.x + 0.5) / (6.0 * cells), (cell.y + 0.5) / cells), 0.0);

  let footprint = vPixel * cells * 0.6366 / max(facing, 0.12);
  let gap = u.uGrid.z;
  let edge = edgeDistance(f);
  let panel = smoothstep(gap - footprint * 0.5, gap + footprint * 0.5, edge);
  let strutWidth = gap * 0.28;
  let strut = 1.0 - smoothstep(strutWidth - footprint * 0.5, strutWidth + footprint * 0.5, edge);

  let span = 1.0 - 2.0 * gap;
  let inner = clamp((f - gap) / span, vec2<f32>(0.0), vec2<f32>(1.0));
  let subcells = u.uGrid.y;
  let sub = inner * subcells;
  let subCell = min(floor(sub), vec2<f32>(subcells - 1.0));
  let subF = sub - subCell;
  let subFootprint = footprint * subcells / span;
  let detail = 1.0 - smoothstep(0.2, 0.55, subFootprint);
  let seam = (1.0 - smoothstep(0.05, 0.05 + subFootprint, edgeDistance(subF))) * detail;
  let frame = (1.0 - smoothstep(0.035, 0.035 + footprint / span, edgeDistance(inner))) * detail;
  let fin = (0.5 + 0.5 * cos(subF.y * 37.699)) * (1.0 - smoothstep(0.1, 0.3, subFootprint * 6.0));

  let cellId = faceIndex * 97.0 + cell.x * 13.0 + cell.y;
  let tone = hash(vec3<f32>(cellId, subCell.x * 7.0 + 1.0, subCell.y * 11.0 + 2.0));
  let chip = hash(vec3<f32>(subCell.y * 5.0 + 3.0, cellId * 0.37, subCell.x * 3.0 + 9.0));

  let present = step(0.5, data.r);
  let damage = data.g;
  let shade = data.b;
  let activity = data.a;
  let lossChance = clamp(damage * 0.8 - 0.1, 0.0, 1.0);
  let lost = mix(lossChance, step(chip, lossChance), detail);
  let solid = present * max(panel * (1.0 - lost), strut * (1.0 - panel) * (1.0 - damage * 0.7));

  let centre = smoothstep(0.0, 0.5, edgeDistance(inner));
  var hull = u.uHull.rgb * (0.7 + 0.6 * shade) * (1.0 + (tone - 0.5) * 0.35 * detail);
  hull *= 1.0 - seam * 0.55;
  hull *= 0.85 + 0.3 * fin * (1.0 - frame);
  hull = mix(hull, u.uHull.rgb * 2.2 + 0.03, frame * 0.6);
  hull *= 1.0 - damage * 0.55;
  let heat = u.uHull.a * (0.35 + 0.65 * centre) * (0.75 + 0.5 * tone * detail) * (0.6 + 0.4 * fin) * (1.0 - damage * 0.85);
  var outside = hull + u.uHeat.rgb * heat * (1.0 - frame * 0.6);
  outside += u.uInner.rgb * pow(1.0 - facing, 3.0) * u.uActivity.a;
  outside += u.uActivity.rgb * activity * (0.35 + 0.45 * tone + seam * 0.9);
  let beacon = step(0.9, fract(u.uTime * 0.37 + shade * 7.3));
  let beaconSize = max(0.025, 1.4 * footprint / span);
  let beaconGlow = 1.0 - smoothstep(beaconSize * 0.4, beaconSize, length(inner - vec2<f32>(0.06)));
  outside += vec3<f32>(1.0, 0.82, 0.55) * beaconGlow * beacon * u.uHeat.a * (1.0 - smoothstep(0.03, 0.09, footprint)) * (1.0 - damage);

  let collector = vec3<f32>(0.035, 0.045, 0.075) * (0.75 + 0.5 * tone * detail);
  var insideLit = collector + u.uInner.rgb * (0.08 + 0.1 * shade + 0.05 * tone * detail);
  insideLit = mix(insideLit, u.uInner.rgb * 0.42, seam * 0.7 + frame * 0.4);
  insideLit += u.uInner.rgb * pow(1.0 - facing, 2.0) * 0.3;
  insideLit *= u.uInner.a * (1.0 - damage * 0.6);

  var color = select(insideLit, outside, side > 0.0);
  color = mix(color, u.uHull.rgb * 0.8, strut * (1.0 - panel));
  let alpha = coverage * solid;
  return vec4<f32>(color * alpha, alpha) * localUniforms.uColor.a * globalUniforms.uWorldColorAlpha.a;
}`;

let glProgram: GlProgram | null = null;
let gpuProgram: GpuProgram | null = null;

function programs() {
  glProgram ??= GlProgram.from({ vertex: glVertex, fragment: glFragment, name: 'shell-surface' });
  gpuProgram ??= GpuProgram.from({
    vertex: { source: wgslSource, entryPoint: 'mainVertex' },
    fragment: { source: wgslSource, entryPoint: 'mainFragment' },
  });
  return { glProgram, gpuProgram };
}

function rgb(color: number, w: number): Float32Array {
  return new Float32Array([((color >> 16) & 0xff) / 255, ((color >> 8) & 0xff) / 255, (color & 0xff) / 255, w]);
}

export function createShellGeometry(): Geometry {
  return new Geometry({
    attributes: { aPosition: new Float32Array([-EXTENT, -EXTENT, EXTENT, -EXTENT, EXTENT, EXTENT, -EXTENT, EXTENT]) },
    indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });
}

export function createShellSurface(geometry: Geometry, lattice: ShellLattice, look: ShellLook, radius: number): ShellSurface {
  const axisX = new Float32Array([1, 0, 0]);
  const axisY = new Float32Array([0, 1, 0]);
  const axisZ = new Float32Array([0, 0, 1]);
  const groups: UniformGroup[] = [];

  const createSide = (side: 1 | -1) => {
    const uniforms = new UniformGroup({
      uAxisX: { value: axisX, type: 'vec3<f32>' },
      uAxisY: { value: axisY, type: 'vec3<f32>' },
      uAxisZ: { value: axisZ, type: 'vec3<f32>' },
      uGrid: { value: new Float32Array([lattice.cells, look.subcells, look.gap, side]), type: 'vec4<f32>' },
      uHull: { value: rgb(look.hull, look.heatStrength), type: 'vec4<f32>' },
      uHeat: { value: rgb(look.heat, look.lights ? 1 : 0), type: 'vec4<f32>' },
      uInner: { value: rgb(look.inner, look.interior), type: 'vec4<f32>' },
      uActivity: { value: rgb(look.activity, look.rim), type: 'vec4<f32>' },
      uTime: { value: 0, type: 'f32' },
    });
    groups.push(uniforms);
    const shader = new Shader({
      ...programs(),
      resources: {
        shellUniforms: uniforms,
        uCells: lattice.source,
        uCellsSampler: lattice.source.style,
      },
    });
    const mesh = new Mesh({ geometry, shader });
    mesh.scale.set(radius);
    mesh.eventMode = 'none';
    return mesh;
  };

  const back = createSide(-1);
  const front = createSide(1);

  return {
    back,
    front,
    orient(basis, spin, elapsed) {
      const cosYaw = basis.cosYaw * Math.cos(spin) - basis.sinYaw * Math.sin(spin);
      const sinYaw = basis.sinYaw * Math.cos(spin) + basis.cosYaw * Math.sin(spin);
      axisX[0] = cosYaw;
      axisX[1] = sinYaw * basis.cosTilt;
      axisX[2] = sinYaw * basis.sinTilt;
      axisY[0] = 0;
      axisY[1] = -basis.sinTilt;
      axisY[2] = basis.cosTilt;
      axisZ[0] = -sinYaw;
      axisZ[1] = cosYaw * basis.cosTilt;
      axisZ[2] = cosYaw * basis.sinTilt;
      for (const uniforms of groups) {
        uniforms.uniforms.uTime = elapsed;
        uniforms.update();
      }
    },
    destroy() {
      back.shader?.destroy();
      front.shader?.destroy();
      back.destroy();
      front.destroy();
    },
  };
}
