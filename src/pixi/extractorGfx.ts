import { Graphics } from 'pixi.js';

export function createExtractorGfx(planetRadius: number): Graphics {
  const gfx = new Graphics();
  const orbitR = planetRadius * 1.5;
  const bs = Math.max(6, planetRadius * 0.18); // body circumradius
  const bx = orbitR; // satellite sits at (orbitR, 0)

  // orbit ring
  gfx.circle(0, 0, orbitR).stroke({ color: 0x00ffcc, width: 1, alpha: 0.35 });

  // solar panels — slim horizontal bars
  const panelW = bs * 2.8;
  const panelH = bs * 0.32;
  const panelGap = bs * 1.2;
  // left panel
  gfx.rect(bx - panelGap - panelW, -panelH / 2, panelW, panelH).fill({ color: 0x2277bb, alpha: 0.92 });
  gfx.rect(bx - panelGap - panelW, -panelH / 2, panelW, panelH).stroke({ color: 0x44aaee, width: 0.6, alpha: 0.8 });
  // right panel
  gfx.rect(bx + panelGap, -panelH / 2, panelW, panelH).fill({ color: 0x2277bb, alpha: 0.92 });
  gfx.rect(bx + panelGap, -panelH / 2, panelW, panelH).stroke({ color: 0x44aaee, width: 0.6, alpha: 0.8 });
  // centre connector rod
  gfx.rect(bx - panelGap, -panelH * 0.18, panelGap * 2, panelH * 0.36).fill({ color: 0x335566, alpha: 0.9 });

  // hexagonal body
  const hex: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    hex.push([bx + Math.cos(a) * bs, Math.sin(a) * bs]);
  }
  gfx.poly(hex.flat()).fill({ color: 0x0d2233, alpha: 0.97 });
  gfx.poly(hex.flat()).stroke({ color: 0x00ffcc, width: 1, alpha: 0.75 });

  // reactor core dot
  gfx.circle(bx, 0, bs * 0.28).fill({ color: 0x00ffcc, alpha: 0.95 });
  gfx.circle(bx, 0, bs * 0.14).fill({ color: 0xffffff, alpha: 0.9 });

  return gfx;
}
