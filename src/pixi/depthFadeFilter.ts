import { Filter, GlProgram, GpuProgram, UniformGroup } from 'pixi.js';
import { DEPTH_FADE } from '../game/constants';

// Aerial perspective for the gas, which is baked flat and so cannot carry a
// per-particle depth tint. Depth is linear in screen y for a flat disk, so the fade
// is a vertical ramp: uFade is (screen y of the galactic centre, 1 / ramp span in
// screen px, fade strength).
//
// Screen y rides down as a varying rather than being recovered in the fragment from
// uOutputFrame: a global filter uniform redeclared in both stages picks up the
// vertex stage's highp and the fragment stage's mediump, and the program will not
// link.
const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
out highp float vScreenY;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition( void )
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;

    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;

    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord( void )
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
    vScreenY = aPosition.y * uOutputFrame.w + uOutputFrame.y;
}
`;

const fragment = `
in vec2 vTextureCoord;
in highp float vScreenY;

out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uFade;

void main(void)
{
    float depth = clamp((vScreenY - uFade.x) * uFade.y + 0.5, 0.0, 1.0);
    finalColor = texture(uTexture, vTextureCoord) * (1.0 - uFade.z * (1.0 - depth));
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

struct FadeUniforms {
  uFade:vec4<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler : sampler;

@group(1) @binding(0) var<uniform> fadeUniforms : FadeUniforms;

struct VSOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv : vec2<f32>,
    @location(1) screenY : f32
};

fn filterVertexPosition(aPosition:vec2<f32>) -> vec4<f32>
{
    var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;

    position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;

    return vec4(position, 0.0, 1.0);
}

fn filterTextureCoord( aPosition:vec2<f32> ) -> vec2<f32>
{
    return aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);
}

@vertex
fn mainVertex(
  @location(0) aPosition : vec2<f32>,
) -> VSOutput {
  return VSOutput(
   filterVertexPosition(aPosition),
   filterTextureCoord(aPosition),
   aPosition.y * gfu.uOutputFrame.w + gfu.uOutputFrame.y
  );
}

@fragment
fn mainFragment(
  @location(0) uv: vec2<f32>,
  @location(1) screenY: f32
) -> @location(0) vec4<f32> {
    let depth = clamp((screenY - fadeUniforms.uFade.x) * fadeUniforms.uFade.y + 0.5, 0.0, 1.0);
    return textureSample(uTexture, uSampler, uv) * (1.0 - fadeUniforms.uFade.z * (1.0 - depth));
}
`;

export class DepthFadeFilter extends Filter {
  constructor() {
    const fadeUniforms = new UniformGroup({
      uFade: { value: new Float32Array([0, 0, DEPTH_FADE, 0]), type: 'vec4<f32>' },
    });
    super({
      gpuProgram: GpuProgram.from({
        vertex: { source, entryPoint: 'mainVertex' },
        fragment: { source, entryPoint: 'mainFragment' },
      }),
      glProgram: GlProgram.from({ vertex, fragment, name: 'galaxy-depth-fade' }),
      resources: { fadeUniforms },
    });
  }

  setRamp(centreScreenY: number, halfSpanScreenPx: number) {
    const fade = this.resources.fadeUniforms.uniforms.uFade as Float32Array;
    fade[0] = centreScreenY;
    fade[1] = 0.5 / halfSpanScreenPx;
  }
}
