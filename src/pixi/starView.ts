import type { Container, Sprite } from 'pixi.js';
import { galaxyDepthAlpha, galaxyDepthScale, type ProjectedPoint } from './projection';

export const STAR_SPRITE_SCALE = 0.25;

export interface StarView {
  container: Container;
  sprite: Sprite;
}

export type StarViews = Map<number, StarView>;

export interface StarDisplay {
  color: number;
  size: number;
  shrouded: boolean;
}

// Stars are re-projected on every frame the disk turns, so their transforms are
// written straight to the display objects rather than through a React render.
export function applyStarProjection(view: StarView, projected: ProjectedPoint): void {
  view.container.position.set(projected.x, projected.y);
  view.container.zIndex = projected.depth;
  view.container.alpha = galaxyDepthAlpha(projected.depth);
  view.sprite.scale.set(STAR_SPRITE_SCALE * galaxyDepthScale(projected.depth));
}
