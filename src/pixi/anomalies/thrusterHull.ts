import { Geometry, GlProgram, GpuProgram, Mesh, Shader, UniformGroup } from 'pixi.js';
import { projectSystemPointWithBasis, viewSpaceDirectionWithBasis, type Point3D, type ProjectedPoint, type ProjectionBasis } from '../projection';
import { rgba } from './collectorPanels';
import { TAU } from './shared';

export interface HullFrame {
  origin: Point3D;
  axis: Point3D;
  tangent: Point3D;
  bitangent: Point3D;
}

export interface HullLook {
  hull: number;
  ambient: number;
  exhaust: number;
  exhaustStrength: number;
  intake: number;
  intakeStrength: number;
  radiator: number;
  radiatorStrength: number;
  damage: number;
  lights: boolean;
  charge?: number;
}

export type HullPoint = readonly [along: number, radius: number, part?: number];

export interface HullFins {
  count: number;
  span: readonly [number, number];
  inner: number;
  reach: number;
}

export interface HullRail {
  angle: number;
  from: number;
  to: number;
  radiusFrom: number;
  radiusTo: number;
  width: number;
}

export interface HullShape {
  profile: readonly HullPoint[];
  fins: HullFins | null;
  rails?: readonly HullRail[];
}

export interface ThrusterHull {
  mesh: Mesh<Geometry, Shader>;
  update(basis: ProjectionBasis, time: number): ProjectedPoint;
  setCharge(level: number): void;
  destroy(): void;
}

const AROUND = 32;

const CAPLAN_PROFILE: readonly HullPoint[] = [
  [0.0, 1.0],
  [0.03, 1.02],
  [0.07, 0.95],
  [0.2, 0.66],
  [0.32, 0.5],
  [0.36, 0.54],
  [0.5, 0.56],
  [0.64, 0.54],
  [0.68, 0.5],
  [0.74, 0.36],
  [0.8, 0.4],
  [0.9, 0.55],
  [1.0, 0.68],
];

export const CAPLAN_SHAPE: HullShape = {
  profile: CAPLAN_PROFILE,
  fins: { count: 4, span: [0.34, 0.66], inner: 0.54, reach: 1.55 },
};

const glVertex = `
in vec2 aPosition;
in vec2 aUV;
in vec4 aNormal;
out vec2 vUV;
out vec4 vNormal;
out float vPixels;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec2 uResolution;
uniform float uRadius;

void main(void) {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
  vNormal = aNormal;
  vPixels = length((mvp * vec3(1.0, 0.0, 0.0)).xy * uResolution * 0.5) * uRadius;
}`;

