import { Circle, type Container, type Graphics } from 'pixi.js';
import type { Vector3 } from '../../game/anomalies';
import type { Rng } from '../../game/types';
import type { Point3D } from '../projection';
import { smoothstep, TAU } from '../surfaceNoise';

export { smoothstep, TAU };


export const SHELL_Z = 0.002;

function channel(color: number, shift: number): number {
  return (color >> shift) & 0xff;
}

export function mixColor(from: number, to: number, amount: number): number {
  const t = Math.min(1, Math.max(0, amount));
  const mix = (shift: number) => Math.round(channel(from, shift) + (channel(to, shift) - channel(from, shift)) * t);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

export function scaleColor(color: number, factor: number): number {
  const scale = (shift: number) => Math.min(255, Math.max(0, Math.round(channel(color, shift) * factor)));
  return (scale(16) << 16) | (scale(8) << 8) | scale(0);
}


export function sputter(time: number): number {
  const wave = Math.sin(time * 1.31) + Math.sin(time * 2.27 + 1.9) + 0.6 * Math.sin(time * 0.53 + 4.1);
  return smoothstep(0.55, 1.45, wave) * (0.72 + 0.28 * Math.sin(time * 41));
}

export function toSystemDirection(direction: Vector3 | null): Point3D {
  if (!direction) return { x: 1, y: 0, z: 0 };
  const length = Math.hypot(direction.x, direction.y, direction.z) || 1;
  return { x: direction.x / length, y: direction.z / length, z: direction.y / length };
}

export function randomUnitVector(rng: Rng): Point3D {
  const y = rng() * 2 - 1;
  const ring = Math.sqrt(1 - y * y);
  const theta = rng() * TAU;
  return { x: Math.cos(theta) * ring, y, z: Math.sin(theta) * ring };
}

export function makeSelectable(node: Container, radius: number, onSelect: () => void) {
  node.hitArea = new Circle(0, 0, radius);
  node.eventMode = 'static';
  node.cursor = 'pointer';
  node.on('pointertap', onSelect);
}

export function drawTaper(
  gfx: Graphics,
  x0: number, y0: number,
  x1: number, y1: number,
  width0: number, width1: number,
  color: number, alpha: number,
) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  if (length < 1e-3 || alpha <= 0) return;
  const px = -dy / length;
  const py = dx / length;
  gfx
    .moveTo(x0 + px * width0, y0 + py * width0)
    .lineTo(x1 + px * width1, y1 + py * width1)
    .lineTo(x1 - px * width1, y1 - py * width1)
    .lineTo(x0 - px * width0, y0 - py * width0)
    .closePath()
    .fill({ color, alpha });
}
