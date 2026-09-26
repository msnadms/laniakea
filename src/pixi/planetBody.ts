import { CanvasSource, Geometry, GlProgram, GpuProgram, Mesh, Shader, Texture, UniformGroup } from 'pixi.js';
import type { Point3D } from './projection';

export const BODY_HALO_EXTENT = 1.25;

export type BodyLook = {
  bump: number;
  specular: number;
  limbDarkening: number;
  ambient: number;
  atmosphere: number;
  atmosphereStrength: number;
};

export type PlanetBody = {
  mesh: Mesh<Geometry, Shader>;
  setLight: (direction: Point3D) => void;
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

uniform sampler2D uAlbedo;
uniform sampler2D uDetail;
uniform vec3 uLight;
uniform vec4 uLook;
uniform vec4 uAtmosphere;
uniform float uTexel;
uniform vec4 uColor;
uniform vec4 uWorldColorAlpha;

void main(void) {
  float radius = length(vDisc);
  vec3 light = normalize(uLight + vec3(0.0, 0.0, 0.0001));
  float coverage = clamp((1.0 - radius) / vEdge + 0.5, 0.0, 1.0);

  vec2 disc = vDisc / max(radius, 1.0);
  float depth = sqrt(max(0.0, 1.0 - dot(disc, disc)));
  vec3 normal = vec3(disc, depth);
  vec2 uv = disc * 0.492 + 0.5;
  vec4 albedoSample = texture(uAlbedo, uv);
  vec3 albedo = albedoSample.rgb / max(albedoSample.a, 0.001);
  vec4 detail = texture(uDetail, uv);
  float slopeX = texture(uDetail, uv + vec2(uTexel, 0.0)).r - texture(uDetail, uv - vec2(uTexel, 0.0)).r;
  float slopeY = texture(uDetail, uv + vec2(0.0, uTexel)).r - texture(uDetail, uv - vec2(0.0, uTexel)).r;
  vec3 bumped = normalize(normal - vec3(slopeX, slopeY, 0.0) * uLook.x * depth);

  float facing = dot(normal, light);
  float day = smoothstep(-0.12, 0.18, facing);
  float diffuse = max(dot(bumped, light), 0.0) * day;
  float limb = mix(1.0, sqrt(depth), uLook.z);
  vec3 surface = albedo * (uLook.w + diffuse * 1.15) * limb;

  float cloud = detail.g;
  float cloudLight = max(facing, 0.0) * day;
  surface = mix(surface, vec3(0.95) * (uLook.w + cloudLight * 1.1), cloud * 0.9);

  vec3 halfway = normalize(light + vec3(0.0, 0.0, 1.0));
  float glint = pow(max(dot(normal, halfway), 0.0), 110.0) * uLook.y * detail.b * day * (1.0 - cloud);
  surface += vec3(1.0, 0.95, 0.85) * glint;

  float fresnel = pow(1.0 - depth, 2.2);
  surface += uAtmosphere.rgb * uAtmosphere.a * fresnel * smoothstep(-0.3, 0.4, facing) * 0.9;

  float halo = 0.0;
  if (radius > 1.0 - vEdge) {
    float height = clamp((radius - 1.0) / (${BODY_HALO_EXTENT.toFixed(2)} - 1.03), 0.0, 1.0);
    vec2 outward = vDisc / max(radius, 0.0001);
    float lit = smoothstep(-0.45, 0.6, dot(outward, light.xy) + light.z * 0.5);
    float backlit = max(-light.z, 0.0) * 0.8;
    halo = pow(1.0 - height, 3.0) * uAtmosphere.a * (lit + backlit);
  }

  vec3 haloColor = uAtmosphere.rgb * halo * (1.0 - coverage);
  vec4 color = vec4(surface * coverage + haloColor, coverage + halo * 0.35 * (1.0 - coverage));
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

struct BodyUniforms {
  uLight: vec3<f32>,
  uLook: vec4<f32>,
  uAtmosphere: vec4<f32>,
  uTexel: f32,
};

@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;
@group(2) @binding(0) var<uniform> bodyUniforms: BodyUniforms;
@group(2) @binding(1) var uAlbedo: texture_2d<f32>;
@group(2) @binding(2) var uAlbedoSampler: sampler;
@group(2) @binding(3) var uDetail: texture_2d<f32>;
@group(2) @binding(4) var uDetailSampler: sampler;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) disc: vec2<f32>,
  @location(1) edge: f32,
};

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  let clip = mvp * vec3<f32>(aPosition, 1.0);
  let axis = (mvp * vec3<f32>(1.0, 0.0, 0.0)).xy * globalUniforms.uResolution * 0.5;
  return VSOutput(vec4<f32>(clip.xy, 0.0, 1.0), aPosition, 1.5 / max(length(axis), 1.0));
}

