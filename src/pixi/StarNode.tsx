import { memo, useLayoutEffect, useCallback, useRef } from 'react';
import { Texture } from 'pixi.js';
import type { Container, Graphics, Sprite } from 'pixi.js';
import type { StarSystem } from '../game/types';
import { createShroudedStarTexture, createStarTexture } from './textures';
import { galaxyDepthAlpha, galaxyDepthScale, type ProjectedPoint } from './projection';
import { applyStarProjection, STAR_SPRITE_SCALE, type StarDisplay, type StarViews } from './starView';

export const StarNode = memo(function StarNode({
  system,
  projected,
  views,
  display,
}: {
  system: StarSystem;
  projected: ProjectedPoint;
  views: StarViews;
  display?: StarDisplay;
}) {
  const isVisited = system.visited;
  const isCurrent = system.current;
  const color = display?.color ?? system.color;
  const size = display?.size ?? system.size;
  const shrouded = display?.shrouded ?? false;

  const containerRef = useRef<Container>(null);
  const glowSpriteRef = useRef<Sprite>(null);

  useLayoutEffect(() => {
    const sprite = glowSpriteRef.current;
    const texture = shrouded ? createShroudedStarTexture(size) : createStarTexture(color, size);
    if (!sprite) {
      texture.destroy(true);
      return;
    }
    sprite.texture = texture;
    return () => {
      if (sprite.texture === texture) sprite.texture = Texture.EMPTY;
      texture.destroy(true);
    };
  }, [color, size, shrouded]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const sprite = glowSpriteRef.current;
    if (!container || !sprite) return;
    const view = { container, sprite };
    views.set(system.id, view);
    applyStarProjection(view, projected);
    return () => {
      if (views.get(system.id) === view) views.delete(system.id);
    };
  }, [views, system.id, projected]);

  const drawRing = useCallback(
    (gfx: Graphics) => {
      gfx.clear();
      if (isVisited && !isCurrent) {
        gfx.circle(0, 0, size + 7);
        gfx.stroke({ color: 0xffffff, width: 1.5, alpha: 0.75 });
        gfx.circle(0, 0, size + 11);
        gfx.stroke({ color: 0xffffff, width: 0.5, alpha: 0.25 });
      }
      if (isCurrent) {
        gfx.clear();
        gfx.circle(0, 0, size + 7);
        gfx.stroke({ color: 0x00c8e8, width: 1.5, alpha: 0.75 });
        gfx.circle(0, 0, size + 11);
        gfx.stroke({ color: 0x00c8e8, width: 0.5, alpha: 0.25 });
      }
    },
    [size, isVisited, isCurrent],
  );

  return (
    <pixiContainer
      ref={containerRef}
      x={projected.x}
      y={projected.y}
      zIndex={projected.depth}
      alpha={galaxyDepthAlpha(projected.depth)}
      eventMode="none"
    >
      <pixiSprite
        ref={glowSpriteRef}
        texture={Texture.EMPTY}
        anchor={0.5}
        scale={STAR_SPRITE_SCALE * galaxyDepthScale(projected.depth)}
      />
      <pixiGraphics draw={drawRing} eventMode="none" />
    </pixiContainer>
  );
});
