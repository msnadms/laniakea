import type { Graphics } from 'pixi.js';

export function drawVisitedRings(gfx: Graphics, points: { x: number; y: number }[], count = points.length) {
  if (count === 0) return;
  for (let i = 0; i < count; i++) gfx.circle(points[i].x, points[i].y, 8);
  gfx.stroke({ color: 0xffffff, width: 1.5, alpha: 0.75 });
  for (let i = 0; i < count; i++) gfx.circle(points[i].x, points[i].y, 11);
  gfx.stroke({ color: 0xffffff, width: 0.5, alpha: 0.25 });
}

export function drawCrosshair(gfx: Graphics, x: number, y: number, elapsedSecs: number) {
  gfx.circle(x, y, 5);
  gfx.fill({ color: 0x00e8ff, alpha: 0.55 });
  gfx.circle(x, y, 12);
  gfx.stroke({ color: 0x00e8ff, width: 2, alpha: 0.95 });
  gfx.circle(x, y, 18);
  gfx.stroke({ color: 0x00e8ff, width: 1, alpha: 0.55 });

  const gap = 20, arm = 38;
  gfx.moveTo(x - arm, y).lineTo(x - gap, y);
  gfx.moveTo(x + gap, y).lineTo(x + arm, y);
  gfx.moveTo(x, y - arm).lineTo(x, y - gap);
  gfx.moveTo(x, y + gap).lineTo(x, y + arm);
  gfx.stroke({ color: 0x00e8ff, width: 1.5, alpha: 0.85 });

  const nub = 4;
  gfx.moveTo(x - arm, y - nub).lineTo(x - arm, y + nub);
  gfx.moveTo(x + arm, y - nub).lineTo(x + arm, y + nub);
  gfx.moveTo(x - nub, y - arm).lineTo(x + nub, y - arm);
  gfx.moveTo(x - nub, y + arm).lineTo(x + nub, y + arm);
  gfx.stroke({ color: 0x00e8ff, width: 1.5, alpha: 0.65 });

  const pulse = 0.5 + 0.5 * Math.sin(elapsedSecs * Math.PI * 2 * 0.7);
  const outerR = 26 + pulse * 10;
  gfx.circle(x, y, outerR);
  gfx.stroke({ color: 0x00e8ff, width: 1.2, alpha: 0.2 + pulse * 0.45 });
  gfx.circle(x, y, outerR + 6);
  gfx.stroke({ color: 0x00e8ff, width: 0.6, alpha: 0.08 + pulse * 0.18 });
}