@fragment
fn mainFragment(@location(0) vDisc: vec2<f32>, @location(1) vEdge: f32) -> @location(0) vec4<f32> {
  let radius = length(vDisc);
  let light = normalize(bodyUniforms.uLight + vec3<f32>(0.0, 0.0, 0.0001));
  let look = bodyUniforms.uLook;
  let atmosphere = bodyUniforms.uAtmosphere;
  let texel = bodyUniforms.uTexel;
  let coverage = clamp((1.0 - radius) / vEdge + 0.5, 0.0, 1.0);

  let disc = vDisc / max(radius, 1.0);
  let depth = sqrt(max(0.0, 1.0 - dot(disc, disc)));
  let normal = vec3<f32>(disc, depth);
  let uv = disc * 0.492 + 0.5;
  let albedoSample = textureSample(uAlbedo, uAlbedoSampler, uv);
  let albedo = albedoSample.rgb / max(albedoSample.a, 0.001);
  let detail = textureSample(uDetail, uDetailSampler, uv);
  let slopeX = textureSample(uDetail, uDetailSampler, uv + vec2<f32>(texel, 0.0)).r - textureSample(uDetail, uDetailSampler, uv - vec2<f32>(texel, 0.0)).r;
  let slopeY = textureSample(uDetail, uDetailSampler, uv + vec2<f32>(0.0, texel)).r - textureSample(uDetail, uDetailSampler, uv - vec2<f32>(0.0, texel)).r;
  let bumped = normalize(normal - vec3<f32>(slopeX, slopeY, 0.0) * look.x * depth);

  let facing = dot(normal, light);
  let day = smoothstep(-0.12, 0.18, facing);
  let diffuse = max(dot(bumped, light), 0.0) * day;
  let limb = mix(1.0, sqrt(depth), look.z);
  var color = albedo * (look.w + diffuse * 1.15) * limb;

  let cloud = detail.g;
  let cloudLight = max(facing, 0.0) * day;
  color = mix(color, vec3<f32>(0.95) * (look.w + cloudLight * 1.1), cloud * 0.9);

  let halfway = normalize(light + vec3<f32>(0.0, 0.0, 1.0));
  let glint = pow(max(dot(normal, halfway), 0.0), 110.0) * look.y * detail.b * day * (1.0 - cloud);
  color += vec3<f32>(1.0, 0.95, 0.85) * glint;

  let fresnel = pow(1.0 - depth, 2.2);
  color += atmosphere.rgb * atmosphere.a * fresnel * smoothstep(-0.3, 0.4, facing) * 0.9;

  var halo = 0.0;
  if (radius > 1.0 - vEdge) {
    let height = clamp((radius - 1.0) / (${BODY_HALO_EXTENT.toFixed(2)} - 1.03), 0.0, 1.0);
    let outward = vDisc / max(radius, 0.0001);
    let lit = smoothstep(-0.45, 0.6, dot(outward, light.xy) + light.z * 0.5);
    let backlit = max(-light.z, 0.0) * 0.8;
    halo = pow(1.0 - height, 3.0) * atmosphere.a * (lit + backlit);
  }

  let haloColor = atmosphere.rgb * halo * (1.0 - coverage);
  let result = vec4<f32>(color * coverage + haloColor, coverage + halo * 0.35 * (1.0 - coverage));
  return result * localUniforms.uColor.a * globalUniforms.uWorldColorAlpha.a;
}`;

let glProgram: GlProgram | null = null;
let gpuProgram: GpuProgram | null = null;

function programs() {
  glProgram ??= GlProgram.from({ vertex: glVertex, fragment: glFragment, name: 'planet-body' });
  gpuProgram ??= GpuProgram.from({
    vertex: { source: wgslSource, entryPoint: 'mainVertex' },
    fragment: { source: wgslSource, entryPoint: 'mainFragment' },
  });
  return { glProgram, gpuProgram };
}

export function createBodyGeometry(): Geometry {
  const extent = BODY_HALO_EXTENT;
  return new Geometry({
    attributes: { aPosition: new Float32Array([-extent, -extent, extent, -extent, extent, extent, -extent, extent]) },
    indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });
}

export function createSurfaceTexture(canvas: HTMLCanvasElement): Texture {
  return new Texture({ source: new CanvasSource({ resource: canvas, autoGenerateMipmaps: true }) });
}

export function createPlanetBody(geometry: Geometry, albedo: Texture, detail: Texture, look: BodyLook, radius: number): PlanetBody {
  const light = new Float32Array([1, 0, 0]);
  const atmosphere = look.atmosphere;
  const bodyUniforms = new UniformGroup({
    uLight: { value: light, type: 'vec3<f32>' },
    uLook: { value: new Float32Array([look.bump, look.specular, look.limbDarkening, look.ambient]), type: 'vec4<f32>' },
    uAtmosphere: {
      value: new Float32Array([
        ((atmosphere >> 16) & 0xff) / 255,
        ((atmosphere >> 8) & 0xff) / 255,
        (atmosphere & 0xff) / 255,
        look.atmosphereStrength,
      ]),
      type: 'vec4<f32>',
    },
    uTexel: { value: 1.5 / detail.source.width, type: 'f32' },
  });
  const shader = new Shader({
    ...programs(),
    resources: {
      bodyUniforms,
      uAlbedo: albedo.source,
      uAlbedoSampler: albedo.source.style,
      uDetail: detail.source,
      uDetailSampler: detail.source.style,
    },
  });
  const mesh = new Mesh({ geometry, shader });
  mesh.scale.set(radius);
  mesh.eventMode = 'none';

  return {
    mesh,
    setLight(direction) {
      light[0] = direction.x;
      light[1] = direction.y;
      light[2] = direction.z;
      bodyUniforms.update();
    },
    destroy() {
      shader.destroy();
    },
  };
}
