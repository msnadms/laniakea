import { Container, Graphics } from 'pixi.js';
import { UNIVERSE_RADIUS } from '../game/constants';
import type { FlyCamera } from '../game/types';
import { flyForward } from './flyProjection';

const RADIUS_PX = 52;
const RIGHT_PX = 32;
const TOP_PX = 64;
const ELEVATION = 26 * Math.PI / 180;
const SIN_ELEVATION = Math.sin(ELEVATION);
const COS_ELEVATION = Math.cos(ELEVATION);
const RING_SEGMENTS = 48;
const HEADING_PX = 14;
const FRAME_COLOR = 0x00bee6;
const MARKER_COLOR = 0x00e8ff;

export interface UniverseMinimap {
  container: Container;
  update: (camera: FlyCamera, screenWidth: number, elapsedSecs: number) => void;
}

function mapX(x: number): number {
  return x / UNIVERSE_RADIUS * RADIUS_PX;
}

function mapY(y: number, z: number): number {
  return -(z * SIN_ELEVATION + y * COS_ELEVATION) / UNIVERSE_RADIUS * RADIUS_PX;
}

function traceEquator(gfx: Graphics, radius: number, from: number, to: number) {
  for (let s = 0; s <= RING_SEGMENTS; s++) {
    const angle = from + (to - from) * s / RING_SEGMENTS;
    const x = Math.cos(angle) * radius;
    const y = -Math.sin(angle) * radius * SIN_ELEVATION;
    if (s === 0) gfx.moveTo(x, y);
    else gfx.lineTo(x, y);
  }
}

function drawFrame(gfx: Graphics) {
  gfx.circle(0, 0, RADIUS_PX + 6);
  gfx.fill({ color: 0x020812, alpha: 0.55 });
  gfx.circle(0, 0, RADIUS_PX + 6);
  gfx.stroke({ color: FRAME_COLOR, width: 1, alpha: 0.35 });

  gfx.circle(0, 0, RADIUS_PX);
  gfx.stroke({ color: FRAME_COLOR, width: 1, alpha: 0.22 });
  gfx.ellipse(0, 0, RADIUS_PX, RADIUS_PX * COS_ELEVATION);
  gfx.stroke({ color: FRAME_COLOR, width: 0.75, alpha: 0.1 });

  traceEquator(gfx, RADIUS_PX, 0, Math.PI);
  gfx.stroke({ color: FRAME_COLOR, width: 1, alpha: 0.3 });
  traceEquator(gfx, RADIUS_PX, Math.PI, Math.PI * 2);
  gfx.stroke({ color: FRAME_COLOR, width: 1.25, alpha: 0.75 });

  gfx.ellipse(0, 0, RADIUS_PX / 2, RADIUS_PX / 2 * SIN_ELEVATION);
  gfx.stroke({ color: FRAME_COLOR, width: 0.75, alpha: 0.25 });

  gfx.moveTo(-RADIUS_PX, 0).lineTo(RADIUS_PX, 0);
  gfx.moveTo(0, -RADIUS_PX * SIN_ELEVATION).lineTo(0, RADIUS_PX * SIN_ELEVATION);
  gfx.stroke({ color: FRAME_COLOR, width: 0.75, alpha: 0.18 });

  gfx.circle(0, 0, 1.5);
  gfx.fill({ color: FRAME_COLOR, alpha: 0.6 });
}

export function createUniverseMinimap(): UniverseMinimap {
  const container = new Container();
  container.eventMode = 'none';
  const frame = new Graphics();
  const marker = new Graphics();
  container.addChild(frame);
  container.addChild(marker);
  drawFrame(frame);

  const forward = { x: 0, y: 0, z: 0 };

  const update = (camera: FlyCamera, screenWidth: number, elapsedSecs: number) => {
    container.position.set(screenWidth - RIGHT_PX - RADIUS_PX, TOP_PX + RADIUS_PX);

    const footX = mapX(camera.x);
    const footY = mapY(0, camera.z);
    const dotY = mapY(camera.y, camera.z);
    flyForward(camera, forward);
    const headingX = forward.x * HEADING_PX;
    const headingY = -(forward.z * SIN_ELEVATION + forward.y * COS_ELEVATION) * HEADING_PX;
    const pulse = 0.5 + 0.5 * Math.sin(elapsedSecs * Math.PI * 2 * 0.7);

    marker.clear();
    marker.ellipse(footX, footY, 3, 3 * SIN_ELEVATION);
    marker.stroke({ color: MARKER_COLOR, width: 1, alpha: 0.5 });
    marker.moveTo(footX, footY).lineTo(footX, dotY);
    marker.stroke({ color: MARKER_COLOR, width: 1, alpha: 0.55 });
    marker.moveTo(footX, dotY).lineTo(footX + headingX, dotY + headingY);
    marker.stroke({ color: MARKER_COLOR, width: 1.25, alpha: 0.8 });
    marker.circle(footX, dotY, 4 + pulse * 3);
    marker.stroke({ color: MARKER_COLOR, width: 1, alpha: 0.15 + pulse * 0.4 });
    marker.circle(footX, dotY, 2.5);
    marker.fill({ color: MARKER_COLOR, alpha: 1 });
  };

  return { container, update };
}
