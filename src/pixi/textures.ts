import { Texture } from 'pixi.js';

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
