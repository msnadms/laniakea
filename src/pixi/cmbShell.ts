import { Container, Filter, GlProgram, GpuProgram, RenderTexture, Sprite, Texture, UniformGroup } from 'pixi.js';
import type { Renderer, TextureSource } from 'pixi.js';
import { createRng } from '../game/galaxyGen';
import { CMB_COLD, CMB_FREQUENCY, CMB_OCTAVES, CMB_RESOLUTION, CMB_WARM, SKY_BASE_COLOR, UNIVERSE_RADIUS } from '../game/constants';
import type { FlyBasis } from './flyProjection';

export interface CmbShell {
  node: Container;
  render(width: number, height: number, basis: FlyBasis, glowMix: number): void;
  destroy(): void;
}

const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
out highp vec2 vPixel;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

void main(void)
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    vPixel = position;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    gl_Position = vec4(position, 0.0, 1.0);
    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}
`;

const fragment = `
in vec2 vTextureCoord;
in highp vec2 vPixel;

out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uGlowA;
uniform sampler2D uGlowB;
uniform vec4 uView;
uniform vec4 uFrame;
uniform vec4 uCamera;
uniform vec4 uSeed;
uniform vec4 uWarm;
uniform vec4 uCold;
uniform vec4 uBase;
uniform vec4 uGlow;

vec3 hash3(vec3 p)
{
    vec3 h = fract((floor(p) + uSeed.w) * vec3(0.1031, 0.1030, 0.0973));
    h += dot(h, h.yxz + 33.33);
    return fract((h.xxy + h.yxx) * h.zyx);
}

float valueNoise(vec3 p)
{
    vec3 i = floor(p);
    vec3 f = p - i;
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mix(hash3(i).x, hash3(i + vec3(1.0, 0.0, 0.0)).x, u.x),
            mix(hash3(i + vec3(0.0, 1.0, 0.0)).x, hash3(i + vec3(1.0, 1.0, 0.0)).x, u.x), u.y),
        mix(mix(hash3(i + vec3(0.0, 0.0, 1.0)).x, hash3(i + vec3(1.0, 0.0, 1.0)).x, u.x),
            mix(hash3(i + vec3(0.0, 1.0, 1.0)).x, hash3(i + vec3(1.0, 1.0, 1.0)).x, u.x), u.y),
        u.z);
}

float anisotropy(vec3 p)
{
    float sum = 0.0;
    float amp = 0.5;
    for (int o = 0; o < ${CMB_OCTAVES}; o++) {
        sum += amp * (valueNoise(p) - 0.5);
        p = p * 2.07 + vec3(17.1, 3.7, 9.3);
        amp *= 0.55;
    }
    return clamp(sum * 3.5, -1.0, 1.0);
}

vec3 worldRay(vec2 s)
{
    float up = -s.y;
    float along = uFrame.z * uView.z - up * uView.w;
    return normalize(vec3(
        s.x * uView.x + along * uView.y,
        up * uView.z + uFrame.z * uView.w,
        along * uView.x - s.x * uView.y));
}

void main(void)
{
    vec3 d = worldRay(vPixel - uFrame.xy);
    vec3 o = uCamera.xyz;
    float b = dot(o, d);
    float t = -b + sqrt(max(b * b - dot(o, o) + 1.0, 0.0));
    float a = anisotropy((o + t * d) * uFrame.w + uSeed.xyz);
    vec3 color = uBase.rgb + uWarm.rgb * max(a, 0.0) + uCold.rgb * max(-a, 0.0);
    vec2 glowUv = vec2(atan(d.x, d.z) / 6.2831853 + 0.5, 0.5 - asin(clamp(d.y, -1.0, 1.0)) / 3.1415927);
    color += mix(texture(uGlowA, glowUv).rgb, texture(uGlowB, glowUv).rgb, uGlow.x);
    finalColor = vec4(color, 1.0) * texture(uTexture, vTextureCoord).a;
}
`;

const source = `
struct GlobalFilterUniforms {
  uInputSize:vec4<f32>,
  uInputPixel:vec4<f32>,
  uInputClamp:vec4<f32>,
  uOutputFrame:vec4<f32>,
  uGlobalFrame:vec4<f32>,
  uOutputTexture:vec4<f32>,
};

