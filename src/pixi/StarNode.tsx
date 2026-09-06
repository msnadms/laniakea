import { memo, useLayoutEffect, useCallback, useRef } from 'react';
import { Graphics, Sprite, Texture } from 'pixi.js';
import type { StarSystem } from '../game/types';
import { createStarTexture } from './textures';
import { galaxyDepthAlpha, type ProjectedPoint } from './projection';

export const StarNode = memo(function StarNode({
  system,
  projected,
}: {
  system: StarSystem;
  projected: ProjectedPoint;
}) {
  const isVisited = system.visited;
  const isCurrent = system.current;

  const glowSpriteRef = useRef<Sprite>(null);

  useLayoutEffect(() => {
    const sprite = glowSpriteRef.current;
    const texture = createStarTexture(system.color, system.size);
    if (!sprite) {
      texture.destroy(true);
      return;
    }
    sprite.texture = texture;
    return () => {
      if (sprite.texture === texture) sprite.texture = Texture.EMPTY;
      texture.destroy(true);
    };
  }, [system.color, system.size]);

  const drawRing = useCallback(
    (gfx: Graphics) => {
      gfx.clear();
      if (isVisited && !isCurrent) {
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

  return (
    <pixiContainer
      x={projected.x}
      y={projected.y}
      zIndex={projected.depth}
      alpha={galaxyDepthAlpha(projected.depth)}
      eventMode="none"
    >
      <pixiSprite ref={glowSpriteRef} texture={Texture.EMPTY} anchor={0.5} scale={0.25 * projected.scale} />
      <pixiGraphics draw={drawRing} eventMode="none" />
    </pixiContainer>
  );
});
