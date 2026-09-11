import { Graphics, type Container } from 'pixi.js';
import { anomalyVisualRng, type Anomaly, type GalaxyAnomalies } from '../game/anomalies';
import {
  ANOMALY_BEAM_SIGN_LENGTH,
  ANOMALY_BEAM_SIGN_MIN_SCALE,
  ANOMALY_BEAM_SIGN_SEGMENTS,
  ANOMALY_SIGN_FADE_SPAN,
  ANOMALY_SIGN_MIN_SCALE,
} from '../game/constants';
import type { StarSystem } from '../game/types';
import { mixColor, sputter, TAU } from './anomalies/shared';
import { galaxyDepthAlpha, galaxyDepthScale, projectPlanePointWithBasis, type ProjectedPoint, type ProjectionBasis } from './projection';

export interface AnomalySigns {
  project(basis: ProjectionBasis): void;
  tick(elapsed: number, cameraScale: number): void;
  destroy(): void;
}

interface Sign {
  nodes: Graphics[];
  minScale: number;
  project(basis: ProjectionBasis): void;
  tick(elapsed: number, visibility: number): void;
}

const SIGN_Z = 0.01;
const XRAY_COLOR = 0xd4c4ff;
const XRAY_OFFSET = 4.5;
const BEAM_COLOR = 0xffe4bc;
const WAKE_STEPS = 6;
const WAKE_LENGTH = 34;

function emptyPoint(): ProjectedPoint {
  return { x: 0, y: 0, depth: 0, scale: 1 };
}

function signVisibility(cameraScale: number, minScale: number): number {
  return Math.min(1, Math.max(0, (cameraScale - minScale) / (minScale * ANOMALY_SIGN_FADE_SPAN)));
}

function createXRaySign(host: StarSystem, anomaly: Anomaly): Sign {
  const rng = anomalyVisualRng(anomaly);
  const offsetAngle = rng() * TAU;
  const offsetX = Math.cos(offsetAngle) * XRAY_OFFSET;
  const offsetY = Math.sin(offsetAngle) * XRAY_OFFSET;
  const period = 3 + rng() * 4;
  const phase = rng() * period;
  const gfx = new Graphics()
    .poly([-3.4, 0, 0, -0.5, 3.4, 0, 0, 0.5]).fill({ color: XRAY_COLOR, alpha: 1 })
    .poly([0, -3.4, 0.5, 0, 0, 3.4, -0.5, 0]).fill({ color: XRAY_COLOR, alpha: 1 })
    .circle(0, 0, 1).fill({ color: 0xffffff, alpha: 1 });
  gfx.blendMode = 'add';
  const projected = emptyPoint();
  let depthAlpha = 1;

  return {
    nodes: [gfx],
    minScale: ANOMALY_SIGN_MIN_SCALE,
    project(basis) {
      projectPlanePointWithBasis(host.x + offsetX, host.y + offsetY, host.z, basis, projected);
      gfx.position.set(projected.x, projected.y);
      gfx.scale.set(galaxyDepthScale(projected.depth));
      gfx.zIndex = projected.depth + SIGN_Z;
      depthAlpha = galaxyDepthAlpha(projected.depth);
    },
    tick(elapsed, visibility) {
      const t = (elapsed + phase) % period;
      const flash = Math.exp(-t * 26) + (t > 0.2 ? 0.55 * Math.exp(-(t - 0.2) * 32) : 0);
      gfx.alpha = flash * visibility * depthAlpha;
      gfx.visible = gfx.alpha > 0.002;
    },
  };
}

