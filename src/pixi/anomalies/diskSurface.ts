import { Geometry, GlProgram, GpuProgram, Shader, type Texture, UniformGroup } from 'pixi.js';

export type DiskLook = {
  bump: number;
  ambient: number;
  haze: number;
  hazeColor: number;
  cloudColor: number;
  cloudShadow: number;
};

export type DiskSurfaceShader = {
  shader: Shader;
  setView: (sinTilt: number) => void;
  destroy: () => void;
};

const GRAIN_FREQUENCY = 900;
const GRAIN_STRENGTH = 0.14;

const glVertex = `
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
out float vGrainFade;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec2 uResolution;
uniform float uGrainCell;

void main(void) {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
  float pixelsPerUnit = length((mvp * vec3(1.0, 0.0, 0.0)).xy * uResolution * 0.5);
  vGrainFade = smoothstep(1.2, 3.0, pixelsPerUnit * uGrainCell);
}`;

const glFragment = `
in vec2 vUV;
in float vGrainFade;
out vec4 finalColor;

uniform sampler2D uAlbedo;
uniform sampler2D uDetail;
uniform vec4 uStar;
uniform vec4 uLook;
uniform vec4 uHaze;
uniform vec4 uCloud;
uniform vec2 uTexel;
uniform vec4 uColor;
uniform vec4 uWorldColorAlpha;

float grainHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float grainNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(grainHash(i), grainHash(i + vec2(1.0, 0.0)), u.x), mix(grainHash(i + vec2(0.0, 1.0)), grainHash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main(void) {
  float t = vUV.y;
  vec4 albedoSample = texture(uAlbedo, vUV);
  vec3 albedo = albedoSample.rgb / max(albedoSample.a, 0.001);
  vec4 detail = texture(uDetail, vUV);
  float slopeU = texture(uDetail, vUV + vec2(uTexel.x, 0.0)).r - texture(uDetail, vUV - vec2(uTexel.x, 0.0)).r;
  float slopeR = texture(uDetail, vUV + vec2(0.0, uTexel.y)).r - texture(uDetail, vUV - vec2(0.0, uTexel.y)).r;
  float shadowCloud = texture(uDetail, vUV - vec2(0.0, uCloud.a)).g;

  float radius = 1.0 + t * uStar.a;
  float bearing = vUV.x * 6.2831853;
  vec2 plane = vec2(cos(bearing), sin(bearing)) * radius * ${GRAIN_FREQUENCY.toFixed(1)};
  float grainFade = vGrainFade;
  float grain = (grainNoise(plane) * 0.6 + grainNoise(plane * 2.37 + 17.0) * 0.4 - 0.5) * grainFade;
  albedo *= 1.0 + grain * ${GRAIN_STRENGTH.toFixed(2)};
  float elevation = uHaze.a / radius;
  vec3 light = normalize(vec3(0.0, elevation, -1.0));
  vec3 normal = normalize(vec3(-slopeU * uLook.x, 1.0, -slopeR * uLook.x));
  float direct = clamp(dot(normal, light) / light.y, 0.0, 3.0);
  float irradiance = mix(1.25, 0.42, smoothstep(0.05, 1.0, t));
  vec3 sunlight = mix(vec3(1.0), uStar.rgb, 0.3 + 0.4 * (1.0 - smoothstep(0.0, 0.3, t)));

  float cloud = detail.g;
  float shade = direct * (1.0 - shadowCloud * 0.55 * (1.0 - cloud));
  vec3 surface = albedo * (uLook.y + irradiance * shade) * sunlight;
  vec3 cloudColor = uCloud.rgb * (uLook.y + irradiance * 1.05) * sunlight;
  surface = mix(surface, cloudColor, cloud * 0.85);

  float haze = uLook.z * (0.35 + 0.65 * uLook.w * uLook.w);
  surface = mix(surface, uHaze.rgb * irradiance * sunlight, haze);
  float rim = 1.0 - smoothstep(0.0, 0.012, t);
  surface += uStar.rgb * rim * 0.25;

  finalColor = vec4(surface, 1.0) * uColor.a * uWorldColorAlpha.a;
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

struct DiskUniforms {
  uStar: vec4<f32>,
  uLook: vec4<f32>,
  uHaze: vec4<f32>,
  uCloud: vec4<f32>,
  uTexel: vec2<f32>,
  uGrainCell: f32,
};

@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;
@group(2) @binding(0) var<uniform> diskUniforms: DiskUniforms;
@group(2) @binding(1) var uAlbedo: texture_2d<f32>;
@group(2) @binding(2) var uAlbedoSampler: sampler;
@group(2) @binding(3) var uDetail: texture_2d<f32>;
@group(2) @binding(4) var uDetailSampler: sampler;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) grainFade: f32,
};

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>, @location(1) aUV: vec2<f32>) -> VSOutput {
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  let clip = mvp * vec3<f32>(aPosition, 1.0);
  let pixelsPerUnit = length((mvp * vec3<f32>(1.0, 0.0, 0.0)).xy * globalUniforms.uResolution * 0.5);
  let grainFade = smoothstep(1.2, 3.0, pixelsPerUnit * diskUniforms.uGrainCell);
  return VSOutput(vec4<f32>(clip.xy, 0.0, 1.0), aUV, grainFade);
}

fn grainHash(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn grainNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(grainHash(i), grainHash(i + vec2<f32>(1.0, 0.0)), u.x), mix(grainHash(i + vec2<f32>(0.0, 1.0)), grainHash(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}

@fragment
fn mainFragment(@location(0) vUV: vec2<f32>, @location(1) vGrainFade: f32) -> @location(0) vec4<f32> {
  let star = diskUniforms.uStar;
  let look = diskUniforms.uLook;
  let hazeUniform = diskUniforms.uHaze;
  let cloudUniform = diskUniforms.uCloud;
  let texel = diskUniforms.uTexel;
  let t = vUV.y;
  let albedoSample = textureSample(uAlbedo, uAlbedoSampler, vUV);
  let radius = 1.0 + t * star.a;
  let bearing = vUV.x * 6.2831853;
  let plane = vec2<f32>(cos(bearing), sin(bearing)) * radius * ${GRAIN_FREQUENCY.toFixed(1)};
  let grainFade = vGrainFade;
  let grain = (grainNoise(plane) * 0.6 + grainNoise(plane * 2.37 + 17.0) * 0.4 - 0.5) * grainFade;
  let albedo = albedoSample.rgb / max(albedoSample.a, 0.001) * (1.0 + grain * ${GRAIN_STRENGTH.toFixed(2)});
  let detail = textureSample(uDetail, uDetailSampler, vUV);
  let slopeU = textureSample(uDetail, uDetailSampler, vUV + vec2<f32>(texel.x, 0.0)).r - textureSample(uDetail, uDetailSampler, vUV - vec2<f32>(texel.x, 0.0)).r;
  let slopeR = textureSample(uDetail, uDetailSampler, vUV + vec2<f32>(0.0, texel.y)).r - textureSample(uDetail, uDetailSampler, vUV - vec2<f32>(0.0, texel.y)).r;
  let shadowCloud = textureSample(uDetail, uDetailSampler, vUV - vec2<f32>(0.0, cloudUniform.a)).g;

  let elevation = hazeUniform.a / radius;
  let light = normalize(vec3<f32>(0.0, elevation, -1.0));
  let normal = normalize(vec3<f32>(-slopeU * look.x, 1.0, -slopeR * look.x));
  let direct = clamp(dot(normal, light) / light.y, 0.0, 3.0);
  let irradiance = mix(1.25, 0.42, smoothstep(0.05, 1.0, t));
  let sunlight = mix(vec3<f32>(1.0), star.rgb, 0.3 + 0.4 * (1.0 - smoothstep(0.0, 0.3, t)));

  let cloud = detail.g;
  let shade = direct * (1.0 - shadowCloud * 0.55 * (1.0 - cloud));
  var surface = albedo * (look.y + irradiance * shade) * sunlight;
  let cloudColor = cloudUniform.rgb * (look.y + irradiance * 1.05) * sunlight;
  surface = mix(surface, cloudColor, cloud * 0.85);

  let haze = look.z * (0.35 + 0.65 * look.w * look.w);
  surface = mix(surface, hazeUniform.rgb * irradiance * sunlight, haze);
  let rim = 1.0 - smoothstep(0.0, 0.012, t);
  surface += star.rgb * rim * 0.25;

  return vec4<f32>(surface, 1.0) * localUniforms.uColor.a * globalUniforms.uWorldColorAlpha.a;
}`;