struct CmbUniforms {
  uView:vec4<f32>,
  uFrame:vec4<f32>,
  uCamera:vec4<f32>,
  uSeed:vec4<f32>,
  uWarm:vec4<f32>,
  uCold:vec4<f32>,
  uBase:vec4<f32>,
  uGlow:vec4<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler : sampler;

@group(1) @binding(0) var<uniform> cmbUniforms : CmbUniforms;
@group(1) @binding(1) var uGlowA: texture_2d<f32>;
@group(1) @binding(2) var uGlowASampler : sampler;
@group(1) @binding(3) var uGlowB: texture_2d<f32>;
@group(1) @binding(4) var uGlowBSampler : sampler;

struct VSOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv : vec2<f32>,
    @location(1) pixel : vec2<f32>
};

@vertex
fn mainVertex(@location(0) aPosition : vec2<f32>) -> VSOutput {
    let pixel = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
    var position = pixel;
    position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
    return VSOutput(
        vec4(position, 0.0, 1.0),
        aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw),
        pixel
    );
}

fn hash3(p: vec3<f32>) -> vec3<f32> {
    var h = fract((floor(p) + cmbUniforms.uSeed.w) * vec3(0.1031, 0.1030, 0.0973));
    h += dot(h, h.yxz + 33.33);
    return fract((h.xxy + h.yxx) * h.zyx);
}

fn valueNoise(p: vec3<f32>) -> f32 {
    let i = floor(p);
    let f = p - i;
    let u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mix(hash3(i).x, hash3(i + vec3(1.0, 0.0, 0.0)).x, u.x),
            mix(hash3(i + vec3(0.0, 1.0, 0.0)).x, hash3(i + vec3(1.0, 1.0, 0.0)).x, u.x), u.y),
        mix(mix(hash3(i + vec3(0.0, 0.0, 1.0)).x, hash3(i + vec3(1.0, 0.0, 1.0)).x, u.x),
            mix(hash3(i + vec3(0.0, 1.0, 1.0)).x, hash3(i + vec3(1.0, 1.0, 1.0)).x, u.x), u.y),
        u.z);
}

fn anisotropy(input: vec3<f32>) -> f32 {
    var p = input;
    var sum = 0.0;
    var amp = 0.5;
    for (var o = 0; o < ${CMB_OCTAVES}; o++) {
        sum += amp * (valueNoise(p) - 0.5);
        p = p * 2.07 + vec3(17.1, 3.7, 9.3);
        amp *= 0.55;
    }
    return clamp(sum * 3.5, -1.0, 1.0);
}

fn worldRay(s: vec2<f32>) -> vec3<f32> {
    let v = cmbUniforms.uView;
    let focal = cmbUniforms.uFrame.z;
    let up = -s.y;
    let along = focal * v.z - up * v.w;
    return normalize(vec3(
        s.x * v.x + along * v.y,
        up * v.z + focal * v.w,
        along * v.x - s.x * v.y));
}

