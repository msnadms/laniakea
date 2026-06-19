import { Texture, Sprite, DisplacementFilter, Container } from 'pixi.js';
import { GALAXY_RADIUS } from '../game/constants';
import { createRng } from '../game/galaxyGen';

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

  const red   = (color >> 16) & 0xff;
  const green = (color >> 8)  & 0xff;
  const blue  =  color        & 0xff;

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

  const r = (color >> 16) & 0xff;
  const g = (color >> 8)  & 0xff;
  const b =  color        & 0xff;

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

  const red   = (color >> 16) & 0xff;
  const green = (color >> 8)  & 0xff;
  const blue  =  color        & 0xff;

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

export function createGasGiantTexture(baseColor: number, seed: number, isIce = false): Texture {
  const rng = createRng(seed);
  const SIZE = 256;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;

  const r0 = (baseColor >> 16) & 0xff;
  const g0 = (baseColor >> 8)  & 0xff;
  const b0 =  baseColor        & 0xff;

  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
  ctx.clip();

  ctx.fillStyle = `rgb(${r0},${g0},${b0})`;
  ctx.fillRect(0, 0, SIZE, SIZE);

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

  // Sphere-edge shadow
  const shadow = ctx.createRadialGradient(SIZE/2, SIZE/2, SIZE*0.25, SIZE/2, SIZE/2, SIZE/2);
  shadow.addColorStop(0,   'rgba(0,0,0,0)');
  shadow.addColorStop(0.6, 'rgba(0,0,0,0.15)');
  shadow.addColorStop(1,   'rgba(0,0,0,0.72)');
  ctx.fillStyle = shadow;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Specular highlight
  const hi = ctx.createRadialGradient(SIZE*0.33, SIZE*0.28, 0, SIZE*0.33, SIZE*0.28, SIZE*0.32);
  hi.addColorStop(0,   'rgba(255,255,255,0.45)');
  hi.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  hi.addColorStop(1,   'rgba(255,255,255,0)');
  ctx.fillStyle = hi;
  ctx.fillRect(0, 0, SIZE, SIZE);

  return Texture.from(canvas);
}
