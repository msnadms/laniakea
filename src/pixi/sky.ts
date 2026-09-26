import { Container, Filter, GlProgram, GpuProgram, RenderTexture, Sprite, Texture, UniformGroup } from 'pixi.js';
import type { Renderer } from 'pixi.js';
import { createRng } from '../game/galaxyGen';
import { SKY_BASE_COLOR, SKY_NEBULA_RESOLUTION, SKY_PALETTES, SKY_TWINKLE_DEPTH, SKY_TWINKLE_SPEED } from '../game/constants';

export interface SkyLook {
  nebula: number;
  band: number;
  stars: number;
}

export interface SkyTheme {
  palette: readonly (readonly [number, number, number])[];
  offset: [number, number, number];
  band: [number, number, number];
  cellSeed: number;
}

export interface SkyView {
  cosYaw: number;
  sinYaw: number;
  cosPitch: number;
  sinPitch: number;
  focal: number;
  orbitYaw: number;
  orbitTilt: number;
}

export interface SkyLens {
  nebula: Texture;
  stars: Texture;
  x: number;
  y: number;
  width: number;
  height: number;
  seconds: number;
}

export interface Sky {
  node: Container;
  nebulaTexture(): Texture | null;
  starTexture(): Texture | null;
  render(width: number, height: number, view: SkyView): void;
  twinkle(seconds: number): void;
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
uniform vec4 uView;
uniform vec4 uFrame;
uniform vec4 uSeed;
uniform vec4 uBand;
uniform vec4 uLook;
uniform vec4 uColorA;
uniform vec4 uColorB;
uniform vec4 uColorC;
uniform vec4 uColorD;
uniform vec4 uBase;
uniform vec4 uOrbit;

vec3 skyFromCamera(vec3 c)
{
    float along = -c.y * uOrbit.z - c.z * uOrbit.w;
    float x = c.x * uOrbit.x + along * uOrbit.y;
    float z = -c.x * uOrbit.y + along * uOrbit.x;
    float y = c.y * uOrbit.w - c.z * uOrbit.z;
    float z1 = z * uView.w - y * uView.z;
    return vec3(
        x * uView.x + z1 * uView.y,
        -y * uView.w - z * uView.z,
        -x * uView.y + z1 * uView.x);
}

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

float fbm(vec3 p)
{
    float sum = 0.0;
    float amp = 0.5;
    for (int o = 0; o < 5; o++) {
        sum += amp * valueNoise(p);
        p = p * 2.03 + vec3(17.1, 3.7, 9.3);
        amp *= 0.5;
    }
    return sum / 0.96875;
}

float bandAt(vec3 d)
{
    float b = dot(d, uBand.xyz);
    return exp(-b * b * 30.0) * uBand.w;
}

vec3 nebula(vec3 d)
{
    vec3 p = d * 2.4 + uSeed.xyz;
    vec3 q = vec3(fbm(p), fbm(p + vec3(5.2, 1.3, 2.8)), fbm(p + vec3(1.7, 9.2, 3.4)));
    float n = fbm(p * 1.3 + 2.2 * q);
    float region = smoothstep(0.32, 0.7, fbm(d * 1.1 + uSeed.zxy));
    float dust = smoothstep(0.5, 0.72, fbm(p * 2.6 + 3.0 * q.zxy));
    float glow = region * smoothstep(0.32, 0.85, n);
    vec3 tint = mix(uColorA.rgb, uColorB.rgb, smoothstep(0.35, 0.65, q.x));
    tint = mix(tint, uColorC.rgb, smoothstep(0.5, 0.75, q.y));
    vec3 color = tint * glow * 1.1 + uColorD.rgb * pow(glow, 3.0) * 0.9;
    color += tint * (0.05 * region + 0.025 * n);
    float band = bandAt(d);
    color += vec3(0.6, 0.58, 0.7) * band * (0.06 + 0.1 * n);
    color *= 1.0 - 0.8 * dust * smoothstep(0.0, 0.4, region + band);
    return uBase.rgb + 1.0 - exp(-color * uLook.x * 1.4);
}

vec3 starColor(float t)
{
    vec3 c = mix(vec3(1.0, 0.6, 0.42), vec3(1.0, 0.84, 0.64), smoothstep(0.0, 0.2, t));
    c = mix(c, vec3(1.0, 0.97, 0.94), smoothstep(0.2, 0.5, t));
    return mix(c, vec3(0.7, 0.8, 1.0), smoothstep(0.55, 0.95, t));
}

vec2 brightest = vec2(0.0);

vec3 starLayer(vec3 d, vec3 right, vec3 down, float density, float cellPx, float chance, float sigmaPx, float floorLight, float gain, float haloPx, float spikePx)
{
    float k = uFrame.z / cellPx;
    vec3 p = d * k;
    vec3 base = floor(p - 0.5);
    float threshold = chance * density;
    vec3 sum = vec3(0.0);
    for (int n = 0; n < 8; n++) {
        float f = float(n);
        vec3 cell = base + vec3(mod(f, 2.0), mod(floor(f * 0.5), 2.0), floor(f * 0.25));
        vec3 h = hash3(cell);
        if (h.x > threshold) continue;
        vec3 star = normalize(cell + 0.1 + 0.8 * hash3(cell + vec3(71.0, 13.0, 37.0))) * k;
        if (floor(star) != cell) continue;
        vec3 delta = (p - star) * cellPx;
        float ox = dot(delta, right);
        float oy = dot(delta, down);
        float r2 = ox * ox + oy * oy;
        float mag = pow(h.y, 5.0);
        float light = exp(-r2 / (2.0 * sigmaPx * sigmaPx)) * (floorLight + gain * mag);
        if (haloPx > 0.0) light += exp(-sqrt(r2) / haloPx) * 0.12 * mag;
        if (spikePx > 0.0) {
            float reach = spikePx * (0.3 + mag);
            light += (exp(-abs(oy) / 0.6 - abs(ox) / reach) + exp(-abs(ox) / 0.6 - abs(oy) / reach)) * 0.35 * mag;
        }
        sum += starColor(h.z) * light;
        if (light > brightest.x) brightest = vec2(light, hash3(cell + vec3(5.0, 91.0, 23.0)).x);
    }
    return sum;
}

vec3 stars(vec3 d)
{
    vec3 right = skyFromCamera(vec3(1.0, 0.0, 0.0));
    vec3 down = skyFromCamera(vec3(0.0, -1.0, 0.0));
    float clump = valueNoise(d * 6.0 + uSeed.yzx) * 0.6 + valueNoise(d * 17.0 + uSeed.zxy) * 0.4;
    float density = uLook.z * (0.4 + 1.1 * clump) * (1.0 + 1.8 * bandAt(d));
    vec3 color = starLayer(d, right, down, density, 5.0, 0.5, 0.5, 0.05, 0.6, 0.0, 0.0);
    color += starLayer(d, right, down, density, 11.0, 0.45, 0.6, 0.12, 0.9, 0.0, 0.0);
    color += starLayer(d, right, down, density, 30.0, 0.35, 0.75, 0.2, 1.3, 2.5, 0.0);
    color += starLayer(d, right, down, density, 120.0, 0.3, 0.95, 0.35, 2.0, 8.0, 26.0);
    return color;
}

void main(void)
{
    vec2 s = vPixel - uFrame.xy;
    vec3 d = normalize(skyFromCamera(vec3(s.x, -s.y, uFrame.z)));
    float mask = texture(uTexture, vTextureCoord).a;
    if (uLook.w < 0.5) {
        finalColor = vec4(nebula(d), 1.0) * mask;
    } else {
        vec3 c = stars(d);
        finalColor = vec4(c * mask, brightest.y);
    }
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

struct SkyUniforms {
  uView:vec4<f32>,
  uFrame:vec4<f32>,
  uSeed:vec4<f32>,
  uBand:vec4<f32>,
  uLook:vec4<f32>,
  uColorA:vec4<f32>,
  uColorB:vec4<f32>,
  uColorC:vec4<f32>,
  uColorD:vec4<f32>,
  uBase:vec4<f32>,
  uOrbit:vec4<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler : sampler;

@group(1) @binding(0) var<uniform> skyUniforms : SkyUniforms;

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
    var h = fract((floor(p) + skyUniforms.uSeed.w) * vec3(0.1031, 0.1030, 0.0973));
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

fn fbm(input: vec3<f32>) -> f32 {
    var p = input;
    var sum = 0.0;
    var amp = 0.5;
    for (var o = 0; o < 5; o++) {
        sum += amp * valueNoise(p);
        p = p * 2.03 + vec3(17.1, 3.7, 9.3);
        amp *= 0.5;
    }
    return sum / 0.96875;
}

fn bandAt(d: vec3<f32>) -> f32 {
    let b = dot(d, skyUniforms.uBand.xyz);
    return exp(-b * b * 30.0) * skyUniforms.uBand.w;
}

fn nebula(d: vec3<f32>) -> vec3<f32> {
    let s = skyUniforms;
    let p = d * 2.4 + s.uSeed.xyz;
    let q = vec3(fbm(p), fbm(p + vec3(5.2, 1.3, 2.8)), fbm(p + vec3(1.7, 9.2, 3.4)));
    let n = fbm(p * 1.3 + 2.2 * q);
    let region = smoothstep(0.32, 0.7, fbm(d * 1.1 + s.uSeed.zxy));
    let dust = smoothstep(0.5, 0.72, fbm(p * 2.6 + 3.0 * q.zxy));
    let glow = region * smoothstep(0.32, 0.85, n);
    var tint = mix(s.uColorA.rgb, s.uColorB.rgb, smoothstep(0.35, 0.65, q.x));
    tint = mix(tint, s.uColorC.rgb, smoothstep(0.5, 0.75, q.y));
    var color = tint * glow * 1.1 + s.uColorD.rgb * pow(glow, 3.0) * 0.9;
    color += tint * (0.05 * region + 0.025 * n);
    let band = bandAt(d);
    color += vec3(0.6, 0.58, 0.7) * band * (0.06 + 0.1 * n);
    color *= 1.0 - 0.8 * dust * smoothstep(0.0, 0.4, region + band);
    return s.uBase.rgb + 1.0 - exp(-color * s.uLook.x * 1.4);
}

fn starColor(t: f32) -> vec3<f32> {
    var c = mix(vec3(1.0, 0.6, 0.42), vec3(1.0, 0.84, 0.64), smoothstep(0.0, 0.2, t));
    c = mix(c, vec3(1.0, 0.97, 0.94), smoothstep(0.2, 0.5, t));
    return mix(c, vec3(0.7, 0.8, 1.0), smoothstep(0.55, 0.95, t));
}

var<private> brightest: vec2<f32>;

fn starLayer(d: vec3<f32>, right: vec3<f32>, down: vec3<f32>, density: f32, cellPx: f32, chance: f32, sigmaPx: f32, floorLight: f32, gain: f32, haloPx: f32, spikePx: f32) -> vec3<f32> {
    let k = skyUniforms.uFrame.z / cellPx;
    let p = d * k;
    let base = floor(p - 0.5);
    let threshold = chance * density;
    var sum = vec3(0.0);
    for (var n = 0; n < 8; n++) {
        let f = f32(n);
        let cell = base + vec3(f % 2.0, floor(f * 0.5) % 2.0, floor(f * 0.25));
        let h = hash3(cell);
        if (h.x > threshold) { continue; }
        let star = normalize(cell + 0.1 + 0.8 * hash3(cell + vec3(71.0, 13.0, 37.0))) * k;
        if (any(floor(star) != cell)) { continue; }
        let delta = (p - star) * cellPx;
        let ox = dot(delta, right);
        let oy = dot(delta, down);
        let r2 = ox * ox + oy * oy;
        let mag = pow(h.y, 5.0);
        var light = exp(-r2 / (2.0 * sigmaPx * sigmaPx)) * (floorLight + gain * mag);
        if (haloPx > 0.0) { light += exp(-sqrt(r2) / haloPx) * 0.12 * mag; }
        if (spikePx > 0.0) {
            let reach = spikePx * (0.3 + mag);
            light += (exp(-abs(oy) / 0.6 - abs(ox) / reach) + exp(-abs(ox) / 0.6 - abs(oy) / reach)) * 0.35 * mag;
        }
        sum += starColor(h.z) * light;
        if (light > brightest.x) { brightest = vec2(light, hash3(cell + vec3(5.0, 91.0, 23.0)).x); }
    }
    return sum;
}

fn skyFromCamera(c: vec3<f32>) -> vec3<f32> {
    let o = skyUniforms.uOrbit;
    let v = skyUniforms.uView;
    let along = -c.y * o.z - c.z * o.w;
    let x = c.x * o.x + along * o.y;
    let z = -c.x * o.y + along * o.x;
    let y = c.y * o.w - c.z * o.z;
    let z1 = z * v.w - y * v.z;
    return vec3(
        x * v.x + z1 * v.y,
        -y * v.w - z * v.z,
        -x * v.y + z1 * v.x);
}

fn stars(d: vec3<f32>) -> vec3<f32> {
    let right = skyFromCamera(vec3(1.0, 0.0, 0.0));
    let down = skyFromCamera(vec3(0.0, -1.0, 0.0));
    let clump = valueNoise(d * 6.0 + skyUniforms.uSeed.yzx) * 0.6 + valueNoise(d * 17.0 + skyUniforms.uSeed.zxy) * 0.4;
    let density = skyUniforms.uLook.z * (0.4 + 1.1 * clump) * (1.0 + 1.8 * bandAt(d));
    var color = starLayer(d, right, down, density, 5.0, 0.5, 0.5, 0.05, 0.6, 0.0, 0.0);
    color += starLayer(d, right, down, density, 11.0, 0.45, 0.6, 0.12, 0.9, 0.0, 0.0);
    color += starLayer(d, right, down, density, 30.0, 0.35, 0.75, 0.2, 1.3, 2.5, 0.0);
    color += starLayer(d, right, down, density, 120.0, 0.3, 0.95, 0.35, 2.0, 8.0, 26.0);
    return color;
}

@fragment
fn mainFragment(@location(0) uv: vec2<f32>, @location(1) pixel: vec2<f32>) -> @location(0) vec4<f32> {
    let frame = skyUniforms.uFrame;
    let s = pixel - frame.xy;
    let d = normalize(skyFromCamera(vec3(s.x, -s.y, frame.z)));
    let mask = textureSample(uTexture, uSampler, uv).a;
    if (skyUniforms.uLook.w < 0.5) {
        return vec4(nebula(d), 1.0) * mask;
    }
    brightest = vec2(0.0);
    let c = stars(d);
    return vec4(c * mask, brightest.y);
}
`;

const twinkleFragment = `
in vec2 vTextureCoord;

out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uTwinkle;

void main(void)
{
    vec4 star = texture(uTexture, vTextureCoord);
    float speed = uTwinkle.y * (0.5 + fract(star.a * 7.13));
    float dim = uTwinkle.z * (0.5 + 0.5 * sin(uTwinkle.x * speed + star.a * 6.2832));
    finalColor = vec4(star.rgb * (1.0 - dim), 0.0);
}
`;

const twinkleSource = `
struct GlobalFilterUniforms {
  uInputSize:vec4<f32>,
  uInputPixel:vec4<f32>,
  uInputClamp:vec4<f32>,
  uOutputFrame:vec4<f32>,
  uGlobalFrame:vec4<f32>,
  uOutputTexture:vec4<f32>,
};

struct TwinkleUniforms {
  uTwinkle:vec4<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler : sampler;

@group(1) @binding(0) var<uniform> twinkleUniforms : TwinkleUniforms;

struct VSOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv : vec2<f32>,
};

@vertex
fn mainVertex(@location(0) aPosition : vec2<f32>) -> VSOutput {
    var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
    position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
    return VSOutput(vec4(position, 0.0, 1.0), aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw));
}

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let t = twinkleUniforms.uTwinkle;
    let star = textureSample(uTexture, uSampler, uv);
    let speed = t.y * (0.5 + fract(star.a * 7.13));
    let dim = t.z * (0.5 + 0.5 * sin(t.x * speed + star.a * 6.2832));
    return vec4(star.rgb * (1.0 - dim), 0.0);
}
`;

const twinkleVertex = `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

void main(void)
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    gl_Position = vec4(position, 0.0, 1.0);
    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}
