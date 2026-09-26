import { CanvasSource, Container, DisplacementFilter, Rectangle, Sprite, Texture } from 'pixi.js';
import { GALAXY_RADIUS, SC_DOT_TEXTURE_RADIUS } from '../game/constants';
import { createRng } from '../game/galaxyGen';

function colorToRgb(color: number) {
  return { r: (color >> 16) & 0xff, g: (color >> 8) & 0xff, b: color & 0xff };
}

export function createDisplacementTexture(size = 512, lowRes = 64): Texture {
  const tmp = document.createElement('canvas');
  tmp.width = lowRes;
  tmp.height = lowRes;
  const tCtx = tmp.getContext('2d')!;
  const img = tCtx.createImageData(lowRes, lowRes);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i]     = Math.random() * 255;
    img.data[i + 1] = Math.random() * 255;
    img.data[i + 2] = 0;
    img.data[i + 3] = 255;
  }
  tCtx.putImageData(img, 0, 0);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tmp, 0, 0, size, size);
  return Texture.from(canvas, true);
}

export function createDisplacementSetup(container: Container, initialScale: number) {
  const dispTexture = createDisplacementTexture();
  const dispSprite = new Sprite(dispTexture);
  dispSprite.anchor.set(0.5);
  dispSprite.width = GALAXY_RADIUS * 3;
  dispSprite.height = GALAXY_RADIUS * 3;
  dispSprite.renderable = false;

  const dispFilter = new DisplacementFilter({ sprite: dispSprite, scale: initialScale });
  container.addChild(dispSprite);

  return {
    filter: dispFilter,
    update(elapsedSecs: number, filterScale: number) {
      dispSprite.x = Math.sin(elapsedSecs * 0.06) * 120;
      dispSprite.y = Math.cos(elapsedSecs * 0.045) * 120;
      dispSprite.rotation = elapsedSecs * 0.008;
      dispFilter.scale.x = filterScale;
      dispFilter.scale.y = filterScale;
    },
    destroy() {
      dispFilter.destroy();
      container.removeChild(dispSprite);
      dispSprite.destroy();
      dispTexture.destroy(true);
    },
  };
}

export function createNebulaGlowTexture(color: number): Texture {
  const SIZE = 512;
  const center = SIZE / 2;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;

  const { r, g, b } = colorToRgb(color);

  // warm-white hot core fading to star color
  const wr = Math.min(255, Math.round(r + (255 - r) * 0.55));
  const wg = Math.min(255, Math.round(g + (255 - g) * 0.55));
  const wb = Math.min(255, Math.round(b + (255 - b) * 0.55));

  const grad = ctx.createRadialGradient(center, center, 0, center, center, center);
  grad.addColorStop(0,    `rgba(${wr},${wg},${wb},0.7)`);
  grad.addColorStop(0.1,  `rgba(${r},${g},${b},0.5)`);
  grad.addColorStop(0.3,  `rgba(${r},${g},${b},0.18)`);
  grad.addColorStop(0.55, `rgba(${r},${g},${b},0.06)`);
  grad.addColorStop(0.8,  `rgba(${r},${g},${b},0.01)`);
  grad.addColorStop(1,    `rgba(${r},${g},${b},0)`);

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIZE, SIZE);
  return Texture.from(canvas, true);
}

