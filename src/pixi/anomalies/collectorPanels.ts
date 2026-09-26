import { Geometry, GlProgram, GpuProgram, Mesh, Shader, UniformGroup } from 'pixi.js';
import { projectSystemPointWithBasis, viewSpaceDirectionWithBasis, type Point3D, type ProjectedPoint, type ProjectionBasis } from '../projection';

export interface PanelLook {
  outline: 'rect' | 'disc' | 'hex';
  transmission: number;
  mirror: boolean;
  cells: number;
  aspect: number;
  face: number;
  reflectivity: number;
  hull: number;
  heat: number;
  heatStrength: number;
  lights: boolean;
  ambient: number;
}

export interface PanelInstance {
  center: Point3D;
  normal: Point3D;
  tangent: Point3D;
  bitangent: Point3D;
  size: number;
  seed: number;
  damage: number;
}

export interface PanelShader {
  shader: Shader;
  setTime(time: number): void;
  destroy(): void;
}

export interface PanelBatch {
  mesh: Mesh<Geometry, Shader>;
  write(panels: readonly PanelInstance[], order: ArrayLike<number>, count: number, basis: ProjectionBasis): void;
  destroy(): void;
}

const glVertex = `
in vec2 aPosition;
in vec2 aUV;
in vec4 aNormal;
in vec4 aLight;
in float aScale;
out vec2 vUV;
out vec4 vNormal;
out vec4 vLight;
out float vPixel;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec2 uResolution;

void main(void) {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
  vNormal = aNormal;
  vLight = aLight;
  float pixelsPerUnit = length((mvp * vec3(1.0, 0.0, 0.0)).xy * uResolution * 0.5);
  vPixel = 1.0 / max(pixelsPerUnit * aScale * max(abs(aNormal.z), 0.2), 0.001);
}`;