const glFragment = `
in vec2 vUV;
in vec4 vNormal;
in float vPixels;
out vec4 finalColor;

uniform vec4 uHull;
uniform vec4 uExhaust;
uniform vec4 uIntake;
uniform vec4 uRadiator;
uniform vec4 uCharge;
uniform vec4 uStar;
uniform vec3 uLight;
uniform vec4 uGrid;
uniform float uTime;
uniform vec4 uColor;
uniform vec4 uWorldColorAlpha;

float hash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

void main(void) {
  float part = vNormal.w;
  float fin = step(1.5, part);
  vec3 normal = normalize(vNormal.xyz + vec3(0.0, 0.0, 0.0001));
  float outer = step(0.0, normal.z);
  vec3 facing = normal * (outer * 2.0 - 1.0);
  vec3 light = normalize(uLight + vec3(0.0, 0.0001, 0.0));
  float lit = max(dot(facing, light), 0.0);

  vec2 grid = vUV * uGrid.xy;
  vec2 cell = floor(grid);
  vec2 f = fract(grid);
  float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  float cellPx = uGrid.x / max(vPixels * 6.2831853, 0.001);
  float detail = 1.0 - smoothstep(0.1, 0.35, cellPx);
  float seam = (1.0 - smoothstep(0.04, 0.04 + cellPx, edge)) * detail;
  float tone = hash(vec3(cell, part * 17.0 + 3.0));
  float chip = hash(vec3(cell.yx + 11.0, part * 7.0 + 1.0));
  float damage = uGrid.w;
  float hole = step(chip, damage * 0.55) * (1.0 - seam) * (1.0 - fin * 0.5);

  vec3 hull = uHull.rgb * (0.78 + 0.44 * tone * detail + 0.22 * (1.0 - detail));
  hull *= 1.0 - seam * 0.5;
  hull *= mix(1.0, 0.45, (1.0 - outer) * (1.0 - fin));
  vec3 halfway = normalize(light + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(facing, halfway), 0.0), 28.0) * 0.6;
  vec3 color = hull * (uHull.a + lit * 1.1) * uStar.rgb + uStar.rgb * spec * lit * (1.0 - damage * 0.6);

  float along = vUV.y;
  float nozzle = smoothstep(0.7, 0.95, along) * (1.0 - outer) * (1.0 - fin);
  float flicker = 0.85 + 0.15 * sin(uTime * 7.3 + along * 20.0);
  color += uExhaust.rgb * uExhaust.a * nozzle * flicker * (1.3 - 0.3 * seam);
  color += uExhaust.rgb * uExhaust.a * 0.25 * smoothstep(0.9, 1.0, along) * outer * (1.0 - fin);
  float lip = (1.0 - smoothstep(0.0, 0.1, along)) * (1.0 - fin);
  color += uIntake.rgb * uIntake.a * lip * (0.6 + 0.4 * (1.0 - outer));
  float throat = (1.0 - smoothstep(0.0, 0.2, abs(along - 0.26))) * (1.0 - outer) * (1.0 - fin);
  color += uIntake.rgb * uIntake.a * 0.5 * throat;

  float stripe = 0.5 + 0.5 * cos(vUV.x * uGrid.x * 12.0);
  float glow = uRadiator.a * fin * (0.55 + 0.45 * mix(0.5, stripe, detail)) * (0.6 + 0.4 * tone);
  color += uRadiator.rgb * glow;

  float winding = step(0.5, part) * (1.0 - fin);
  float turns = 0.5 + 0.5 * cos(vUV.x * uGrid.x * 24.0);
  color *= 1.0 - winding * 0.35 * turns * detail;
  color += uCharge.rgb * uCharge.a * winding * (0.75 + 0.25 * mix(0.5, turns, detail));

  float beacon = step(0.9, fract(uTime * 0.5 + tone * 5.0)) * step(0.85, along) * (1.0 - fin) * outer;
  color += vec3(1.0, 0.35, 0.2) * beacon * uStar.a * (1.0 - seam) * step(0.97, chip) * detail;
  color *= 1.0 - damage * 0.5 * hash(vec3(cell * 0.5, 9.0));

  float alpha = 1.0 - hole;
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

struct HullUniforms {
  uHull: vec4<f32>,
  uExhaust: vec4<f32>,
  uIntake: vec4<f32>,
  uRadiator: vec4<f32>,
  uCharge: vec4<f32>,
  uStar: vec4<f32>,
  uLight: vec3<f32>,
  uGrid: vec4<f32>,
  uRadius: f32,
  uTime: f32,
};

@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;
@group(2) @binding(0) var<uniform> hullUniforms: HullUniforms;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) normal: vec4<f32>,
  @location(2) pixels: f32,
};

fn hash(q: vec3<f32>) -> f32 {
  var p = fract(q * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>, @location(1) aUV: vec2<f32>, @location(2) aNormal: vec4<f32>) -> VSOutput {
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  let clip = mvp * vec3<f32>(aPosition, 1.0);
  let pixels = length((mvp * vec3<f32>(1.0, 0.0, 0.0)).xy * globalUniforms.uResolution * 0.5) * hullUniforms.uRadius;
  return VSOutput(vec4<f32>(clip.xy, 0.0, 1.0), aUV, aNormal, pixels);
}

@fragment
fn mainFragment(@location(0) vUV: vec2<f32>, @location(1) vNormal: vec4<f32>, @location(2) vPixels: f32) -> @location(0) vec4<f32> {
  let u = hullUniforms;
  let part = vNormal.w;
  let fin = step(1.5, part);
  let normal = normalize(vNormal.xyz + vec3<f32>(0.0, 0.0, 0.0001));
  let outer = step(0.0, normal.z);
  let facing = normal * (outer * 2.0 - 1.0);
  let light = normalize(u.uLight + vec3<f32>(0.0, 0.0001, 0.0));
  let lit = max(dot(facing, light), 0.0);

  let grid = vUV * u.uGrid.xy;
  let cell = floor(grid);
  let f = fract(grid);
  let edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  let cellPx = u.uGrid.x / max(vPixels * 6.2831853, 0.001);
  let detail = 1.0 - smoothstep(0.1, 0.35, cellPx);
  let seam = (1.0 - smoothstep(0.04, 0.04 + cellPx, edge)) * detail;
  let tone = hash(vec3<f32>(cell, part * 17.0 + 3.0));
  let chip = hash(vec3<f32>(cell.yx + 11.0, part * 7.0 + 1.0));
  let damage = u.uGrid.w;
  let hole = step(chip, damage * 0.55) * (1.0 - seam) * (1.0 - fin * 0.5);

  var hull = u.uHull.rgb * (0.78 + 0.44 * tone * detail + 0.22 * (1.0 - detail));
  hull *= 1.0 - seam * 0.5;
  hull *= mix(1.0, 0.45, (1.0 - outer) * (1.0 - fin));
  let halfway = normalize(light + vec3<f32>(0.0, 0.0, 1.0));
  let spec = pow(max(dot(facing, halfway), 0.0), 28.0) * 0.6;
  var color = hull * (u.uHull.a + lit * 1.1) * u.uStar.rgb + u.uStar.rgb * spec * lit * (1.0 - damage * 0.6);

  let along = vUV.y;
  let nozzle = smoothstep(0.7, 0.95, along) * (1.0 - outer) * (1.0 - fin);
  let flicker = 0.85 + 0.15 * sin(u.uTime * 7.3 + along * 20.0);
  color += u.uExhaust.rgb * u.uExhaust.a * nozzle * flicker * (1.3 - 0.3 * seam);
  color += u.uExhaust.rgb * u.uExhaust.a * 0.25 * smoothstep(0.9, 1.0, along) * outer * (1.0 - fin);
  let lip = (1.0 - smoothstep(0.0, 0.1, along)) * (1.0 - fin);
  color += u.uIntake.rgb * u.uIntake.a * lip * (0.6 + 0.4 * (1.0 - outer));
  let throat = (1.0 - smoothstep(0.0, 0.2, abs(along - 0.26))) * (1.0 - outer) * (1.0 - fin);
  color += u.uIntake.rgb * u.uIntake.a * 0.5 * throat;

  let stripe = 0.5 + 0.5 * cos(vUV.x * u.uGrid.x * 12.0);
  let glow = u.uRadiator.a * fin * (0.55 + 0.45 * mix(0.5, stripe, detail)) * (0.6 + 0.4 * tone);
  color += u.uRadiator.rgb * glow;

  let winding = step(0.5, part) * (1.0 - fin);
  let turns = 0.5 + 0.5 * cos(vUV.x * u.uGrid.x * 24.0);
  color *= 1.0 - winding * 0.35 * turns * detail;
  color += u.uCharge.rgb * u.uCharge.a * winding * (0.75 + 0.25 * mix(0.5, turns, detail));

  let beacon = step(0.9, fract(u.uTime * 0.5 + tone * 5.0)) * step(0.85, along) * (1.0 - fin) * outer;
  color += vec3<f32>(1.0, 0.35, 0.2) * beacon * u.uStar.a * (1.0 - seam) * step(0.97, chip) * detail;
  color *= 1.0 - damage * 0.5 * hash(vec3<f32>(cell * 0.5, 9.0));

  let alpha = 1.0 - hole;
  return vec4<f32>(color * alpha, alpha) * localUniforms.uColor.a * globalUniforms.uWorldColorAlpha.a;
}`;

