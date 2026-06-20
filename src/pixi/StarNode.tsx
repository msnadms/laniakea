import { memo, useMemo, useEffect, useCallback } from 'react';
import { Graphics } from 'pixi.js';
import type { StarSystem } from '../game/types';
import { createStarTexture } from './textures';

export const StarNode = memo(function StarNode({
  system,
  onSelect,
}: {
  system: StarSystem;
  onSelect: (id: number | null) => void;
}) {
  const isVisited = system.visited;
  const isCurrent = system.current;

  const glowTexture = useMemo(
    () => createStarTexture(system.color, system.size),
    [system.color, system.size],
  );

  useEffect(() => () => { glowTexture.destroy(true); }, [glowTexture]);

  const drawRing = useCallback(
    (gfx: Graphics) => {
      gfx.clear();
      if (isVisited && !isCurrent) {
        gfx.clear();
        gfx.circle(0, 0, system.size + 7);
        gfx.stroke({ color: 0xffffff, width: 1.5, alpha: 0.75 });
        gfx.circle(0, 0, system.size + 11);
        gfx.stroke({ color: 0xffffff, width: 0.5, alpha: 0.25 });
      }
      if (isCurrent) {
        gfx.clear();
        gfx.circle(0, 0, system.size + 7);
        gfx.stroke({ color: 0x00c8e8, width: 1.5, alpha: 0.75 });
        gfx.circle(0, 0, system.size + 11);
        gfx.stroke({ color: 0x00c8e8, width: 0.5, alpha: 0.25 });
      }
    },
    [system.size, isVisited, isCurrent],
  );

  const handleClick = useCallback(() => {
    onSelect(system.id);
  }, [system.id, onSelect]);

  return (
    <pixiContainer
      x={system.x}
      y={system.y}
      eventMode="static"
      cursor="pointer"
      onClick={handleClick}
    >
      <pixiSprite texture={glowTexture} anchor={0.5} scale={0.25} />
      <pixiGraphics draw={drawRing} eventMode="none" />
    </pixiContainer>
  );
});