const glFragment = `
in vec2 vUV;
in vec4 vNormal;
in vec4 vLight;
in float vPixel;
out vec4 finalColor;

uniform vec4 uShape;
uniform vec4 uFace;
uniform vec4 uHull;
uniform vec4 uHeat;
uniform vec4 uStar;
uniform vec4 uFilm;
uniform float uTime;
uniform vec4 uColor;
uniform vec4 uWorldColorAlpha;

float hash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(vec3(i, 1.0));
  float b = hash(vec3(i + vec2(1.0, 0.0), 1.0));
  float c = hash(vec3(i + vec2(0.0, 1.0), 1.0));
  float d = hash(vec3(i + vec2(1.0, 1.0), 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

vec4 hexCell(vec2 p) {
  vec2 s = vec2(1.0, 1.7320508);
  vec2 ca = floor(p / s) + 0.5;
  vec2 cb = floor((p - vec2(0.5, 0.8660254)) / s) + 0.5;
  vec2 ha = p - ca * s;
  vec2 hb = p - (cb + 0.5) * s;
  float pickA = step(dot(ha, ha), dot(hb, hb));
  return mix(vec4(hb, cb + 0.5), vec4(ha, ca), pickA);
}

void main(void) {
  float aspect = uShape.w;
  vec2 q = vec2(vUV.x, vUV.y * aspect);
  float px = vPixel;
  float seed = vNormal.w;
  float damage = vLight.w;
  float cells = uShape.z;
  float mirror = uShape.y;

  float kind = uShape.x;
  float hexShape = step(1.5, kind);
  float rectOutline = min(1.0 - abs(q.x), aspect - abs(q.y));
  float hexOutline = 1.0 - max(dot(abs(q), vec2(0.5, 0.8660254)), abs(q.x)) * 1.1547005;
  float outline = mix(mix(rectOutline, 1.0 - length(q), step(0.5, kind)), hexOutline, hexShape);
  float tear = max(noise(q * 3.0 + seed * 17.0) - 0.35, 0.0) * damage * 1.2;
  float edge = outline - tear;
  float coverage = clamp(edge / px + 0.5, 0.0, 1.0);
  float cellPx = px * cells * 0.5;
  float detail = 1.0 - smoothstep(0.12, 0.35, cellPx);
  float fine = 1.0 - smoothstep(0.03, 0.1, px);

  vec2 grid = (q + vec2(1.0, aspect)) * cells * 0.5;
  vec2 rectCell = floor(grid);
  vec2 rectF = fract(grid);
  float rectEdge = min(min(rectF.x, 1.0 - rectF.x), min(rectF.y, 1.0 - rectF.y));
  vec4 hex = hexCell(q * cells * 0.5);
  float hexEdge = 0.5 - max(dot(abs(hex.xy), vec2(0.5, 0.8660254)), abs(hex.x));
  float hexCells = max(mirror, step(0.5, kind));
  float cellEdge = mix(rectEdge, hexEdge, hexCells);
  vec2 cellId = mix(rectCell, hex.zw, hexCells);

  float seam = (1.0 - smoothstep(0.05, 0.05 + cellPx, cellEdge)) * detail;
  float frame = (1.0 - smoothstep(0.06, 0.06 + px, outline)) * fine;
  float hubRadius = length(q);
  float hub = (1.0 - smoothstep(0.13, 0.13 + px, hubRadius)) * fine;
  float spokeAngle = atan(q.y, q.x) - 0.5235988;
  float folded = spokeAngle - 1.0471976 * floor(spokeAngle / 1.0471976 + 0.5);
  float spokeWidth = 0.035 * (1.0 - 0.5 * hubRadius);
  float spoke = (1.0 - smoothstep(spokeWidth, spokeWidth + px, hubRadius * abs(sin(folded)))) * hexShape * fine;

  float tone = hash(vec3(cellId, seed * 13.0 + 1.0));
  float chip = hash(vec3(cellId.yx + 7.0, seed * 5.0 + 3.0));
  float hole = step(chip, damage * 0.75) * detail * (1.0 - seam) * (1.0 - frame);

  vec3 normal = normalize(vNormal.xyz + vec3(0.0, 0.0, 0.0001));
  vec3 light = normalize(vLight.xyz + vec3(0.0, 0.0001, 0.0));
  float side = step(0.0, normal.z) * 2.0 - 1.0;
  vec3 facing = normal * side;
  float incidence = dot(facing, light);
  float lit = max(incidence, 0.0);
  float ambient = uStar.a;
  vec3 starlight = uStar.rgb;

  vec3 tilt = vec3(tone - 0.5, chip - 0.5, 0.0) * mix(0.16, 0.05, mirror) * detail;
  vec3 cellNormal = normalize(facing + tilt);
  vec3 halfway = normalize(light + vec3(0.0, 0.0, 1.0));
  float nh = max(dot(cellNormal, halfway), 0.0);
  float glint = pow(nh, mix(36.0, 180.0, mirror)) * mix(2.2, 7.0, mirror) + pow(nh, 5.0) * 0.2;
  vec3 metal = uHull.rgb * 2.6 + 0.06;

  vec3 cellColor = uFace.rgb * (0.72 + 0.56 * tone * detail + 0.28 * (1.0 - detail));
  vec3 collector = cellColor * (ambient + lit) * starlight;
  collector += starlight * glint * uFace.a * smoothstep(0.0, 0.08, incidence) * (1.0 - seam);
  collector = mix(collector, metal * (ambient + lit) * starlight, max(seam * 0.75, frame));

  float backLit = max(dot(normal, light), 0.0);
  float structure = max(max(spoke, frame), seam * 0.7);
  vec3 skeleton = uHull.rgb * (0.8 + 0.4 * tone * detail) * (ambient + lit) * starlight + uHeat.rgb * uHull.a * (1.0 - damage) * (0.4 + 0.6 * spoke);
  vec3 film = starlight * uFilm.x * backLit * (0.7 + 0.45 * tone * detail) * (1.0 - damage * 0.6) + cellColor * ambient;
  film += uHeat.rgb * uHull.a * 0.25 * (1.0 - damage) * smoothstep(0.0, 0.6, outline);
  vec3 radiator = mix(film, skeleton, structure);

  vec3 color = mix(radiator, collector, step(0.0, side));
  color = mix(color, uHull.rgb * 1.6 * (ambient + lit) * starlight, hub);
  float blink = step(0.93, fract(uTime * 0.45 + seed * 7.31));
  float beacon = 1.0 - smoothstep(0.0, max(0.05, px * 1.5), hubRadius);
  color += vec3(1.0, 0.4, 0.22) * blink * beacon * uHeat.a * (1.0 - damage) * (1.0 - smoothstep(0.04, 0.14, px));
  color *= 1.0 - damage * 0.55 * noise(q * 4.0 + seed * 3.0);

  float alpha = coverage * (1.0 - hole);
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

struct PanelUniforms {
  uShape: vec4<f32>,
  uFace: vec4<f32>,
  uHull: vec4<f32>,
  uHeat: vec4<f32>,
  uStar: vec4<f32>,
  uFilm: vec4<f32>,
  uTime: f32,
};

@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;
@group(2) @binding(0) var<uniform> panelUniforms: PanelUniforms;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) normal: vec4<f32>,
  @location(2) light: vec4<f32>,
  @location(3) pixel: f32,
};

fn hash(q: vec3<f32>) -> f32 {
  var p = fract(q * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

fn noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash(vec3<f32>(i, 1.0));
  let b = hash(vec3<f32>(i + vec2<f32>(1.0, 0.0), 1.0));
  let c = hash(vec3<f32>(i + vec2<f32>(0.0, 1.0), 1.0));
  let d = hash(vec3<f32>(i + vec2<f32>(1.0, 1.0), 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn hexCell(p: vec2<f32>) -> vec4<f32> {
  let s = vec2<f32>(1.0, 1.7320508);
  let ca = floor(p / s) + 0.5;
  let cb = floor((p - vec2<f32>(0.5, 0.8660254)) / s) + 0.5;
  let ha = p - ca * s;
  let hb = p - (cb + 0.5) * s;
  let pickA = step(dot(ha, ha), dot(hb, hb));
  return mix(vec4<f32>(hb, cb + 0.5), vec4<f32>(ha, ca), pickA);
}

@vertex
fn mainVertex(
  @location(0) aPosition: vec2<f32>,
  @location(1) aUV: vec2<f32>,
  @location(2) aNormal: vec4<f32>,
  @location(3) aLight: vec4<f32>,
  @location(4) aScale: f32,
) -> VSOutput {
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  let clip = mvp * vec3<f32>(aPosition, 1.0);
  let pixelsPerUnit = length((mvp * vec3<f32>(1.0, 0.0, 0.0)).xy * globalUniforms.uResolution * 0.5);
  let pixel = 1.0 / max(pixelsPerUnit * aScale * max(abs(aNormal.z), 0.2), 0.001);
  return VSOutput(vec4<f32>(clip.xy, 0.0, 1.0), aUV, aNormal, aLight, pixel);
}

@fragment
fn mainFragment(
  @location(0) vUV: vec2<f32>,
  @location(1) vNormal: vec4<f32>,
  @location(2) vLight: vec4<f32>,
  @location(3) vPixel: f32,
) -> @location(0) vec4<f32> {
  let u = panelUniforms;
  let aspect = u.uShape.w;
  let q = vec2<f32>(vUV.x, vUV.y * aspect);
  let px = vPixel;
  let seed = vNormal.w;
  let damage = vLight.w;
  let cells = u.uShape.z;
  let mirror = u.uShape.y;

  let kind = u.uShape.x;
  let hexShape = step(1.5, kind);
  let rectOutline = min(1.0 - abs(q.x), aspect - abs(q.y));
  let hexOutline = 1.0 - max(dot(abs(q), vec2<f32>(0.5, 0.8660254)), abs(q.x)) * 1.1547005;
  let outline = mix(mix(rectOutline, 1.0 - length(q), step(0.5, kind)), hexOutline, hexShape);
  let tear = max(noise(q * 3.0 + seed * 17.0) - 0.35, 0.0) * damage * 1.2;
  let edge = outline - tear;
  let coverage = clamp(edge / px + 0.5, 0.0, 1.0);
  let cellPx = px * cells * 0.5;
  let detail = 1.0 - smoothstep(0.12, 0.35, cellPx);
  let fine = 1.0 - smoothstep(0.03, 0.1, px);

  let grid = (q + vec2<f32>(1.0, aspect)) * cells * 0.5;
  let rectCell = floor(grid);
  let rectF = fract(grid);
  let rectEdge = min(min(rectF.x, 1.0 - rectF.x), min(rectF.y, 1.0 - rectF.y));
  let hex = hexCell(q * cells * 0.5);
  let hexEdge = 0.5 - max(dot(abs(hex.xy), vec2<f32>(0.5, 0.8660254)), abs(hex.x));
  let hexCells = max(mirror, step(0.5, kind));
  let cellEdge = mix(rectEdge, hexEdge, hexCells);
  let cellId = mix(rectCell, hex.zw, hexCells);

  let seam = (1.0 - smoothstep(0.05, 0.05 + cellPx, cellEdge)) * detail;
  let frame = (1.0 - smoothstep(0.06, 0.06 + px, outline)) * fine;
  let hubRadius = length(q);
  let hub = (1.0 - smoothstep(0.13, 0.13 + px, hubRadius)) * fine;
  let spokeAngle = atan2(q.y, q.x) - 0.5235988;
  let folded = spokeAngle - 1.0471976 * floor(spokeAngle / 1.0471976 + 0.5);
  let spokeWidth = 0.035 * (1.0 - 0.5 * hubRadius);
  let spoke = (1.0 - smoothstep(spokeWidth, spokeWidth + px, hubRadius * abs(sin(folded)))) * hexShape * fine;

  let tone = hash(vec3<f32>(cellId, seed * 13.0 + 1.0));
  let chip = hash(vec3<f32>(cellId.yx + 7.0, seed * 5.0 + 3.0));
  let hole = step(chip, damage * 0.75) * detail * (1.0 - seam) * (1.0 - frame);

  let normal = normalize(vNormal.xyz + vec3<f32>(0.0, 0.0, 0.0001));
  let light = normalize(vLight.xyz + vec3<f32>(0.0, 0.0001, 0.0));
  let side = step(0.0, normal.z) * 2.0 - 1.0;
  let facing = normal * side;
  let incidence = dot(facing, light);
  let lit = max(incidence, 0.0);
  let ambient = u.uStar.a;
  let starlight = u.uStar.rgb;

  let tilt = vec3<f32>(tone - 0.5, chip - 0.5, 0.0) * mix(0.16, 0.05, mirror) * detail;
  let cellNormal = normalize(facing + tilt);
  let halfway = normalize(light + vec3<f32>(0.0, 0.0, 1.0));
  let nh = max(dot(cellNormal, halfway), 0.0);
  let glint = pow(nh, mix(36.0, 180.0, mirror)) * mix(2.2, 7.0, mirror) + pow(nh, 5.0) * 0.2;
  let metal = u.uHull.rgb * 2.6 + 0.06;

  let cellColor = u.uFace.rgb * (0.72 + 0.56 * tone * detail + 0.28 * (1.0 - detail));
  var collector = cellColor * (ambient + lit) * starlight;
  collector += starlight * glint * u.uFace.a * smoothstep(0.0, 0.08, incidence) * (1.0 - seam);
  collector = mix(collector, metal * (ambient + lit) * starlight, max(seam * 0.75, frame));

  let backLit = max(dot(normal, light), 0.0);
  let structure = max(max(spoke, frame), seam * 0.7);
  let skeleton = u.uHull.rgb * (0.8 + 0.4 * tone * detail) * (ambient + lit) * starlight + u.uHeat.rgb * u.uHull.a * (1.0 - damage) * (0.4 + 0.6 * spoke);
  var film = starlight * u.uFilm.x * backLit * (0.7 + 0.45 * tone * detail) * (1.0 - damage * 0.6) + cellColor * ambient;
  film += u.uHeat.rgb * u.uHull.a * 0.25 * (1.0 - damage) * smoothstep(0.0, 0.6, outline);
  let radiator = mix(film, skeleton, structure);

  var color = mix(radiator, collector, step(0.0, side));
  color = mix(color, u.uHull.rgb * 1.6 * (ambient + lit) * starlight, hub);
  let blink = step(0.93, fract(u.uTime * 0.45 + seed * 7.31));
  let beacon = 1.0 - smoothstep(0.0, max(0.05, px * 1.5), hubRadius);
  color += vec3<f32>(1.0, 0.4, 0.22) * blink * beacon * u.uHeat.a * (1.0 - damage) * (1.0 - smoothstep(0.04, 0.14, px));
  color *= 1.0 - damage * 0.55 * noise(q * 4.0 + seed * 3.0);

  let alpha = coverage * (1.0 - hole);
  return vec4<f32>(color * alpha, alpha) * localUniforms.uColor.a * globalUniforms.uWorldColorAlpha.a;
}`;