`;

class TwinkleFilter extends Filter {
  constructor() {
    const twinkleUniforms = new UniformGroup({
      uTwinkle: { value: new Float32Array([0, SKY_TWINKLE_SPEED, SKY_TWINKLE_DEPTH, 0]), type: 'vec4<f32>' },
    });
    super({
      gpuProgram: GpuProgram.from({
        vertex: { source: twinkleSource, entryPoint: 'mainVertex' },
        fragment: { source: twinkleSource, entryPoint: 'mainFragment' },
      }),
      glProgram: GlProgram.from({ vertex: twinkleVertex, fragment: twinkleFragment, name: 'sky-twinkle' }),
      resources: { twinkleUniforms },
      resolution: 1,
      antialias: 'off',
      blendMode: 'add',
    });
  }

  set time(seconds: number) {
    (this.resources.twinkleUniforms.uniforms.uTwinkle as Float32Array)[0] = seconds;
  }
}

const glProgram = () => GlProgram.from({ vertex, fragment, name: 'sky', preferredFragmentPrecision: 'highp' });
const gpuProgram = () => GpuProgram.from({
  vertex: { source, entryPoint: 'mainVertex' },
  fragment: { source, entryPoint: 'mainFragment' },
});

class SkyFilter extends Filter {
  constructor(theme: SkyTheme, look: SkyLook, pass: 0 | 1) {
    const [a, b, c, d] = theme.palette;
    const skyUniforms = new UniformGroup({
      uView: { value: new Float32Array([1, 0, 1, 0]), type: 'vec4<f32>' },
      uFrame: { value: new Float32Array([0, 0, 1, 1]), type: 'vec4<f32>' },
      uSeed: { value: new Float32Array([...theme.offset, theme.cellSeed]), type: 'vec4<f32>' },
      uBand: { value: new Float32Array([...theme.band, look.band]), type: 'vec4<f32>' },
      uLook: { value: new Float32Array([look.nebula, 0, look.stars, pass]), type: 'vec4<f32>' },
      uColorA: { value: new Float32Array([...a, 1]), type: 'vec4<f32>' },
      uColorB: { value: new Float32Array([...b, 1]), type: 'vec4<f32>' },
      uColorC: { value: new Float32Array([...c, 1]), type: 'vec4<f32>' },
      uColorD: { value: new Float32Array([...d, 1]), type: 'vec4<f32>' },
      uBase: { value: new Float32Array([...SKY_BASE_COLOR, 1]), type: 'vec4<f32>' },
      uOrbit: { value: new Float32Array([1, 0, 1, 0]), type: 'vec4<f32>' },
    });
    super({
      gpuProgram: gpuProgram(),
      glProgram: glProgram(),
      resources: { skyUniforms },
      resolution: 1,
      antialias: 'off',
    });
  }

  setView(centreX: number, centreY: number, view: SkyView, scale: number) {
    const uniforms = this.resources.skyUniforms.uniforms;
    const orientation = uniforms.uView as Float32Array;
    orientation[0] = view.cosYaw;
    orientation[1] = view.sinYaw;
    orientation[2] = view.cosPitch;
    orientation[3] = view.sinPitch;
    const frame = uniforms.uFrame as Float32Array;
    frame[0] = centreX;
    frame[1] = centreY;
    frame[2] = view.focal * scale;
    const orbit = uniforms.uOrbit as Float32Array;
    orbit[0] = Math.cos(view.orbitYaw);
    orbit[1] = Math.sin(view.orbitYaw);
    orbit[2] = Math.cos(view.orbitTilt);
    orbit[3] = Math.sin(view.orbitTilt);
    this.resources.skyUniforms.update();
  }
}

export function skyTheme(seed: number): SkyTheme {
  const rng = createRng((seed ^ 0x5ca1ab1e) >>> 0);
  const palette = SKY_PALETTES[Math.floor(rng() * SKY_PALETTES.length)];
  const offset: [number, number, number] = [rng() * 100, rng() * 100, rng() * 100];
  const bandYaw = rng() * Math.PI * 2;
  const bandTilt = Math.acos(2 * rng() - 1);
  const band: [number, number, number] = [
    Math.sin(bandTilt) * Math.cos(bandYaw),
    Math.cos(bandTilt),
    Math.sin(bandTilt) * Math.sin(bandYaw),
  ];
  return { palette, offset, band, cellSeed: Math.floor(rng() * 1000) };
}

export function flatSkyView(seed: number, focal: number): SkyView {
  const rng = createRng((seed ^ 0x2f6b9d41) >>> 0);
  const yaw = rng() * Math.PI * 2;
  const pitch = (rng() - 0.5) * 2.2;
  return {
    cosYaw: Math.cos(yaw),
    sinYaw: Math.sin(yaw),
    cosPitch: Math.cos(pitch),
    sinPitch: Math.sin(pitch),
    focal,
    orbitYaw: 0,
    orbitTilt: 0,
  };
}

function createPass(theme: SkyTheme, look: SkyLook, pass: 0 | 1) {
  const filter = new SkyFilter(theme, look, pass);
  const quad = new Sprite(Texture.WHITE);
  quad.filters = [filter];
  const source = new Container();
  source.addChild(quad);
  const sprite = new Sprite();
  let texture: RenderTexture | null = null;

  const render = (renderer: Renderer, width: number, height: number, view: SkyView, scale: number) => {
    const w = Math.max(1, Math.ceil(width * scale));
    const h = Math.max(1, Math.ceil(height * scale));
    if (!texture || texture.width !== w || texture.height !== h) {
      texture?.destroy(true);
      texture = RenderTexture.create({ width: w, height: h, resolution: 1 });
      sprite.texture = texture;
    }
    quad.setSize(w, h);
    filter.setView(w / 2, h / 2, view, scale);
    renderer.render({ container: source, target: texture, clear: true });
    sprite.setSize(width, height);
  };

  const destroy = () => {
    source.destroy({ children: true });
    filter.destroy();
    sprite.destroy();
    texture?.destroy(true);
  };

  return { sprite, render, destroy, texture: () => texture };
}

export function createSky(renderer: Renderer, seed: number, look: SkyLook): Sky {
  const theme = skyTheme(seed);
  const nebula = createPass(theme, look, 0);
  const stars = createPass(theme, look, 1);
  const twinkle = new TwinkleFilter();
  stars.sprite.filters = [twinkle];
  const node = new Container();
  node.addChild(nebula.sprite);
  node.addChild(stars.sprite);

  return {
    node,
    nebulaTexture: nebula.texture,
    starTexture: stars.texture,
    render(width, height, view) {
      nebula.render(renderer, width, height, view, SKY_NEBULA_RESOLUTION);
      stars.render(renderer, width, height, view, 1);
    },
    twinkle(seconds) {
      twinkle.time = seconds;
    },
    destroy() {
      nebula.destroy();
      stars.destroy();
      twinkle.destroy();
      node.destroy();
    },
  };
}
