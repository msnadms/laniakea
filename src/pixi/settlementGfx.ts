import { Graphics } from 'pixi.js';

export function createSettlementGfx(planetRadius: number): Graphics {
  const gfx = new Graphics();
  const pr = planetRadius;
  const s = Math.max(7, pr * 0.26);

  const cx = 0;
  const cy = -pr * 0.72;

  // foundation slab
  gfx.rect(cx - s * 2, cy, s * 4, s * 0.5).fill({ color: 0x224433, alpha: 0.95 });
  gfx.rect(cx - s * 2, cy, s * 4, s * 0.5).stroke({ color: 0x44aa66, width: 0.8, alpha: 0.7 });

  // main factory body
  gfx.rect(cx - s * 1.2, cy - s * 1.6, s * 2.4, s * 1.6).fill({ color: 0x0d2218, alpha: 0.97 });
  gfx.rect(cx - s * 1.2, cy - s * 1.6, s * 2.4, s * 1.6).stroke({ color: 0x44aa66, width: 1, alpha: 0.8 });

  // left chimney
  gfx.rect(cx - s * 0.9, cy - s * 2.4, s * 0.45, s * 0.8).fill({ color: 0x0d2218, alpha: 0.97 });
  gfx.rect(cx - s * 0.9, cy - s * 2.4, s * 0.45, s * 0.8).stroke({ color: 0x44aa66, width: 0.7, alpha: 0.7 });

  // right chimney
  gfx.rect(cx + s * 0.45, cy - s * 2.1, s * 0.45, s * 0.5).fill({ color: 0x0d2218, alpha: 0.97 });
  gfx.rect(cx + s * 0.45, cy - s * 2.1, s * 0.45, s * 0.5).stroke({ color: 0x44aa66, width: 0.7, alpha: 0.7 });

  // emission dots on chimney tops
  gfx.circle(cx - s * 0.675, cy - s * 2.4, s * 0.18).fill({ color: 0x00ff88, alpha: 0.9 });
  gfx.circle(cx + s * 0.675, cy - s * 2.1, s * 0.18).fill({ color: 0x00ff88, alpha: 0.7 });

  // central viewport
  gfx.rect(cx - s * 0.35, cy - s * 1.2, s * 0.7, s * 0.5).fill({ color: 0x00ff88, alpha: 0.25 });
  gfx.rect(cx - s * 0.35, cy - s * 1.2, s * 0.7, s * 0.5).stroke({ color: 0x00ff88, width: 0.8, alpha: 0.6 });

  return gfx;
}