let glProgram: GlProgram | null = null;
let gpuProgram: GpuProgram | null = null;

function programs() {
  glProgram ??= GlProgram.from({ vertex: glVertex, fragment: glFragment, name: 'thruster-hull' });
  gpuProgram ??= GpuProgram.from({
    vertex: { source: wgslSource, entryPoint: 'mainVertex' },
    fragment: { source: wgslSource, entryPoint: 'mainFragment' },
  });
  return { glProgram, gpuProgram };
}

interface Quad {
  corners: Point3D[];
  normals: Point3D[];
  uvs: [number, number][];
  part: number;
  center: Point3D;
}

function point(x = 0, y = 0, z = 0): Point3D {
  return { x, y, z };
}

export function createThrusterHull(
  frame: HullFrame,
  radius: number,
  length: number,
  look: HullLook,
  starColor: number,
  skip: (around: number, along: number, fin: boolean) => boolean,
  shape: HullShape = CAPLAN_SHAPE,
): ThrusterHull {
  const { origin, axis, tangent, bitangent } = frame;
  const at = (along: number, r: number, angle: number, out = point()) => {
    const c = Math.cos(angle) * r;
    const s = Math.sin(angle) * r;
    out.x = origin.x + axis.x * along + tangent.x * c + bitangent.x * s;
    out.y = origin.y + axis.y * along + tangent.y * c + bitangent.y * s;
    out.z = origin.z + axis.z * along + tangent.z * c + bitangent.z * s;
    return out;
  };
  const radial = (angle: number, radialPart: number, axialPart: number) => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return point(
      (tangent.x * c + bitangent.x * s) * radialPart + axis.x * axialPart,
      (tangent.y * c + bitangent.y * s) * radialPart + axis.y * axialPart,
      (tangent.z * c + bitangent.z * s) * radialPart + axis.z * axialPart,
    );
  };

  const profile = shape.profile.map(([t, r]) => [(t - 0.5) * length, r * radius] as const);
  const same = (a: readonly number[], b: readonly number[]) => a[0] === b[0] && a[1] === b[1];
  const ringNormals = profile.map((current, i) => {
    const prev = i > 0 && !same(profile[i - 1], current) ? profile[i - 1] : current;
    const next = i < profile.length - 1 && !same(profile[i + 1], current) ? profile[i + 1] : current;
    const dAlong = next[0] - prev[0];
    const dRadius = next[1] - prev[1];
    const size = Math.hypot(dAlong, dRadius) || 1;
    return [dAlong / size, -dRadius / size] as const;
  });

  const quads: Quad[] = [];
  for (let ring = 0; ring < profile.length - 1; ring++) {
    if (same(profile[ring], profile[ring + 1])) continue;
    const v0 = shape.profile[ring][0];
    const v1 = shape.profile[ring + 1][0];
    const part = shape.profile[ring][2] ?? 0;
    for (let k = 0; k < AROUND; k++) {
      const a0 = k / AROUND * TAU;
      const a1 = (k + 1) / AROUND * TAU;
      if (skip((a0 + a1) / 2, (v0 + v1) / 2, false)) continue;
      const cells: [number, number, number][] = [[a0, ring, k / AROUND], [a1, ring, (k + 1) / AROUND], [a1, ring + 1, (k + 1) / AROUND], [a0, ring + 1, k / AROUND]];
      quads.push({
        corners: cells.map(([angle, r]) => at(profile[r][0], profile[r][1], angle)),
        normals: cells.map(([angle, r]) => radial(angle, ringNormals[r][0], ringNormals[r][1])),
        uvs: cells.map(([, r, u]) => [u, shape.profile[r][0]]),
        part,
        center: point(),
      });
    }
  }
  const { fins } = shape;
  for (let fin = 0; fins && fin < fins.count; fin++) {
    const angle = (fin + 0.5) / fins.count * TAU;
    if (skip(angle, 0.5, true)) continue;
    const normal = radial(angle + Math.PI / 2, 1, 0);
    const inner = radius * fins.inner;
    const outer = radius * fins.reach;
    const [start, end] = fins.span.map((t) => (t - 0.5) * length);
    quads.push({
      corners: [at(start, inner, angle), at(end, inner, angle), at(end - length * 0.06, outer, angle), at(start + length * 0.04, outer, angle)],
      normals: [normal, normal, normal, normal],
      uvs: [[0, fins.span[0]], [0, fins.span[1]], [0.25, fins.span[1]], [0.25, fins.span[0]]],
      part: 2,
      center: point(),
    });
  }
  for (const rail of shape.rails ?? []) {
    const half = rail.width / 2;
    const out = radial(rail.angle, 1, 0);
    const side = radial(rail.angle + Math.PI / 2, 1, 0);
    const corner = (along: number, r: number, lift: number, shift: number) => {
      const p = at(along, r + lift, rail.angle);
      p.x += side.x * shift;
      p.y += side.y * shift;
      p.z += side.z * shift;
      return p;
    };
    const u = rail.angle / TAU;
    const faces: [Point3D, number, number, number, number][] = [
      [out, half, -half, half, half],
      [point(-out.x, -out.y, -out.z), -half, half, -half, -half],
      [side, half, half, -half, half],
      [point(-side.x, -side.y, -side.z), -half, -half, half, -half],
    ];
    for (const [normal, liftA, shiftA, liftB, shiftB] of faces) {
      quads.push({
        corners: [
          corner(rail.from, rail.radiusFrom, liftA, shiftA),
          corner(rail.to, rail.radiusTo, liftA, shiftA),
          corner(rail.to, rail.radiusTo, liftB, shiftB),
          corner(rail.from, rail.radiusFrom, liftB, shiftB),
        ],
        normals: [normal, normal, normal, normal],
        uvs: [[u, 0], [u, 1], [u + 0.02, 1], [u + 0.02, 0]],
        part: 0,
        center: point(),
      });
    }
  }
  for (const quad of quads) {
    quad.center = quad.corners.reduce((sum, c) => point(sum.x + c.x / 4, sum.y + c.y / 4, sum.z + c.z / 4), point());
  }

  const count = quads.length;
  const positions = new Float32Array(count * 8);
  const uvs = new Float32Array(count * 8);
  const normals = new Float32Array(count * 16);
  const indices = new Uint32Array(count * 6);
  quads.forEach((quad, q) => quad.uvs.forEach(([u, v], k) => uvs.set([u, v], (q * 4 + k) * 2)));
  const geometry = new Geometry({ attributes: { aPosition: positions, aUV: uvs, aNormal: normals }, indexBuffer: indices });

  const light = new Float32Array(3);
  const grid = new Float32Array([AROUND, shape.profile.length * 1.5, 0, look.damage]);
  const charge = rgba(look.charge ?? 0, 0);
  const uniforms = new UniformGroup({
    uHull: { value: rgba(look.hull, look.ambient), type: 'vec4<f32>' },
    uExhaust: { value: rgba(look.exhaust, look.exhaustStrength), type: 'vec4<f32>' },
    uIntake: { value: rgba(look.intake, look.intakeStrength), type: 'vec4<f32>' },
    uRadiator: { value: rgba(look.radiator, look.radiatorStrength), type: 'vec4<f32>' },
    uCharge: { value: charge, type: 'vec4<f32>' },
    uStar: { value: rgba(starColor, look.lights ? 1 : 0), type: 'vec4<f32>' },
    uLight: { value: light, type: 'vec3<f32>' },
    uGrid: { value: grid, type: 'vec4<f32>' },
    uRadius: { value: radius, type: 'f32' },
    uTime: { value: 0, type: 'f32' },
  });
  const shader = new Shader({ ...programs(), resources: { hullUniforms: uniforms } });
  const mesh = new Mesh<Geometry, Shader>({ geometry, shader });

  const depths = new Float32Array(count);
  const order = new Uint32Array(count);
  const projected: ProjectedPoint = { x: 0, y: 0, depth: 0, scale: 1 };
  const centre: ProjectedPoint = { x: 0, y: 0, depth: 0, scale: 1 };
  const view = point();
  const toStar = point();

  return {
    mesh,
    update(basis, time) {
      projectSystemPointWithBasis(origin, basis, centre);
      quads.forEach((quad, q) => {
        depths[q] = projectSystemPointWithBasis(quad.center, basis, projected).depth;
        order[q] = q;
        for (let k = 0; k < 4; k++) {
          projectSystemPointWithBasis(quad.corners[k], basis, projected);
          positions[(q * 4 + k) * 2] = projected.x;
          positions[(q * 4 + k) * 2 + 1] = projected.y;
          viewSpaceDirectionWithBasis(quad.normals[k], basis, view);
          normals.set([view.x, view.y, view.z, quad.part], (q * 4 + k) * 4);
        }
      });
      order.sort((a, b) => depths[a] - depths[b]);
      order.forEach((q, slot) => indices.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], slot * 6));
      geometry.getBuffer('aPosition').update();
      geometry.getBuffer('aNormal').update();
      geometry.indexBuffer.update();

      toStar.x = -origin.x;
      toStar.y = -origin.y;
      toStar.z = -origin.z;
      viewSpaceDirectionWithBasis(toStar, basis, view);
      light[0] = view.x;
      light[1] = view.y;
      light[2] = view.z;
      uniforms.uniforms.uRadius = radius * centre.scale;
      uniforms.uniforms.uTime = time;
      uniforms.update();
      mesh.zIndex = centre.depth;
      return centre;
    },
    setCharge(level) {
      charge[3] = level;
    },
    destroy() {
      mesh.destroy();
      geometry.destroy();
      shader.destroy();
    },
  };
}