let glProgram: GlProgram | null = null;
let gpuProgram: GpuProgram | null = null;

function programs() {
  glProgram ??= GlProgram.from({ vertex: glVertex, fragment: glFragment, name: 'collector-panel' });
  gpuProgram ??= GpuProgram.from({
    vertex: { source: wgslSource, entryPoint: 'mainVertex' },
    fragment: { source: wgslSource, entryPoint: 'mainFragment' },
  });
  return { glProgram, gpuProgram };
}

export function rgba(color: number, w: number): Float32Array {
  return new Float32Array([((color >> 16) & 0xff) / 255, ((color >> 8) & 0xff) / 255, (color & 0xff) / 255, w]);
}

export function createPanelShader(look: PanelLook, starColor: number): PanelShader {
  const uniforms = new UniformGroup({
    uShape: { value: new Float32Array([OUTLINES[look.outline], look.mirror ? 1 : 0, look.cells, look.aspect]), type: 'vec4<f32>' },
    uFace: { value: rgba(look.face, look.reflectivity), type: 'vec4<f32>' },
    uHull: { value: rgba(look.hull, look.heatStrength), type: 'vec4<f32>' },
    uHeat: { value: rgba(look.heat, look.lights ? 1 : 0), type: 'vec4<f32>' },
    uStar: { value: rgba(starColor, look.ambient), type: 'vec4<f32>' },
    uFilm: { value: new Float32Array([look.transmission, 0, 0, 0]), type: 'vec4<f32>' },
    uTime: { value: 0, type: 'f32' },
  });
  const shader = new Shader({ ...programs(), resources: { panelUniforms: uniforms } });
  return {
    shader,
    setTime(time) {
      uniforms.uniforms.uTime = time;
      uniforms.update();
    },
    destroy() {
      shader.destroy();
    },
  };
}

