import { BufferImageSource, Container, Filter, GlProgram, GpuProgram, RenderTexture, Sprite, Texture, UniformGroup } from 'pixi.js';
import type { Renderer, TextureSource } from 'pixi.js';
import {
  UNIVERSE_FOG_FAR,
  UNIVERSE_RADIUS,
  UNIVERSE_SCALE,
  UNIVERSE_VOID_CELL,
  UNIVERSE_WALL_WEIGHT,
  WEB_GLOW_COLOR,
  WEB_GLOW_FADE,
  WEB_GLOW_FAR,
  WEB_GLOW_FILAMENT_WIDTH,
  WEB_GLOW_HEIGHT,
  WEB_GLOW_INTENSITY,
  WEB_GLOW_NEAR,
  WEB_GLOW_STEPS,
  WEB_GLOW_WALL_WIDTH,
  WEB_GLOW_WIDTH,
} from '../game/constants';
import { universeCellPosition, universeVoidOffset } from '../game/universe';

const MLY_TO_CELLS = 1 / (UNIVERSE_SCALE * UNIVERSE_VOID_CELL);
const WINDOW_REACH = Math.ceil(WEB_GLOW_FAR * MLY_TO_CELLS) + 2;
const N = 2 * WINDOW_REACH + 1;

function fillVoidWindow(ci: number, cj: number, ck: number, out: Uint8Array): void {
  const offset = { x: 0, y: 0, z: 0 };
  for (let c = 0; c < N; c++) {
    for (let b = 0; b < N; b++) {
      for (let a = 0; a < N; a++) {
        universeVoidOffset(ci + a, cj + b, ck + c, offset);
        const o = ((c * N * N) + b * N + a) * 4;
        out[o] = Math.round((0.5 + offset.x) * 255);
        out[o + 1] = Math.round((0.5 + offset.y) * 255);
        out[o + 2] = Math.round((0.5 + offset.z) * 255);
        out[o + 3] = 255;
      }
    }
  }
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
uniform sampler2D uCentres;
uniform vec4 uFrame;
uniform vec4 uCamera;
uniform vec4 uCell;
uniform vec4 uRange;
uniform vec4 uWidths;
uniform vec4 uColor;

const float N = ${N}.0;

vec3 centreAt(vec3 cell)
{
    vec2 uv = (vec2(cell.x + N * cell.y, cell.z) + 0.5) / vec2(N * N, N);
    return cell + texture(uCentres, uv).rgb;
}

float kernel(float t)
{
    float f = 1.0 - t * t * 0.25;
    if (f <= 0.0) return 0.0;
    f *= f;
    return f * f;
}

float webWeight(vec3 q)
{
    vec3 base = floor(q) - 1.0;
    float d1 = 1e9;
    float d2 = 1e9;
    float d3 = 1e9;
    vec3 c1 = vec3(0.0);
    vec3 c2 = vec3(0.0);
    vec3 c3 = vec3(0.0);
    for (int n = 0; n < 27; n++) {
        float f = float(n);
        float layer = floor((f + 0.5) / 9.0);
        float row = floor((f - layer * 9.0 + 0.5) / 3.0);
        vec3 c = centreAt(base + vec3(f - layer * 9.0 - row * 3.0, row, layer));
        vec3 v = q - c;
        float d = dot(v, v);
        if (d < d1) {
            d3 = d2; c3 = c2;
            d2 = d1; c2 = c1;
            d1 = d; c1 = c;
        } else if (d < d2) {
            d3 = d2; c3 = c2;
            d2 = d; c2 = c;
        } else if (d < d3) {
            d3 = d; c3 = c;
        }
    }
    float wall = kernel((d2 - d1) / (2.0 * length(c1 - c2)) / uWidths.x);
    float filament = kernel((d3 - d1) / (2.0 * length(c1 - c3)) / uWidths.y);
    return uWidths.z * wall + filament;
}

void main(void)
{
    vec2 uv = vPixel / uFrame.xy;
    float lon = uv.x * 6.2831853 - 3.1415927;
    float lat = (0.5 - uv.y) * 3.1415927;
    vec3 d = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
    float dither = fract(52.9829189 * fract(dot(vPixel, vec2(0.06711056, 0.00583715))));
    float stride = (uRange.z - uRange.x) / ${WEB_GLOW_STEPS}.0;
    float sum = 0.0;
    for (int s = 0; s < ${WEB_GLOW_STEPS}; s++) {
        float t = uRange.x + (float(s) + dither) * stride;
        vec3 p = uCamera.xyz + d * t;
        if (dot(p, p) > uCamera.w * uCamera.w) break;
        float fog = 1.0 - clamp(t / uRange.w, 0.0, 1.0);
        float fade = (1.0 - fog * fog) * (1.0 - smoothstep(uRange.y, uRange.z, t));
        sum += webWeight(uCell.xyz + d * (t * uCell.w)) * fade;
    }
    vec3 glow = 1.0 - exp(-uColor.rgb * (sum / ${WEB_GLOW_STEPS}.0) * uColor.w);
    finalColor = vec4(glow, 1.0) * texture(uTexture, vTextureCoord).a;
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

struct GlowUniforms {
  uFrame:vec4<f32>,
  uCamera:vec4<f32>,
  uCell:vec4<f32>,
  uRange:vec4<f32>,
  uWidths:vec4<f32>,
  uColor:vec4<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler : sampler;

@group(1) @binding(0) var<uniform> glowUniforms : GlowUniforms;
@group(1) @binding(1) var uCentres: texture_2d<f32>;
@group(1) @binding(2) var uCentresSampler : sampler;

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

const N = ${N}.0;

fn centreAt(cell: vec3<f32>) -> vec3<f32> {
    let uv = (vec2(cell.x + N * cell.y, cell.z) + 0.5) / vec2(N * N, N);
    return cell + textureSampleLevel(uCentres, uCentresSampler, uv, 0.0).rgb;
}

fn kernel(t: f32) -> f32 {
    var f = 1.0 - t * t * 0.25;
    if (f <= 0.0) { return 0.0; }
    f *= f;
    return f * f;
}

fn webWeight(q: vec3<f32>) -> f32 {
    let base = floor(q) - 1.0;
    var d1 = 1e9;
    var d2 = 1e9;
    var d3 = 1e9;
    var c1 = vec3(0.0);
    var c2 = vec3(0.0);
    var c3 = vec3(0.0);
    for (var n = 0; n < 27; n++) {
        let layer = f32(n / 9);
        let row = f32((n % 9) / 3);
        let c = centreAt(base + vec3(f32(n % 3), row, layer));
        let v = q - c;
        let d = dot(v, v);
        if (d < d1) {
            d3 = d2; c3 = c2;
            d2 = d1; c2 = c1;
            d1 = d; c1 = c;
        } else if (d < d2) {
            d3 = d2; c3 = c2;
            d2 = d; c2 = c;
        } else if (d < d3) {
            d3 = d; c3 = c;
        }
    }
    let w = glowUniforms.uWidths;
    let wall = kernel((d2 - d1) / (2.0 * length(c1 - c2)) / w.x);
    let filament = kernel((d3 - d1) / (2.0 * length(c1 - c3)) / w.y);
    return w.z * wall + filament;
}

@fragment
fn mainFragment(@location(0) uv: vec2<f32>, @location(1) pixel: vec2<f32>) -> @location(0) vec4<f32> {
    let u = glowUniforms;
    let texel = pixel / u.uFrame.xy;
    let lon = texel.x * 6.2831853 - 3.1415927;
    let lat = (0.5 - texel.y) * 3.1415927;
    let d = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
    let dither = fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
    let stride = (u.uRange.z - u.uRange.x) / ${WEB_GLOW_STEPS}.0;
    var sum = 0.0;
    for (var s = 0; s < ${WEB_GLOW_STEPS}; s++) {
        let t = u.uRange.x + (f32(s) + dither) * stride;
        let p = u.uCamera.xyz + d * t;
        if (dot(p, p) > u.uCamera.w * u.uCamera.w) { break; }
        let fog = 1.0 - clamp(t / u.uRange.w, 0.0, 1.0);
        let fade = (1.0 - fog * fog) * (1.0 - smoothstep(u.uRange.y, u.uRange.z, t));
        sum += webWeight(u.uCell.xyz + d * (t * u.uCell.w)) * fade;
    }
    let glow = 1.0 - exp(-u.uColor.rgb * (sum / ${WEB_GLOW_STEPS}.0) * u.uColor.w);
    return vec4(glow, 1.0) * textureSampleLevel(uTexture, uSampler, uv, 0.0).a;
}
`;

class WebGlowFilter extends Filter {
  constructor(centres: TextureSource) {
    const glowUniforms = new UniformGroup({
      uFrame: { value: new Float32Array([WEB_GLOW_WIDTH, WEB_GLOW_HEIGHT, 0, 0]), type: 'vec4<f32>' },
      uCamera: { value: new Float32Array([0, 0, 0, UNIVERSE_RADIUS]), type: 'vec4<f32>' },
      uCell: { value: new Float32Array([0, 0, 0, MLY_TO_CELLS]), type: 'vec4<f32>' },
      uRange: { value: new Float32Array([WEB_GLOW_NEAR, WEB_GLOW_FADE, WEB_GLOW_FAR, UNIVERSE_FOG_FAR]), type: 'vec4<f32>' },
      uWidths: {
        value: new Float32Array([
          WEB_GLOW_WALL_WIDTH / UNIVERSE_VOID_CELL,
          WEB_GLOW_FILAMENT_WIDTH / UNIVERSE_VOID_CELL,
          UNIVERSE_WALL_WEIGHT,
          0,
        ]),
        type: 'vec4<f32>',
      },
      uColor: { value: new Float32Array([...WEB_GLOW_COLOR, WEB_GLOW_INTENSITY]), type: 'vec4<f32>' },
    });
    super({
      gpuProgram: GpuProgram.from({
        vertex: { source, entryPoint: 'mainVertex' },
        fragment: { source, entryPoint: 'mainFragment' },
      }),
      glProgram: GlProgram.from({ vertex, fragment, name: 'web-glow', preferredFragmentPrecision: 'highp' }),
      resources: { glowUniforms, uCentres: centres, uCentresSampler: centres.style },
      resolution: 1,
      antialias: 'off',
    });
  }

  setCamera(x: number, y: number, z: number, cellX: number, cellY: number, cellZ: number) {
    const uniforms = this.resources.glowUniforms.uniforms;
    const camera = uniforms.uCamera as Float32Array;
    camera[0] = x;
    camera[1] = y;
    camera[2] = z;
    const cell = uniforms.uCell as Float32Array;
    cell[0] = cellX;
    cell[1] = cellY;
    cell[2] = cellZ;
    this.resources.glowUniforms.update();
  }
}

export interface WebGlow {
  readonly panoramas: readonly [RenderTexture, RenderTexture];
  bake(x: number, y: number, z: number): 0 | 1;
  destroy(): void;
}

export function createWebGlow(renderer: Renderer): WebGlow {
  const buffer = new Uint8Array(N * N * N * 4);
  const centres = new BufferImageSource({
    resource: buffer,
    width: N * N,
    height: N,
    format: 'rgba8unorm',
    scaleMode: 'nearest',
    alphaMode: 'no-premultiply-alpha',
  });
  const filter = new WebGlowFilter(centres);
  const quad = new Sprite(Texture.WHITE);
  quad.setSize(WEB_GLOW_WIDTH, WEB_GLOW_HEIGHT);
  quad.filters = [filter];
  const stage = new Container();
  stage.addChild(quad);
  const createPanorama = () => RenderTexture.create({
    width: WEB_GLOW_WIDTH,
    height: WEB_GLOW_HEIGHT,
    resolution: 1,
    scaleMode: 'linear',
    addressModeU: 'repeat',
    addressModeV: 'clamp-to-edge',
  });
  const panoramas: [RenderTexture, RenderTexture] = [createPanorama(), createPanorama()];
  let written: 0 | 1 = 1;
  const cell = { x: 0, y: 0, z: 0 };
  const origin = { i: NaN, j: NaN, k: NaN };

  return {
    panoramas,
    bake(x, y, z) {
      universeCellPosition(x, y, z, cell);
      const i = Math.floor(cell.x) - WINDOW_REACH;
      const j = Math.floor(cell.y) - WINDOW_REACH;
      const k = Math.floor(cell.z) - WINDOW_REACH;
      if (i !== origin.i || j !== origin.j || k !== origin.k) {
        origin.i = i;
        origin.j = j;
        origin.k = k;
        fillVoidWindow(i, j, k, buffer);
        centres.update();
      }
      filter.setCamera(x, y, z, cell.x - i, cell.y - j, cell.z - k);
      written = written === 0 ? 1 : 0;
      renderer.render({ container: stage, target: panoramas[written], clear: true });
      return written;
    },
    destroy() {
      stage.destroy({ children: true });
      filter.destroy();
      centres.destroy();
      panoramas[0].destroy(true);
      panoramas[1].destroy(true);
    },
  };
}
