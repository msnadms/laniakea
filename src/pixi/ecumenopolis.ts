import { Graphics, Texture } from 'pixi.js';
import { createRng } from '../game/galaxyGen';
import type { Rng } from '../game/types';
import { smoothstep } from './anomalies/shared';
import type { Point3D } from './projection';

export interface District {
  x: number;
  y: number;
  radius: number;
}

export interface LightPalette {
  light: number;
  glow: number;
}

export interface CityLight {
  x: number;
  y: number;
  size: number;
  brightness: number;
  phase: number;
  rate: number;
}

export interface CityLights {
  node: Graphics;
  update(lightDirection: Point3D, elapsed: number): void;
}

const TEXTURE_SIZE = 256;
const BLOCK_SIZE = 6;
const LIGHT_LEVELS = 8;
const LIT_DISC = 0.88;
const LIVING_LIGHT_COUNT = 520;
const RUINED_LIGHT_COUNT = 90;
const LIVING_LIGHT_COLOR = 0xffc46a;
const LIVING_GLOW_COLOR = 0xff9a3c;
const RUINED_LIGHT_COLOR = 0xcfdcff;
const LIVING_PALETTE: LightPalette = { light: LIVING_LIGHT_COLOR, glow: LIVING_GLOW_COLOR };
const RUINED_PALETTE: LightPalette = { light: RUINED_LIGHT_COLOR, glow: LIVING_GLOW_COLOR };
const DISTRICT_GLOW_ALPHA = 0.22;
const SETTLEMENT_CITY_MIN = 8;
const SETTLEMENT_CITY_SPREAD = 6;
const SETTLEMENT_LIGHTS_PER_CITY = 16;
const SETTLEMENT_RURAL_LIGHTS = 50;
const SETTLEMENT_GLOW_ALPHA = 0.3;
const SETTLEMENT_GLOW_SPREAD = 1.8;

function cityDistricts(seed: number): District[] {
  const rng = createRng((seed ^ 0x2f6b4c1d) >>> 0);
  return Array.from({ length: 7 + Math.floor(rng() * 6) }, () => {
    const angle = rng() * Math.PI * 2;
    const reach = Math.sqrt(rng()) * 0.8;
    return { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach, radius: 0.12 + rng() * 0.22 };
  });
}

function districtDensity(districts: readonly District[], x: number, y: number): number {
  let density = 0;
  for (const district of districts) {
    density = Math.max(density, 1 - Math.hypot(x - district.x, y - district.y) / district.radius);
  }
  return density;
}