@fragment
fn mainFragment(@location(0) uv: vec2<f32>, @location(1) pixel: vec2<f32>) -> @location(0) vec4<f32> {
    let u = cmbUniforms;
    let d = worldRay(pixel - u.uFrame.xy);
    let o = u.uCamera.xyz;
    let b = dot(o, d);
    let t = -b + sqrt(max(b * b - dot(o, o) + 1.0, 0.0));
    let a = anisotropy((o + t * d) * u.uFrame.w + u.uSeed.xyz);
    let glowUv = vec2(atan2(d.x, d.z) / 6.2831853 + 0.5, 0.5 - asin(clamp(d.y, -1.0, 1.0)) / 3.1415927);
    let glow = mix(
        textureSampleLevel(uGlowA, uGlowASampler, glowUv, 0.0).rgb,
        textureSampleLevel(uGlowB, uGlowBSampler, glowUv, 0.0).rgb,
        u.uGlow.x);
    let color = u.uBase.rgb + u.uWarm.rgb * max(a, 0.0) + u.uCold.rgb * max(-a, 0.0) + glow;
    return vec4(color, 1.0) * textureSampleLevel(uTexture, uSampler, uv, 0.0).a;
}
`;

class CmbFilter extends Filter {
  constructor(seed: number, glow: readonly [TextureSource, TextureSource]) {
    const rng = createRng((seed ^ 0x7e3a91c5) >>> 0);
    const cmbUniforms = new UniformGroup({
      uView: { value: new Float32Array([1, 0, 1, 0]), type: 'vec4<f32>' },
      uFrame: { value: new Float32Array([0, 0, 1, CMB_FREQUENCY]), type: 'vec4<f32>' },
      uCamera: { value: new Float32Array([0, 0, 0, 0]), type: 'vec4<f32>' },
      uSeed: { value: new Float32Array([rng() * 100, rng() * 100, rng() * 100, Math.floor(rng() * 1000)]), type: 'vec4<f32>' },
      uWarm: { value: new Float32Array([...CMB_WARM, 1]), type: 'vec4<f32>' },
      uCold: { value: new Float32Array([...CMB_COLD, 1]), type: 'vec4<f32>' },
      uBase: { value: new Float32Array([...SKY_BASE_COLOR, 1]), type: 'vec4<f32>' },
      uGlow: { value: new Float32Array([0, 0, 0, 0]), type: 'vec4<f32>' },
    });
    super({
      gpuProgram: GpuProgram.from({
        vertex: { source, entryPoint: 'mainVertex' },
        fragment: { source, entryPoint: 'mainFragment' },
      }),
      glProgram: GlProgram.from({ vertex, fragment, name: 'cmb-shell', preferredFragmentPrecision: 'highp' }),
      resources: {
        cmbUniforms,
        uGlowA: glow[0],
        uGlowASampler: glow[0].style,
        uGlowB: glow[1],
        uGlowBSampler: glow[1].style,
      },
      resolution: 1,
      antialias: 'off',
    });
  }

  setView(centreX: number, centreY: number, basis: FlyBasis, scale: number, glowMix: number) {
    const uniforms = this.resources.cmbUniforms.uniforms;
    const view = uniforms.uView as Float32Array;
    view[0] = basis.cosYaw;
    view[1] = basis.sinYaw;
    view[2] = basis.cosPitch;
    view[3] = basis.sinPitch;
    const frame = uniforms.uFrame as Float32Array;
    frame[0] = centreX;
    frame[1] = centreY;
    frame[2] = basis.focal * scale;
    const camera = uniforms.uCamera as Float32Array;
    camera[0] = basis.x / UNIVERSE_RADIUS;
    camera[1] = basis.y / UNIVERSE_RADIUS;
    camera[2] = basis.z / UNIVERSE_RADIUS;
    (uniforms.uGlow as Float32Array)[0] = glowMix;
    this.resources.cmbUniforms.update();
  }
}

export function createCmbShell(renderer: Renderer, seed: number, glow: readonly [TextureSource, TextureSource]): CmbShell {
  const filter = new CmbFilter(seed, glow);
  const quad = new Sprite(Texture.WHITE);
  quad.filters = [filter];
  const source = new Container();
  source.addChild(quad);
  const sprite = new Sprite();
  const node = new Container();
  node.addChild(sprite);
  let texture: RenderTexture | null = null;

  return {
    node,
    render(width, height, basis, glowMix) {
      const w = Math.max(1, Math.ceil(width * CMB_RESOLUTION));
      const h = Math.max(1, Math.ceil(height * CMB_RESOLUTION));
      if (!texture || texture.width !== w || texture.height !== h) {
        texture?.destroy(true);
        texture = RenderTexture.create({ width: w, height: h, resolution: 1 });
        sprite.texture = texture;
      }
      quad.setSize(w, h);
      filter.setView(w / 2, h / 2, basis, w / width, glowMix);
      renderer.render({ container: source, target: texture, clear: true });
      sprite.setSize(width, height);
    },
    destroy() {
      source.destroy({ children: true });
      filter.destroy();
      node.destroy({ children: true });
      texture?.destroy(true);
    },
  };
}
