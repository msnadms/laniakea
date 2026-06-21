import { Texture, Sprite, DisplacementFilter, Container } from 'pixi.js';
import { GALAXY_RADIUS } from '../game/constants';
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
  return Texture.from(canvas);
}

export function createDisplacementSetup(container: Container, initialScale: number) {
  const dispTexture = createDisplacementTexture();
  const dispSprite = new Sprite(dispTexture);
  dispSprite.anchor.set(0.5);
  dispSprite.width = GALAXY_RADIUS * 3;
  dispSprite.height = GALAXY_RADIUS * 3;
  dispSprite.renderable = false;

  const dispFilter = new DisplacementFilter({ sprite: dispSprite, scale: initialScale });
  container.filters = [dispFilter];
  container.addChild(dispSprite);

  return {
    update(elapsedSecs: number, filterScale: number) {
      dispSprite.x = Math.sin(elapsedSecs * 0.06) * 120;
      dispSprite.y = Math.cos(elapsedSecs * 0.045) * 120;
      dispSprite.rotation = elapsedSecs * 0.008;
      dispFilter.scale.x = filterScale;
      dispFilter.scale.y = filterScale;
    },
    destroy() {
      dispFilter.destroy();
      dispTexture.destroy(true);
    },
  };
}

export function createSunTexture(color: number): Texture {
  const SIZE = 512;
  const center = SIZE / 2;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;

  const { r: red, g: green, b: blue } = colorToRgb(color);

  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0,    'rgba(255,255,255,1)');
  gradient.addColorStop(0.1,  'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.25, `rgba(${red},${green},${blue},1)`);
  gradient.addColorStop(0.5,  `rgba(${red},${green},${blue},0.35)`);
  gradient.addColorStop(0.75, `rgba(${red},${green},${blue},0.08)`);
  gradient.addColorStop(1,    `rgba(${red},${green},${blue},0)`);

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SIZE, SIZE);

  return Texture.from(canvas);
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
  return Texture.from(canvas);
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

  return Texture.from(canvas);
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

type ShadowOpts   = { inner: number; stop: number; midA: number; outerA: number };
type SpecularOpts = { ox: number; oy: number; r: number; a: number };

function applySphereShading(ctx: CanvasRenderingContext2D, SIZE: number, sh: ShadowOpts, sp: SpecularOpts) {
  const shadow = ctx.createRadialGradient(SIZE/2, SIZE/2, SIZE*sh.inner, SIZE/2, SIZE/2, SIZE/2);
  shadow.addColorStop(0,       'rgba(0,0,0,0)');
  shadow.addColorStop(sh.stop, `rgba(0,0,0,${sh.midA})`);
  shadow.addColorStop(1,       `rgba(0,0,0,${sh.outerA})`);
  ctx.fillStyle = shadow;
  ctx.fillRect(0, 0, SIZE, SIZE);

  const hi = ctx.createRadialGradient(SIZE*sp.ox, SIZE*sp.oy, 0, SIZE*sp.ox, SIZE*sp.oy, SIZE*sp.r);
  hi.addColorStop(0,   `rgba(255,255,255,${sp.a})`);
  hi.addColorStop(0.5, `rgba(255,255,255,${+(sp.a * 0.22).toFixed(2)})`);
  hi.addColorStop(1,   'rgba(255,255,255,0)');
  ctx.fillStyle = hi;
  ctx.fillRect(0, 0, SIZE, SIZE);
}