function rgb(r: number, g: number, b: number): string {
  const clamp = (value: number) => Math.min(255, Math.max(0, Math.round(value)));
  return `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
}

export function createEcumenopolisAlbedoTexture(baseColor: number, seed: number, living: boolean): Texture {
  const rng = createRng(seed);
  const districts = cityDistricts(seed);
  const center = TEXTURE_SIZE / 2;
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(center, center, center, 0, Math.PI * 2);
  ctx.clip();

  const tone = living ? 1 : 0.62;
  const r0 = ((baseColor >> 16) & 0xff) * tone;
  const g0 = ((baseColor >> 8) & 0xff) * tone;
  const b0 = (baseColor & 0xff) * tone;
  ctx.fillStyle = rgb(r0 * 0.45, g0 * 0.45, b0 * 0.45);
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  for (let y = 0; y < TEXTURE_SIZE; y += BLOCK_SIZE) {
    for (let x = 0; x < TEXTURE_SIZE; x += BLOCK_SIZE) {
      const u = (x + BLOCK_SIZE / 2) / TEXTURE_SIZE * 2 - 1;
      const v = (y + BLOCK_SIZE / 2) / TEXTURE_SIZE * 2 - 1;
      const shade = 0.78 + rng() * 0.3 + districtDensity(districts, u, v) * 0.3;
      ctx.fillStyle = rgb(r0 * shade, g0 * shade, b0 * shade);
      ctx.fillRect(x + 1, y + 1, BLOCK_SIZE - 2, BLOCK_SIZE - 2);
    }
  }

  const numSeas = Math.floor(rng() * 2) + 2;
  for (let i = 0; i < numSeas; i++) {
    const cx = rng() * TEXTURE_SIZE;
    const cy = TEXTURE_SIZE * 0.15 + rng() * TEXTURE_SIZE * 0.7;
    const rad = 26 + rng() * 40;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grad.addColorStop(0, living ? 'rgba(22,28,36,0.5)' : 'rgba(12,10,8,0.55)');
    grad.addColorStop(0.7, living ? 'rgba(22,28,36,0.3)' : 'rgba(12,10,8,0.3)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  }

  const numArteries = Math.floor(rng() * 3) + 3;
  ctx.strokeStyle = living ? 'rgba(236,214,170,0.35)' : 'rgba(20,16,12,0.5)';
  for (let i = 0; i < numArteries; i++) {
    const from = rng() * Math.PI * 2;
    const to = from + Math.PI + (rng() - 0.5) * 1.6;
    ctx.beginPath();
    ctx.moveTo(center + Math.cos(from) * center, center + Math.sin(from) * center);
    ctx.quadraticCurveTo(
      center + (rng() - 0.5) * center, center + (rng() - 0.5) * center,
      center + Math.cos(to) * center, center + Math.sin(to) * center,
    );
    ctx.lineWidth = 1.5 + rng() * 1.5;
    ctx.stroke();
  }

  if (!living) {
    const numScars = Math.floor(rng() * 4) + 4;
    for (let i = 0; i < numScars; i++) {
      const cx = rng() * TEXTURE_SIZE;
      const cy = rng() * TEXTURE_SIZE;
      const rad = 8 + rng() * 26;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      grad.addColorStop(0, 'rgba(26,20,15,0.7)');
      grad.addColorStop(0.5, 'rgba(48,38,30,0.35)');
      grad.addColorStop(1, 'rgba(48,38,30,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    }
  }

  const haze = ctx.createRadialGradient(center, center, TEXTURE_SIZE * 0.42, center, center, center);
  const hazeColor = living ? '214,190,150' : '140,120,100';
  haze.addColorStop(0, `rgba(${hazeColor},0)`);
  haze.addColorStop(0.8, `rgba(${hazeColor},0.06)`);
  haze.addColorStop(1, `rgba(${hazeColor},0.24)`);
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  return Texture.from(canvas, true);
}

export function lightCity(
  radius: number,
  lights: readonly CityLight[],
  glows: readonly District[],
  living: boolean,
  glowAlpha: number,
  palette: LightPalette,
): CityLights {
  const node = new Graphics();
  node.blendMode = 'add';
  node.eventMode = 'none';
  const color = palette.light;
  const buckets: CityLight[][] = Array.from({ length: LIGHT_LEVELS }, () => []);

  return {
    node,
    update(lightDirection: Point3D, elapsed: number) {
      const planar = Math.hypot(lightDirection.x, lightDirection.y) || 1;
      const cos = lightDirection.x / planar;
      const sin = lightDirection.y / planar;
      const exposure = Math.max(0.35, Math.min(1, 1 - lightDirection.z * 0.45));
      const nightAt = (x: number, y: number) => smoothstep(0.62, 0.3, ((x * cos + y * sin) / radius + 1) / 2) * exposure;

      node.clear();
      for (const glow of glows) {
        const strength = nightAt(glow.x * radius, glow.y * radius);
        if (strength > 0.01) {
          node.circle(glow.x * radius, glow.y * radius, glow.radius * radius)
            .fill({ color: palette.glow, alpha: glowAlpha * strength });
        }
      }

      for (const bucket of buckets) bucket.length = 0;
      for (const light of lights) {
        const pulse = living
          ? 0.85 + 0.15 * Math.sin(elapsed * light.rate * 4 + light.phase)
          : smoothstep(0.1, 0.4, Math.sin(elapsed * light.rate + light.phase));
        const level = Math.round(nightAt(light.x, light.y) * light.brightness * pulse * LIGHT_LEVELS);
        if (level > 0) buckets[Math.min(LIGHT_LEVELS, level) - 1].push(light);
      }

      buckets.forEach((bucket, index) => {
        if (bucket.length === 0) return;
        const alpha = (index + 1) / LIGHT_LEVELS;
        if (!living) {
          for (const light of bucket) node.circle(light.x, light.y, light.size * 4);
          node.fill({ color, alpha: alpha * 0.18 });
        }
        for (const light of bucket) node.circle(light.x, light.y, light.size);
        node.fill({ color, alpha });
      });
    },
  };
}

export function createCityLights(seed: number, radius: number, living: boolean, integrity: number): CityLights {
  const rng = createRng((seed ^ 0x7c15a3e9) >>> 0);
  const districts = cityDistricts(seed);
  const count = living ? LIVING_LIGHT_COUNT : Math.round(RUINED_LIGHT_COUNT * integrity);
  const lights: CityLight[] = [];
  while (lights.length < count) {
    const district = rng() < 0.8 ? districts[Math.floor(rng() * districts.length)] : null;
    const angle = rng() * Math.PI * 2;
    const reach = Math.sqrt(rng()) * (district ? district.radius : 1);
    const x = (district?.x ?? 0) + Math.cos(angle) * reach;
    const y = (district?.y ?? 0) + Math.sin(angle) * reach;
    if (x * x + y * y > LIT_DISC) continue;
    lights.push({
      x: x * radius,
      y: y * radius,
      size: radius * (0.012 + rng() * 0.02),
      brightness: 0.45 + rng() * 0.55,
      phase: rng() * Math.PI * 2,
      rate: 0.2 + rng() * 0.5,
    });
  }
  return lightCity(radius, lights, living ? districts : [], living, DISTRICT_GLOW_ALPHA, living ? LIVING_PALETTE : RUINED_PALETTE);
}

function landSampler(canvas: HTMLCanvasElement): (x: number, y: number) => boolean {
  const { width, height } = canvas;
  const { data } = canvas.getContext('2d')!.getImageData(0, 0, width, height);
  return (x, y) => {
    if (x * x + y * y > LIT_DISC) return false;
    const px = Math.min(width - 1, Math.floor((x + 1) / 2 * width));
    const py = Math.min(height - 1, Math.floor((y + 1) / 2 * height));
    const index = (py * width + px) * 4;
    return data[index + 1] > data[index + 2] + 4;
  };
}

function settlementLight(rng: Rng, x: number, y: number, radius: number, brightness: number): CityLight {
  return {
    x: x * radius,
    y: y * radius,
    size: radius * (0.01 + rng() * 0.014),
    brightness: brightness * (0.6 + rng() * 0.4),
    phase: rng() * Math.PI * 2,
    rate: 0.2 + rng() * 0.5,
  };
}

export function createSettlementLights(landCanvas: HTMLCanvasElement, seed: number, radius: number): CityLights {
  const rng = createRng((seed ^ 0x4d2a91c7) >>> 0);
  const isLand = landSampler(landCanvas);

  const cityCount = SETTLEMENT_CITY_MIN + Math.floor(rng() * SETTLEMENT_CITY_SPREAD);
  const cities: District[] = [];
  for (let tries = 0; cities.length < cityCount && tries < cityCount * 60; tries++) {
    const x = rng() * 2 - 1;
    const y = rng() * 2 - 1;
    if (isLand(x, y)) cities.push({ x, y, radius: 0.03 + rng() * 0.06 });
  }

  const lights: CityLight[] = [];
  for (const city of cities) {
    for (let placed = 0, tries = 0; placed < SETTLEMENT_LIGHTS_PER_CITY && tries < SETTLEMENT_LIGHTS_PER_CITY * 6; tries++) {
      const angle = rng() * Math.PI * 2;
      const reach = Math.pow(rng(), 1.5) * city.radius;
      const x = city.x + Math.cos(angle) * reach;
      const y = city.y + Math.sin(angle) * reach;
      if (!isLand(x, y)) continue;
      lights.push(settlementLight(rng, x, y, radius, 1));
      placed++;
    }
  }
  for (let placed = 0, tries = 0; placed < SETTLEMENT_RURAL_LIGHTS && tries < SETTLEMENT_RURAL_LIGHTS * 10; tries++) {
    const x = rng() * 2 - 1;
    const y = rng() * 2 - 1;
    if (!isLand(x, y)) continue;
    lights.push(settlementLight(rng, x, y, radius, 0.5));
    placed++;
  }

  const glows = cities.map((city) => ({ ...city, radius: city.radius * SETTLEMENT_GLOW_SPREAD }));
  return lightCity(radius, lights, glows, true, SETTLEMENT_GLOW_ALPHA, LIVING_PALETTE);
}
