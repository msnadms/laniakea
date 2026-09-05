import { Filter, GlProgram, GpuProgram, UniformGroup } from 'pixi.js';
import type { Point3D } from './projection';

const glVertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vFilterCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord(void) {
  return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void) {
  gl_Position = filterVertexPosition();
  vTextureCoord = filterTextureCoord();
  vFilterCoord = aPosition;
}`;

const glFragment = `
in vec2 vTextureCoord;
in vec2 vFilterCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec3 uLightDirection;
uniform float uAmbient;
uniform float uRimStrength;

void main(void) {
  vec4 sampleColor = texture(uTexture, vTextureCoord);
  if (sampleColor.a <= 0.0) {
    finalColor = sampleColor;
    return;
  }
  vec2 disc = vFilterCoord * 2.0 - 1.0;
  float radiusSquared = min(1.0, dot(disc, disc));
  vec3 normal = vec3(disc, sqrt(max(0.0, 1.0 - radiusSquared)));
  float diffuse = max(0.0, dot(normal, uLightDirection));
  float illumination = uAmbient + (1.0 - uAmbient) * diffuse;
  float rim = pow(1.0 - normal.z, 2.4) * uRimStrength * (0.35 + 0.65 * diffuse);
  float specular = pow(diffuse, 18.0) * 0.08;
  vec3 color = sampleColor.rgb / sampleColor.a;
  color = color * illumination + vec3(0.35, 0.65, 1.0) * rim + vec3(specular);
  finalColor = vec4(color * sampleColor.a, sampleColor.a);
}`;

const wgslSource = `
struct GlobalFilterUniforms {
  uInputSize: vec4<f32>,
  uInputPixel: vec4<f32>,
  uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>,
  uGlobalFrame: vec4<f32>,
  uOutputTexture: vec4<f32>,
};

struct LightingUniforms {
  uLightDirection: vec3<f32>,
  uAmbient: f32,
  uRimStrength: f32,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> lightingUniforms: LightingUniforms;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) filterCoord: vec2<f32>,
};

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
  var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
  position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
  let uv = aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);
  return VSOutput(vec4(position, 0.0, 1.0), uv, aPosition);
}

@fragment
fn mainFragment(
  @location(0) uv: vec2<f32>,
  @location(1) filterCoord: vec2<f32>,
) -> @location(0) vec4<f32> {
  let sampleColor = textureSample(uTexture, uSampler, uv);
  if (sampleColor.a <= 0.0) { return sampleColor; }
  let disc = filterCoord * 2.0 - 1.0;
  let radiusSquared = min(1.0, dot(disc, disc));
  let normal = vec3(disc, sqrt(max(0.0, 1.0 - radiusSquared)));
  let diffuse = max(0.0, dot(normal, lightingUniforms.uLightDirection));
  let illumination = lightingUniforms.uAmbient + (1.0 - lightingUniforms.uAmbient) * diffuse;
  let rim = pow(1.0 - normal.z, 2.4) * lightingUniforms.uRimStrength * (0.35 + 0.65 * diffuse);
  let specular = pow(diffuse, 18.0) * 0.08;
  var color = sampleColor.rgb / sampleColor.a;
  color = color * illumination + vec3(0.35, 0.65, 1.0) * rim + vec3(specular);
  return vec4(color * sampleColor.a, sampleColor.a);
}`;

export class SystemBodyLightingFilter extends Filter {
  private readonly lightDirection: Float32Array;

  constructor(ambient: number, rimStrength: number) {
    const lightDirection = new Float32Array([0, 0, 1]);
    const lightingUniforms = new UniformGroup({
      uLightDirection: { value: lightDirection, type: 'vec3<f32>' },
      uAmbient: { value: ambient, type: 'f32' },
      uRimStrength: { value: rimStrength, type: 'f32' },
    });
    super({
      glProgram: GlProgram.from({ vertex: glVertex, fragment: glFragment, name: 'system-body-lighting' }),
      gpuProgram: GpuProgram.from({
        vertex: { source: wgslSource, entryPoint: 'mainVertex' },
        fragment: { source: wgslSource, entryPoint: 'mainFragment' },
      }),
      resources: { lightingUniforms },
      antialias: 'off',
    });
    this.lightDirection = lightDirection;
  }

  setLightDirection(direction: Point3D) {
    this.lightDirection[0] = direction.x;
    this.lightDirection[1] = direction.y;
    this.lightDirection[2] = direction.z;
  }
}