const OUTLINES = { rect: 0, disc: 1, hex: 2 } as const;

const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;

export function createPanelBatch(capacity: number, shader: Shader, aspect: number): PanelBatch {
  const positions = new Float32Array(capacity * 8);
  const uvs = new Float32Array(capacity * 8);
  const normals = new Float32Array(capacity * 16);
  const lights = new Float32Array(capacity * 16);
  const scales = new Float32Array(capacity * 4);
  const indices = new Uint32Array(capacity * 6);
  for (let i = 0; i < capacity; i++) {
    CORNERS.forEach(([u, v], k) => uvs.set([u, v], (i * 4 + k) * 2));
    indices.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  const geometry = new Geometry({
    attributes: { aPosition: positions, aUV: uvs, aNormal: normals, aLight: lights, aScale: scales },
    indexBuffer: indices,
  });
  const mesh = new Mesh<Geometry, Shader>({ geometry, shader });

  const corner: Point3D = { x: 0, y: 0, z: 0 };
  const projected: ProjectedPoint = { x: 0, y: 0, depth: 0, scale: 1 };
  const view: Point3D = { x: 0, y: 0, z: 0 };
  const toStar: Point3D = { x: 0, y: 0, z: 0 };

  return {
    mesh,
    write(panels, order, count, basis) {
      for (let slot = 0; slot < capacity; slot++) {
        if (slot >= count) {
          positions.fill(0, slot * 8, slot * 8 + 8);
          continue;
        }
        const panel = panels[order[slot]];
        const { center, normal, tangent, bitangent, size } = panel;
        const height = size * aspect;
        for (let k = 0; k < 4; k++) {
          const [u, v] = CORNERS[k];
          corner.x = center.x + tangent.x * size * u + bitangent.x * height * v;
          corner.y = center.y + tangent.y * size * u + bitangent.y * height * v;
          corner.z = center.z + tangent.z * size * u + bitangent.z * height * v;
          projectSystemPointWithBasis(corner, basis, projected);
          positions[(slot * 4 + k) * 2] = projected.x;
          positions[(slot * 4 + k) * 2 + 1] = projected.y;
        }
        const scale = size * projected.scale;
        viewSpaceDirectionWithBasis(normal, basis, view);
        toStar.x = -center.x;
        toStar.y = -center.y;
        toStar.z = -center.z;
        viewSpaceDirectionWithBasis(toStar, basis, toStar);
        for (let k = 0; k < 4; k++) {
          const vertex = slot * 4 + k;
          normals.set([view.x, view.y, view.z, panel.seed], vertex * 4);
          lights.set([toStar.x, toStar.y, toStar.z, panel.damage], vertex * 4);
          scales[vertex] = scale;
        }
      }
      geometry.getBuffer('aPosition').update();
      geometry.getBuffer('aNormal').update();
      geometry.getBuffer('aLight').update();
      geometry.getBuffer('aScale').update();
    },
    destroy() {
      mesh.destroy();
      geometry.destroy();
    },
  };
}