function createBeamSign(host: StarSystem, anomaly: Anomaly): Sign {
  const rng = anomalyVisualRng(anomaly);
  const timeOffset = rng() * 100;
  const directionX = anomaly.direction?.x ?? 1;
  const directionY = anomaly.direction?.y ?? 0;
  const segments = Array.from({ length: ANOMALY_BEAM_SIGN_SEGMENTS }, () => {
    const gfx = new Graphics()
      .moveTo(0, 0).lineTo(1, 0).stroke({ color: BEAM_COLOR, width: 3.2, alpha: 0.22 })
      .moveTo(0, 0).lineTo(1, 0).stroke({ color: BEAM_COLOR, width: 0.9, alpha: 1 });
    gfx.blendMode = 'add';
    return gfx;
  });
  const points = Array.from({ length: ANOMALY_BEAM_SIGN_SEGMENTS + 1 }, emptyPoint);
  const depthAlpha = new Float32Array(ANOMALY_BEAM_SIGN_SEGMENTS);

  return {
    nodes: segments,
    minScale: ANOMALY_BEAM_SIGN_MIN_SCALE,
    project(basis) {
      for (let i = 0; i <= ANOMALY_BEAM_SIGN_SEGMENTS; i++) {
        const reach = ANOMALY_BEAM_SIGN_LENGTH * i / ANOMALY_BEAM_SIGN_SEGMENTS;
        projectPlanePointWithBasis(host.x + directionX * reach, host.y + directionY * reach, host.z, basis, points[i]);
      }
      segments.forEach((gfx, i) => {
        const from = points[i];
        const to = points[i + 1];
        gfx.position.set(from.x, from.y);
        gfx.rotation = Math.atan2(to.y - from.y, to.x - from.x);
        gfx.scale.set(Math.hypot(to.x - from.x, to.y - from.y), 1);
        gfx.zIndex = (from.depth + to.depth) / 2 + SIGN_Z;
        depthAlpha[i] = galaxyDepthAlpha(gfx.zIndex);
      });
    },
    tick(elapsed, visibility) {
      const time = elapsed + timeOffset;
      const burst = 0.1 + 0.9 * sputter(time);
      segments.forEach((gfx, i) => {
        const reach = (i + 0.5) / ANOMALY_BEAM_SIGN_SEGMENTS;
        const packet = 0.4 + 0.6 * Math.pow(Math.max(0, Math.sin((reach * 5 - time * 0.9) * Math.PI)), 2);
        gfx.alpha = 0.85 * visibility * depthAlpha[i] * burst * packet * (1 - 0.7 * reach);
        gfx.visible = gfx.alpha > 0.002;
      });
    },
  };
}

function createWakeSign(host: StarSystem, anomaly: Anomaly): Sign {
  const rng = anomalyVisualRng(anomaly);
  const phase = rng() * TAU;
  const headingX = anomaly.direction?.x ?? 1;
  const headingY = anomaly.direction?.y ?? 0;
  const planeLength = Math.hypot(headingX, headingY) || 1;
  const backX = -headingX / planeLength;
  const backY = -headingY / planeLength;
  const color = mixColor(host.color, 0xffffff, 0.45);
  const gfx = new Graphics();
  gfx.blendMode = 'add';
  const points = Array.from({ length: WAKE_STEPS + 1 }, emptyPoint);
  let depthAlpha = 1;

  return {
    nodes: [gfx],
    minScale: ANOMALY_SIGN_MIN_SCALE,
    project(basis) {
      for (let i = 0; i <= WAKE_STEPS; i++) {
        const reach = WAKE_LENGTH * i / WAKE_STEPS;
        projectPlanePointWithBasis(host.x + backX * reach, host.y + backY * reach, host.z, basis, points[i]);
      }
      gfx.clear();
      for (let i = 0; i < WAKE_STEPS; i++) {
        const fade = 1 - i / WAKE_STEPS;
        gfx
          .moveTo(points[i].x, points[i].y)
          .lineTo(points[i + 1].x, points[i + 1].y)
          .stroke({ color, width: 1.8 * fade + 0.3, alpha: 0.55 * fade });
      }
      gfx.zIndex = points[0].depth - SIGN_Z;
      depthAlpha = galaxyDepthAlpha(points[0].depth);
    },
    tick(elapsed, visibility) {
      gfx.alpha = visibility * depthAlpha * (0.75 + 0.25 * Math.sin(elapsed * 1.3 + phase));
      gfx.visible = gfx.alpha > 0.002;
    },
  };
}

export function createAnomalySigns(root: Container, systems: readonly StarSystem[], anomalies: GalaxyAnomalies): AnomalySigns {
  const signs: Sign[] = [];
  for (const anomaly of anomalies.byHost.values()) {
    const host = systems[anomaly.hostId];
    if (anomaly.kind === 'blackHole') signs.push(createXRaySign(host, anomaly));
    else if (anomaly.kind === 'nicollDysonBeam') signs.push(createBeamSign(host, anomaly));
    else if (anomaly.kind === 'shkadovThruster') signs.push(createWakeSign(host, anomaly));
  }
  const nodes = signs.flatMap((sign) => sign.nodes);
  for (const node of nodes) {
    node.eventMode = 'none';
    root.addChild(node);
  }

  return {
    project(basis) {
      for (const sign of signs) sign.project(basis);
    },
    tick(elapsed, cameraScale) {
      for (const sign of signs) sign.tick(elapsed, signVisibility(cameraScale, sign.minScale));
    },
    destroy() {
      for (const node of nodes) {
        root.removeChild(node);
        node.destroy();
      }
    },
  };
}