let glProgram: GlProgram | null = null;
let gpuProgram: GpuProgram | null = null;

function programs() {
  glProgram ??= GlProgram.from({ vertex: glVertex, fragment: glFragment, name: 'alderson-disk' });
  gpuProgram ??= GpuProgram.from({
    vertex: { source: wgslSource, entryPoint: 'mainVertex' },
    fragment: { source: wgslSource, entryPoint: 'mainFragment' },
  });
  return { glProgram, gpuProgram };
}

function rgb(color: number): [number, number, number] {
  return [((color >> 16) & 0xff) / 255, ((color >> 8) & 0xff) / 255, (color & 0xff) / 255];
}

export function createDiskGeometry(columns: number, rows: number, uvAt: (column: number, row: number) => [number, number]): Geometry {
  const positions = new Float32Array((columns + 1) * (rows + 1) * 2);
  const uvs = new Float32Array(positions.length);
  const indices = new Uint32Array(columns * rows * 6);
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      uvs.set(uvAt(column, row), (row * (columns + 1) + column) * 2);
    }
  }
  let index = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column;
      const b = a + columns + 1;
      indices.set([a, a + 1, b + 1, a, b + 1, b], index);
      index += 6;
    }
  }
  return new Geometry({ attributes: { aPosition: positions, aUV: uvs }, indexBuffer: indices });
}

export function createDiskSurfaceShader(
  albedo: Texture,
  detail: Texture,
  look: DiskLook,
  starColor: number,
  innerRadius: number,
  sunToInner: number,
  spanToInner: number,
): DiskSurfaceShader {
  const view = new Float32Array([look.bump, look.ambient, look.haze, 0]);
  const diskUniforms = new UniformGroup({
    uStar: { value: new Float32Array([...rgb(starColor), spanToInner]), type: 'vec4<f32>' },
    uLook: { value: view, type: 'vec4<f32>' },
    uHaze: { value: new Float32Array([...rgb(look.hazeColor), sunToInner]), type: 'vec4<f32>' },
    uCloud: { value: new Float32Array([...rgb(look.cloudColor), look.cloudShadow]), type: 'vec4<f32>' },
    uTexel: { value: new Float32Array([1.5 / detail.source.width, 1.5 / detail.source.height]), type: 'vec2<f32>' },
    uGrainCell: { value: innerRadius / GRAIN_FREQUENCY, type: 'f32' },
  });
  const shader = new Shader({
    ...programs(),
    resources: {
      diskUniforms,
      uAlbedo: albedo.source,
      uAlbedoSampler: albedo.source.style,
      uDetail: detail.source,
      uDetailSampler: detail.source.style,
    },
  });

  return {
    shader,
    setView(sinTilt) {
      view[3] = sinTilt;
      diskUniforms.update();
    },
    destroy() {
      shader.destroy();
    },
  };
}
