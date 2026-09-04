import { Graphics } from 'pixi.js';
import type { FabricatorTier } from '../game/types';

export function createFabricatorGfx(planetRadius: number, tier: FabricatorTier = 1): Graphics {
  const gfx = new Graphics();
  const pr = planetRadius;
  const s = Math.max(7, pr * 0.26);

  const cx = 0;
  const cy = -pr * 0.72;

  if (tier >= 2) return drawAdvanced(gfx, s, cx, cy);

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

function drawAdvanced(gfx: Graphics, s: number, cx: number, cy: number): Graphics {
  const shell = 0x241703;
  const edge = 0xffc04d;

  gfx.rect(cx - s * 2.4, cy, s * 4.8, s * 0.55).fill({ color: 0x3a2a08, alpha: 0.95 });
  gfx.rect(cx - s * 2.4, cy, s * 4.8, s * 0.55).stroke({ color: edge, width: 0.9, alpha: 0.7 });

  gfx.rect(cx - s * 1.5, cy - s * 1.9, s * 3, s * 1.9).fill({ color: shell, alpha: 0.97 });
  gfx.rect(cx - s * 1.5, cy - s * 1.9, s * 3, s * 1.9).stroke({ color: edge, width: 1.1, alpha: 0.85 });

  gfx.rect(cx - s * 0.28, cy - s * 3.6, s * 0.56, s * 1.7).fill({ color: shell, alpha: 0.97 });
  gfx.rect(cx - s * 0.28, cy - s * 3.6, s * 0.56, s * 1.7).stroke({ color: edge, width: 0.8, alpha: 0.75 });

  gfx.moveTo(cx - s * 1.1, cy - s * 3.6);
  gfx.lineTo(cx, cy - s * 4.3);
  gfx.lineTo(cx + s * 1.1, cy - s * 3.6);
  gfx.stroke({ color: edge, width: 1, alpha: 0.8 });

  gfx.circle(cx, cy - s * 4.3, s * 0.22).fill({ color: 0xffe08a, alpha: 0.95 });
  gfx.circle(cx - s * 1.05, cy - s * 2.3, s * 0.17).fill({ color: 0xffc04d, alpha: 0.8 });
  gfx.circle(cx + s * 1.05, cy - s * 2.3, s * 0.17).fill({ color: 0xffc04d, alpha: 0.8 });

  gfx.rect(cx - s * 0.5, cy - s * 1.4, s * 1, s * 0.6).fill({ color: 0xffc04d, alpha: 0.28 });
  gfx.rect(cx - s * 0.5, cy - s * 1.4, s * 1, s * 0.6).stroke({ color: 0xffc04d, width: 0.8, alpha: 0.65 });

  return gfx;
}
