import { memo, useLayoutEffect, useCallback, useRef } from 'react';
import { Circle, Graphics, Sprite, Texture } from 'pixi.js';
import type { StarSystem } from '../game/types';
import { createStarTexture } from './textures';
import { galaxyDepthAlpha, type ProjectedPoint } from './projection';

export const StarNode = memo(function StarNode({
  system,
  projected,
  onSelect,
}: {
  system: StarSystem;
  projected: ProjectedPoint;
  onSelect: (id: number | null) => void;
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

  const hitArea = useRef(new Circle(0, 0, 0));
  hitArea.current.radius = system.size + 10;

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

  const handleClick = useCallback(() => {
    onSelect(system.id);
  }, [system.id, onSelect]);

  return (
    <pixiContainer
      x={projected.x}
      y={projected.y}
      zIndex={projected.depth}
      alpha={galaxyDepthAlpha(projected.depth)}
      eventMode="static"
      cursor="pointer"
      hitArea={hitArea.current}
      onClick={handleClick}
    >
      <pixiSprite ref={glowSpriteRef} texture={Texture.EMPTY} anchor={0.5} scale={0.25 * projected.scale} />
      <pixiGraphics draw={drawRing} eventMode="none" />
    </pixiContainer>
  );
});
