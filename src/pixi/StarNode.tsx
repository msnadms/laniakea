import { memo, useMemo, useEffect, useCallback } from 'react';
import { Graphics } from 'pixi.js';
import { useGameStore } from '../store/gameStore';
import type { StarSystem } from '../game/types';
import { createStarTexture } from './textures';

export const StarNode = memo(function StarNode({
  system,
  onSelect,
}: {
  system: StarSystem;
  onSelect: (id: number | null) => void;
}) {
  const isSelected = useGameStore((s) => s.system?.id === system.id);

  const glowTexture = useMemo(
    () => createStarTexture(system.color, system.size),
    [system.color, system.size],
  );

  useEffect(() => () => { glowTexture.destroy(true); }, [glowTexture]);

  const drawRing = useCallback(
    (gfx: Graphics) => {
      gfx.clear();
      if (isSelected) {
        gfx.circle(0, 0, system.size + 7);
        gfx.stroke({ color: 0xffffff, width: 1.5, alpha: 0.75 });
        gfx.circle(0, 0, system.size + 11);
        gfx.stroke({ color: 0xffffff, width: 0.5, alpha: 0.25 });
      }
    },
    [system.size, isSelected],
  );

  return (
    <pixiContainer
      x={system.x}
      y={system.y}
      eventMode="static"
      cursor="pointer"
      onClick={() => onSelect(system.id)}
    >
      <pixiSprite texture={glowTexture} anchor={0.5} scale={0.25} />
      <pixiGraphics draw={drawRing} eventMode="none" />
    </pixiContainer>
  );
});
