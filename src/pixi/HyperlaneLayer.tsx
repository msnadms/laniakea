import { memo, useCallback } from 'react';
import { Graphics } from 'pixi.js';
import type { Galaxy } from '../game/types';

export const HyperlaneLayer = memo(function HyperlaneLayer({ galaxy }: { galaxy: Galaxy }) {
  const draw = useCallback(
    (gfx: Graphics) => {
      gfx.clear();
      for (const lane of galaxy.hyperlanes) {
        const from = galaxy.systems[lane.from];
        const to   = galaxy.systems[lane.to];
        gfx.moveTo(from.x, from.y);
        gfx.lineTo(to.x, to.y);
      }
      gfx.stroke({ color: 0xffffff, width: 1.2, alpha: 0.1 });
    },
    [galaxy],
  );

  return <pixiGraphics draw={draw} eventMode="none" />;
});
