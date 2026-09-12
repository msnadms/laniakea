import { Texture } from 'pixi.js';
import { createRng } from '../game/galaxyGen';
import { TAU } from './anomalies/shared';
import { lightCity, type CityLight, type CityLights, type District, type LightPalette } from './ecumenopolis';

const TEXTURE_SIZE = 256;
const TERRACE_BANDS = 22;
const SEAM_COUNT = 7;
const LIT_DISC = 0.88;
const FURNACE_PALETTE: LightPalette = { light: 0xff8a3a, glow: 0xff5a1e };
const FURNACE_LIGHT_COUNT = 260;
const FURNACE_GLOW_ALPHA = 0.3;

function shade(color: number, factor: number, alpha = 1): string {
  const channel = (shift: number) => Math.min(255, Math.round(((color >> shift) & 0xff) * factor));
  return `rgba(${channel(16)},${channel(8)},${channel(0)},${alpha})`;
}

export function createFoundryAlbedoTexture(baseColor: number, seed: number): Texture {
  const rng = createRng((seed ^ 0x3b9d62a1) >>> 0);
  const center = TEXTURE_SIZE / 2;
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(center, center, center, 0, TAU);
  ctx.clip();

  const bandHeight = TEXTURE_SIZE / TERRACE_BANDS;
  const edges: number[][] = [];
  for (let band = 0; band <= TERRACE_BANDS; band++) {
    const wobble = 1 + rng() * 4;
    const phase = rng() * TAU;
    edges.push(Array.from({ length: 17 }, (_, step) => band * bandHeight + Math.sin(phase + step * 0.7) * wobble));
  }
  for (let band = 0; band < TERRACE_BANDS; band++) {
    ctx.beginPath();
    edges[band].forEach((y, step) => ctx.lineTo(step * TEXTURE_SIZE / 16, y));
    for (let step = 16; step >= 0; step--) ctx.lineTo(step * TEXTURE_SIZE / 16, edges[band + 1][step]);
    ctx.closePath();
    ctx.fillStyle = shade(baseColor, 0.34 + (band % 2) * 0.12 + rng() * 0.08);
    ctx.fill();
    ctx.beginPath();
    edges[band].forEach((y, step) => ctx.lineTo(step * TEXTURE_SIZE / 16, y));
    ctx.strokeStyle = 'rgba(10,8,6,0.55)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  const pits = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < pits; i++) {
    const cx = TEXTURE_SIZE * (0.2 + rng() * 0.6);
    const cy = TEXTURE_SIZE * (0.2 + rng() * 0.6);
    const radius = 22 + rng() * 34;
    const terraces = 6;
    for (let k = 0; k < terraces; k++) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius * (1 - k / terraces), 0, TAU);
      ctx.fillStyle = shade(baseColor, 0.42 - k * 0.045 + (k % 2) * 0.06);
      ctx.fill();
    }
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.4);
    core.addColorStop(0, 'rgba(255,196,120,0.95)');
    core.addColorStop(0.45, 'rgba(255,120,40,0.7)');
    core.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = core;
    ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  }

  ctx.shadowColor = 'rgba(255,120,40,0.9)';
  ctx.shadowBlur = 6;
  ctx.strokeStyle = 'rgba(255,150,70,0.8)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < SEAM_COUNT; i++) {
    const edge = edges[1 + Math.floor(rng() * (TERRACE_BANDS - 1))];
    const from = Math.floor(rng() * 12);
    const to = Math.min(16, from + 2 + Math.floor(rng() * 5));
    ctx.beginPath();
    for (let step = from; step <= to; step++) ctx.lineTo(step * TEXTURE_SIZE / 16, edge[step]);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;

  const haze = ctx.createRadialGradient(center, center, TEXTURE_SIZE * 0.42, center, center, center);
  haze.addColorStop(0, 'rgba(150,110,80,0)');
  haze.addColorStop(0.8, 'rgba(150,110,80,0.06)');
  haze.addColorStop(1, 'rgba(150,110,80,0.22)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  return Texture.from(canvas, true);
}

export function createFurnaceLights(seed: number, radius: number): CityLights {
  const rng = createRng((seed ^ 0x9e11c4d7) >>> 0);
  const works: District[] = Array.from({ length: 6 + Math.floor(rng() * 4) }, () => {
    const angle = rng() * TAU;
    const reach = Math.sqrt(rng()) * 0.75;
    return { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach, radius: 0.1 + rng() * 0.15 };
  });
  const lights: CityLight[] = [];
  while (lights.length < FURNACE_LIGHT_COUNT) {
    const work = works[Math.floor(rng() * works.length)];
    const angle = rng() * TAU;
    const reach = Math.sqrt(rng()) * work.radius;
    const x = work.x + Math.cos(angle) * reach;
    const y = work.y + Math.sin(angle) * reach;
    if (x * x + y * y > LIT_DISC) continue;
    lights.push({
      x: x * radius,
      y: y * radius,
      size: radius * (0.014 + rng() * 0.022),
      brightness: 0.5 + rng() * 0.5,
      phase: rng() * TAU,
      rate: 0.3 + rng() * 0.9,
    });
  }
  return lightCity(radius, lights, works, true, FURNACE_GLOW_ALPHA, FURNACE_PALETTE);
}