export function createStarTexture(color: number, size: number): Texture {
  const RS = 4;
  const outerRadius = size * 2.2 * RS;
  const spikeLength = outerRadius * 4;
  const canvasSize = Math.ceil(spikeLength * 2);
  const center = canvasSize / 2;

  const canvas = document.createElement('canvas');
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  const ctx = canvas.getContext('2d')!;

  const { r: red, g: green, b: blue } = colorToRgb(color);

  // Core drawn first; spikes composite behind it via destination-over.
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, outerRadius * 0.6);
  gradient.addColorStop(0,    'rgba(255,255,255,1)');
  gradient.addColorStop(0.65, `rgba(${red},${green},${blue},0.35)`);
  gradient.addColorStop(0.8,  `rgba(${red},${green},${blue},0.15)`);
  gradient.addColorStop(1,    `rgba(${red},${green},${blue},0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvasSize, canvasSize);

  // spikeWidth is purely proportional so the overlap zone (≈2.55×spikeWidth) always
  // falls inside the core radius (0.6×outerRadius), hiding where spikes converge.
  ctx.globalCompositeOperation = 'destination-over';
  const spikeWidth = outerRadius * 0.12;
  const spikes: [number, number][] = [
    [0,            0.55],
    [Math.PI / 2,  0.55],
    [Math.PI / 4,  0.25],
    [-Math.PI / 4, 0.25],
  ];

  for (const [angle, maxAlpha] of spikes) {
    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(angle);
    const grad = ctx.createLinearGradient(-spikeLength, 0, spikeLength, 0);
    grad.addColorStop(0,    `rgba(${red},${green},${blue},0)`);
    grad.addColorStop(0.35, `rgba(${red},${green},${blue},${maxAlpha * 0.25})`);
    grad.addColorStop(0.5,  `rgba(${red},${green},${blue},${maxAlpha})`);
    grad.addColorStop(0.65, `rgba(${red},${green},${blue},${maxAlpha * 0.25})`);
    grad.addColorStop(1,    `rgba(${red},${green},${blue},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, 0, spikeLength, spikeWidth, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  return Texture.from(canvas, true);
}

export function createShroudedStarTexture(size: number): Texture {
  const radius = size * 2.2 * 4;
  const canvasSize = Math.ceil(radius * 2) + 2;
  const center = canvasSize / 2;

  const canvas = document.createElement('canvas');
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  const ctx = canvas.getContext('2d')!;

  const gradient = ctx.createRadialGradient(center, center, 0, center, center, radius);
  gradient.addColorStop(0,    'rgba(255,180,120,0.8)');
  gradient.addColorStop(0.2,  'rgba(240,100,50,0.65)');
  gradient.addColorStop(0.45, 'rgba(190,48,22,0.32)');
  gradient.addColorStop(0.75, 'rgba(140,28,12,0.1)');
  gradient.addColorStop(1,    'rgba(90,16,8,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvasSize, canvasSize);

  return Texture.from(canvas, true);
}

function makeCircleCanvas(size: number, baseColor: number) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const { r: r0, g: g0, b: b0 } = colorToRgb(baseColor);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = `rgb(${r0},${g0},${b0})`;
  ctx.fillRect(0, 0, size, size);
  return { canvas, ctx, r0, g0, b0 };
}

export function createNeutronStarTexture(seed: number): Texture {
  const rng = createRng(seed);
  const SIZE = 512;
  const center = SIZE / 2;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;

  // Tight, intensely bright core
  const coreGrad = ctx.createRadialGradient(center, center, 0, center, center, 55);
  coreGrad.addColorStop(0,    'rgba(255,255,255,1)');
  coreGrad.addColorStop(0.18, 'rgba(220,248,255,0.95)');
  coreGrad.addColorStop(0.45, 'rgba(140,220,255,0.5)');
  coreGrad.addColorStop(0.75, 'rgba(80,170,255,0.12)');
  coreGrad.addColorStop(1,    'rgba(60,140,255,0)');
  ctx.fillStyle = coreGrad;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Pulsar jets — two opposing beams at a seeded angle
  const jetAngle = rng() * Math.PI;
  ctx.globalCompositeOperation = 'lighter';
  for (let d = 0; d < 2; d++) {
    const angle = jetAngle + d * Math.PI;
    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(angle);

    const jetLen = center * 0.88;
    const jetGrad = ctx.createLinearGradient(0, 0, jetLen, 0);
    jetGrad.addColorStop(0,    'rgba(255,255,255,0.9)');
    jetGrad.addColorStop(0.12, 'rgba(180,240,255,0.7)');
    jetGrad.addColorStop(0.45, 'rgba(100,200,255,0.3)');
    jetGrad.addColorStop(0.78, 'rgba(70,160,255,0.08)');
    jetGrad.addColorStop(1,    'rgba(50,130,255,0)');
    ctx.fillStyle = jetGrad;
    ctx.beginPath();
    ctx.ellipse(jetLen / 2, 0, jetLen / 2, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Faint accretion halo ring
  ctx.globalCompositeOperation = 'source-over';
  ctx.beginPath();
  ctx.ellipse(center, center, 52, 52, 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(120,210,255,0.12)';
  ctx.lineWidth = 4;
  ctx.stroke();

  return Texture.from(canvas, true);
}

export function createBrownDwarfTexture(seed: number): Texture {
  const rng = createRng(seed);
  const SIZE = 256;
  const { canvas, ctx, r0, g0, b0 } = makeCircleCanvas(SIZE, 0x4a1a0a);

  // Subtle atmospheric banding
  const numBands = Math.floor(rng() * 4) + 7;
  let y = 0;
  let prevR = r0, prevG = g0, prevB = b0;
  for (let i = 0; i < numBands; i++) {
    const bandH = Math.ceil(SIZE * (0.5 + rng() * 0.9) / numBands);
    const bri = Math.round((rng() - 0.5) * 28);
    const cr = Math.min(255, Math.max(0, r0 + bri));
    const cg = Math.min(255, Math.max(0, g0 + Math.round((rng() - 0.5) * 10)));
    const cb = Math.min(255, Math.max(0, b0 + Math.round((rng() - 0.5) * 6)));
    const grad = ctx.createLinearGradient(0, y, 0, y + bandH);
    grad.addColorStop(0,    `rgb(${prevR},${prevG},${prevB})`);
    grad.addColorStop(0.3,  `rgb(${cr},${cg},${cb})`);
    grad.addColorStop(1,    `rgb(${cr},${cg},${cb})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, y, SIZE, bandH);
    prevR = cr; prevG = cg; prevB = cb;
    y += bandH;
  }

  // Storm spots
  const numSpots = Math.floor(rng() * 2) + 1;
  for (let i = 0; i < numSpots; i++) {
    const cx = SIZE * 0.2 + rng() * SIZE * 0.6;
    const cy = SIZE * 0.2 + rng() * SIZE * 0.6;
    const rx = 8 + rng() * 18;
    const ry = 4 + rng() * 8;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rng() * 0.4);
    ctx.scale(1, ry / rx);
    const spot = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    spot.addColorStop(0,   'rgba(15,4,1,0.55)');
    spot.addColorStop(0.5, 'rgba(20,6,2,0.25)');
    spot.addColorStop(1,   'rgba(25,8,3,0)');
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fillStyle = spot;
    ctx.fill();
    ctx.restore();
  }

  // Faint internal heat glow at center
  const heat = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, SIZE * 0.35);
  heat.addColorStop(0,   'rgba(155,50,14,0.22)');
  heat.addColorStop(0.5, 'rgba(110,30,8,0.09)');
  heat.addColorStop(1,   'rgba(80,18,4,0)');
  ctx.fillStyle = heat;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Limb darkening in dark reddish-brown instead of black
  const limb = ctx.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.18, SIZE / 2, SIZE / 2, SIZE / 2);
  limb.addColorStop(0,    'rgba(30,8,2,0)');
  limb.addColorStop(0.52, 'rgba(30,8,2,0.10)');
  limb.addColorStop(1,    'rgba(20,5,1,0.38)');
  ctx.fillStyle = limb;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Subtle specular
  const hi = ctx.createRadialGradient(SIZE * 0.38, SIZE * 0.32, 0, SIZE * 0.38, SIZE * 0.32, SIZE * 0.2);
  hi.addColorStop(0,   'rgba(255,255,255,0.08)');
  hi.addColorStop(0.5, 'rgba(255,255,255,0.02)');
  hi.addColorStop(1,   'rgba(255,255,255,0)');
  ctx.fillStyle = hi;
  ctx.fillRect(0, 0, SIZE, SIZE);

  return Texture.from(canvas, true);
}

export function createUniverseStarTexture(): Texture {
  const radius = SC_DOT_TEXTURE_RADIUS;
  const size = radius * 2 + 4;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const center = size / 2;
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, radius);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.35)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fill();
  return Texture.from(canvas, true);
}

export function createSuperclusterDotTexture(): Texture {
  const radius = SC_DOT_TEXTURE_RADIUS;
  const size = radius * 2 + 4;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const center = size / 2;
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, radius);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.72, 'rgba(255,255,255,1)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fill();
  return Texture.from(canvas, true);
}

export const ASTEROID_TEXTURE_RADIUS = 21;
const ASTEROID_TEXTURE_CELL = 64;
const ASTEROID_TEXTURE_COUNT = 8;
const ASTEROID_NOISE_GRID = 9;
const ASTEROID_LIGHT = (() => {
  const length = Math.hypot(0.8, -0.25, 0.55);
  return { x: 0.8 / length, y: -0.25 / length, z: 0.55 / length };
})();

function valueNoise(grid: Float32Array, u: number, v: number) {
  const x = u * (ASTEROID_NOISE_GRID - 1);
  const y = v * (ASTEROID_NOISE_GRID - 1);
  const x0 = Math.min(ASTEROID_NOISE_GRID - 2, Math.floor(x));
  const y0 = Math.min(ASTEROID_NOISE_GRID - 2, Math.floor(y));
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const row = y0 * ASTEROID_NOISE_GRID;
  const top = grid[row + x0] + (grid[row + x0 + 1] - grid[row + x0]) * sx;
  const bottom = grid[row + ASTEROID_NOISE_GRID + x0] + (grid[row + ASTEROID_NOISE_GRID + x0 + 1] - grid[row + ASTEROID_NOISE_GRID + x0]) * sx;
  return top + (bottom - top) * sy;
}

function drawAsteroid(data: Uint8ClampedArray, stride: number, offsetX: number, seed: number) {
  const rng = createRng(seed);
  const elongation = 0.6 + rng() * 0.4;
  const harmonics = [2, 3, 4, 5, 7].map((order) => ({
    order,
    amplitude: (rng() * 0.36) / order,
    phase: rng() * Math.PI * 2,
  }));
  const craters = Array.from({ length: 4 + Math.floor(rng() * 6) }, () => {
    const angle = rng() * Math.PI * 2;
    const reach = Math.sqrt(rng()) * 0.85;
    return { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach, radius: 0.1 + rng() * 0.22 };
  });
  const bumpX = Float32Array.from({ length: ASTEROID_NOISE_GRID * ASTEROID_NOISE_GRID }, () => rng() * 2 - 1);
  const bumpY = Float32Array.from({ length: ASTEROID_NOISE_GRID * ASTEROID_NOISE_GRID }, () => rng() * 2 - 1);
  const albedo = Float32Array.from({ length: ASTEROID_NOISE_GRID * ASTEROID_NOISE_GRID }, () => rng());
  const center = ASTEROID_TEXTURE_CELL / 2;

  for (let py = 0; py < ASTEROID_TEXTURE_CELL; py++) {
    for (let px = 0; px < ASTEROID_TEXTURE_CELL; px++) {
      const dx = (px + 0.5 - center) / ASTEROID_TEXTURE_RADIUS;
      const dy = (py + 0.5 - center) / ASTEROID_TEXTURE_RADIUS / elongation;
      const rho = Math.sqrt(dx * dx + dy * dy);
      const phi = Math.atan2(dy, dx);
      let edge = 1;
      for (const harmonic of harmonics) edge += harmonic.amplitude * Math.cos(harmonic.order * phi + harmonic.phase);
      const normalized = rho / edge;
      const coverage = Math.min(1, Math.max(0, (1 - normalized) * edge * ASTEROID_TEXTURE_RADIUS * elongation + 0.5));
      if (coverage <= 0) continue;

      const inner = Math.min(normalized, 0.999);
      const u = rho > 0 ? dx / rho * inner : 0;
      const v = rho > 0 ? dy / rho * inner : 0;
      let nx = u;
      let ny = v;
      let nz = Math.sqrt(1 - inner * inner);
      let crater = 0;
      for (const hole of craters) {
        const cx = u - hole.x;
        const cy = v - hole.y;
        const distance = Math.sqrt(cx * cx + cy * cy) / hole.radius;
        if (distance < 1) {
          nx -= cx / hole.radius * 0.55;
          ny -= cy / hole.radius * 0.55;
          crater = Math.max(crater, 1 - distance);
        } else if (distance < 1.35) {
          const rim = (1.35 - distance) / 0.35;
          nx += cx / (distance * hole.radius) * rim * 0.3;
          ny += cy / (distance * hole.radius) * rim * 0.3;
        }
      }
      const nu = (dx + 1.4) / 2.8;
      const nv = (dy * elongation + 1.4) / 2.8;
      nx += valueNoise(bumpX, nu, nv) * 0.45;
      ny += valueNoise(bumpY, nu, nv) * 0.45;
      const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= length;
      ny /= length;
      nz /= length;
      const diffuse = Math.max(0, nx * ASTEROID_LIGHT.x + ny * ASTEROID_LIGHT.y + nz * ASTEROID_LIGHT.z);
      const tone = (0.7 + valueNoise(albedo, nu, nv) * 0.4) * (1 - crater * 0.15);
      const shade = Math.min(1, tone * (0.07 + diffuse * 1.05));
      const index = (py * stride + offsetX + px) * 4;
      data[index] = shade * 255;
      data[index + 1] = shade * 250;
      data[index + 2] = shade * 242;
      data[index + 3] = coverage * 255;
    }
  }
}

export function createAsteroidTextures(seed: number): { atlas: Texture; frames: Texture[] } {
  const canvas = document.createElement('canvas');
  canvas.width = ASTEROID_TEXTURE_CELL * ASTEROID_TEXTURE_COUNT;
  canvas.height = ASTEROID_TEXTURE_CELL;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let index = 0; index < ASTEROID_TEXTURE_COUNT; index++) {
    drawAsteroid(image.data, canvas.width, index * ASTEROID_TEXTURE_CELL, (seed + Math.imul(index + 1, 0x9e3779b9)) >>> 0);
  }
  ctx.putImageData(image, 0, 0);
  const atlas = new Texture({ source: new CanvasSource({ resource: canvas, autoGenerateMipmaps: true }) });
  const frames = Array.from({ length: ASTEROID_TEXTURE_COUNT }, (_, index) => new Texture({
    source: atlas.source,
    frame: new Rectangle(index * ASTEROID_TEXTURE_CELL, 0, ASTEROID_TEXTURE_CELL, ASTEROID_TEXTURE_CELL),
  }));
  return { atlas, frames };
}