export function createRockyPlanetTexture(baseColor: number, seed: number): Texture {
  const rng = createRng(seed);
  const SIZE = 256;
  const { canvas, ctx, r0, g0, b0 } = makeCircleCanvas(SIZE, baseColor);

  // Large terrain patches
  const numPatches = Math.floor(rng() * 8) + 10;
  for (let i = 0; i < numPatches; i++) {
    const cx  = rng() * SIZE;
    const cy  = rng() * SIZE;
    const rad = 15 + rng() * 65;
    const bri = Math.round((rng() - 0.5) * 80);
    const cr  = Math.min(255, Math.max(0, r0 + bri));
    const cg  = Math.min(255, Math.max(0, g0 + bri));
    const cb  = Math.min(255, Math.max(0, b0 + Math.round((rng() - 0.5) * 30)));
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grad.addColorStop(0, `rgba(${cr},${cg},${cb},${0.3 + rng() * 0.45})`);
    grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }

  // Small craters
  const numCraters = Math.floor(rng() * 6) + 5;
  for (let i = 0; i < numCraters; i++) {
    const cx  = rng() * SIZE;
    const cy  = rng() * SIZE;
    const rad = 2 + rng() * 9;
    const cr  = Math.max(0, r0 - 35);
    const cg  = Math.max(0, g0 - 35);
    const cb  = Math.max(0, b0 - 35);
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${cr},${cg},${cb},0.55)`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${Math.min(255, r0 + 40)},${Math.min(255, g0 + 40)},${Math.min(255, b0 + 40)},0.4)`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Lava glints — desaturated warm hot spots
  const numLava = Math.floor(rng() * 3) + 1;
  for (let i = 0; i < numLava; i++) {
    const cx  = rng() * SIZE;
    const cy  = rng() * SIZE;
    const rad = 3 + rng() * 14;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grad.addColorStop(0,    `rgba(200,160,80,0.38)`);
    grad.addColorStop(0.45, `rgba(175,100,45,0.2)`);
    grad.addColorStop(1,    `rgba(140,60,20,0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }

  applySphereShading(ctx, SIZE,
    { inner: 0.25, stop: 0.6, midA: 0.2,  outerA: 0.78 },
    { ox: 0.33,   oy: 0.28,  r: 0.28,    a: 0.38 },
  );
  return Texture.from(canvas);
}

export function createHabitablePlanetTexture(baseColor: number, seed: number): Texture {
  const rng = createRng(seed);
  const SIZE = 256;
  const { canvas, ctx, r0, g0, b0 } = makeCircleCanvas(SIZE, baseColor);

  // Ocean patches — dark blue seas
  const OCEAN_PALETTES = [
    [28, 60, 110], [35, 72, 130], [22, 55, 100],
    [40, 80, 140], [30, 65, 120],
  ];
  const numOceans = Math.floor(rng() * 3) + 2;
  for (let i = 0; i < numOceans; i++) {
    const cx    = rng() * SIZE;
    const cy    = SIZE * 0.1 + rng() * SIZE * 0.8;
    const rx    = 22 + rng() * 55;
    const ry    = 15 + rng() * 38;
    const angle = rng() * Math.PI * 2;
    const [cr, cg, cb] = OCEAN_PALETTES[Math.floor(rng() * OCEAN_PALETTES.length)];

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    const numBlobs = Math.floor(rng() * 3) + 2;
    ctx.beginPath();
    for (let b = 0; b < numBlobs; b++) {
      const bx = (rng() - 0.5) * rx * 0.8;
      const by = (rng() - 0.5) * ry * 0.8;
      const br = rx * (0.3 + rng() * 0.6);
      ctx.moveTo(bx + br, by);
      ctx.arc(bx, by, br, 0, Math.PI * 2);
    }
    ctx.fillStyle = `rgba(${cr},${cg},${cb},0.72)`;
    ctx.fill();
    ctx.restore();
  }

  // Continents — overlapping irregular blobs (darker greens)
  const CONTINENT_PALETTES = [
    [52, 78, 30],  [65, 90, 22],  [45, 72, 28],
    [40, 62, 32],  [58, 85, 25],  [55, 75, 40],
  ];
  const numContinents = Math.floor(rng() * 4) + 3;
  for (let i = 0; i < numContinents; i++) {
    const cx    = rng() * SIZE;
    const cy    = SIZE * 0.1 + rng() * SIZE * 0.8;
    const rx    = 28 + rng() * 58;
    const ry    = 18 + rng() * 40;
    const angle = rng() * Math.PI * 2;
    const [cr, cg, cb] = CONTINENT_PALETTES[Math.floor(rng() * CONTINENT_PALETTES.length)];
    const alpha = 0.72 + rng() * 0.26;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    const numBlobs = Math.floor(rng() * 4) + 3;
    ctx.beginPath();
    for (let b = 0; b < numBlobs; b++) {
      const bx = (rng() - 0.5) * rx * 0.9;
      const by = (rng() - 0.5) * ry * 0.9;
      const br = rx * (0.35 + rng() * 0.65);
      ctx.moveTo(bx + br, by);
      ctx.arc(bx, by, br, 0, Math.PI * 2);
    }
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha})`;
    ctx.fill();
    ctx.restore();
  }

  // Polar ice caps
  const capR = 22 + rng() * 20;
  const northGrad = ctx.createRadialGradient(SIZE/2, 0, 0, SIZE/2, 0, capR);
  northGrad.addColorStop(0,   'rgba(235,248,255,0.95)');
  northGrad.addColorStop(0.6, 'rgba(215,235,250,0.55)');
  northGrad.addColorStop(1,   'rgba(200,225,245,0)');
  ctx.fillStyle = northGrad;
  ctx.fillRect(0, 0, SIZE, capR * 1.6);

  const southGrad = ctx.createRadialGradient(SIZE/2, SIZE, 0, SIZE/2, SIZE, capR);
  southGrad.addColorStop(0,   'rgba(235,248,255,0.9)');
  southGrad.addColorStop(0.6, 'rgba(215,235,250,0.5)');
  southGrad.addColorStop(1,   'rgba(200,225,245,0)');
  ctx.fillStyle = southGrad;
  ctx.fillRect(0, SIZE - capR * 1.6, SIZE, capR * 1.6);

  // Atmospheric edge glow
  const atmo = ctx.createRadialGradient(SIZE/2, SIZE/2, SIZE*0.42, SIZE/2, SIZE/2, SIZE/2);
  atmo.addColorStop(0,   'rgba(100,165,255,0)');
  atmo.addColorStop(0.8, 'rgba(100,165,255,0.06)');
  atmo.addColorStop(1,   'rgba(100,165,255,0.22)');
  ctx.fillStyle = atmo;
  ctx.fillRect(0, 0, SIZE, SIZE);

  applySphereShading(ctx, SIZE,
    { inner: 0.25, stop: 0.6, midA: 0.15, outerA: 0.72 },
    { ox: 0.33,   oy: 0.28,  r: 0.3,     a: 0.52 },
  );
  return Texture.from(canvas);
}

export function createMoonTexture(baseColor: number, seed: number): Texture {
  const rng = createRng(seed);
  const SIZE = 128;
  const { canvas, ctx, r0, g0, b0 } = makeCircleCanvas(SIZE, baseColor);

  // Maria — large dark irregular regions
  const numMaria = Math.floor(rng() * 3) + 2;
  for (let i = 0; i < numMaria; i++) {
    const cx  = rng() * SIZE;
    const cy  = rng() * SIZE;
    const rad = 8 + rng() * 32;
    const dk  = Math.round(25 + rng() * 45);
    const cr  = Math.max(0, r0 - dk);
    const cg  = Math.max(0, g0 - dk);
    const cb  = Math.max(0, b0 - dk);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grad.addColorStop(0,   `rgba(${cr},${cg},${cb},0.72)`);
    grad.addColorStop(0.7, `rgba(${cr},${cg},${cb},0.38)`);
    grad.addColorStop(1,   `rgba(${cr},${cg},${cb},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }

  // Craters
  const numCraters = Math.floor(rng() * 5) + 5;
  for (let i = 0; i < numCraters; i++) {
    const cx  = rng() * SIZE;
    const cy  = rng() * SIZE;
    const rad = 2 + rng() * 10;
    const dk  = Math.round(20 + rng() * 35);
    const cr  = Math.max(0, r0 - dk);
    const cg  = Math.max(0, g0 - dk);
    const cb  = Math.max(0, b0 - dk);
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${cr},${cg},${cb},0.55)`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${Math.min(255, r0 + 35)},${Math.min(255, g0 + 35)},${Math.min(255, b0 + 35)},0.38)`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  applySphereShading(ctx, SIZE,
    { inner: 0.2,  stop: 0.55, midA: 0.22, outerA: 0.82 },
    { ox: 0.34,   oy: 0.28,   r: 0.26,    a: 0.22 },
  );
  return Texture.from(canvas);
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

  return Texture.from(canvas);
}

export function createGasGiantTexture(baseColor: number, seed: number, isIce = false): Texture {
  const rng = createRng(seed);
  const SIZE = 256;
  const { canvas, ctx, r0, g0, b0 } = makeCircleCanvas(SIZE, baseColor);

  const numBands = isIce ? Math.floor(rng() * 3) + 4 : Math.floor(rng() * 4) + 6;
  const spread = isIce ? 35 : 55;
  let y = 0;
  let prevR = r0, prevG = g0, prevB = b0;
  for (let i = 0; i < numBands; i++) {
    const bandH = Math.ceil(SIZE * (0.6 + rng() * 0.8) / numBands);
    const brightness = Math.round((rng() - 0.5) * spread);
    const cr = Math.min(255, Math.max(0, r0 + brightness));
    const cg = Math.min(255, Math.max(0, g0 + brightness));
    const cb = Math.min(255, Math.max(0, b0 + Math.round((rng() - 0.5) * spread * (isIce ? 0.8 : 0.5))));
    const grad = ctx.createLinearGradient(0, y, 0, y + bandH);
    grad.addColorStop(0,    `rgb(${prevR},${prevG},${prevB})`);
    grad.addColorStop(0.25, `rgb(${cr},${cg},${cb})`);
    grad.addColorStop(1,    `rgb(${cr},${cg},${cb})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, y, SIZE, bandH);
    prevR = cr; prevG = cg; prevB = cb;
    y += bandH;
  }

  applySphereShading(ctx, SIZE,
    { inner: 0.25, stop: 0.6, midA: 0.15, outerA: 0.72 },
    { ox: 0.33,   oy: 0.28,  r: 0.32,    a: 0.45 },
  );
  return Texture.from(canvas);
}
