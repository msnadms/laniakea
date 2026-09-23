import { Graphics } from 'pixi.js';
import type { ScanGraph } from '../game/scanGraph';
import { heatColor } from '../game/scanGraph';
import {
  SCAN_HEAT_STEPS,
  SCAN_WEB_GRADIENT_MAX_NODES,
  SCAN_WEB_BACK_ALPHA,
  SCAN_WEB_FRONT_ALPHA,
  SCAN_WEB_MIN_ALPHA,
  SCAN_WEB_NODE_RADIUS_PX,
  SCAN_WEB_SEGMENTS,
} from '../game/constants';
import type { ProjectedPoint } from './projection';

export type WebProject = (x: number, y: number, z: number, out: ProjectedPoint) => boolean;

export interface WebStyle {
  width: number;
  alpha: number;
  frontIsLowerDepth?: boolean;
  centreDepth?: number;
}

function emptyPoint(): ProjectedPoint {
  return { x: 0, y: 0, depth: 0, scale: 1 };
}

const scratch = emptyPoint();
const screenX: number[] = [];
const screenY: number[] = [];
const depth: number[] = [];
const visible: boolean[] = [];
const buckets: number[][] = [];

for (let i = 0; i < SCAN_HEAT_STEPS * 2; i++) buckets.push([]);

export function drawScanWeb(
  back: Graphics,
  front: Graphics,
  graph: ScanGraph,
  heats: readonly number[],
  project: WebProject,
  style: WebStyle,
): void {
  const count = graph.nodes.length / 3;
  for (let i = 0; i < count; i++) {
    visible[i] = project(graph.nodes[i * 3], graph.nodes[i * 3 + 1], graph.nodes[i * 3 + 2], scratch);
    screenX[i] = scratch.x;
    screenY[i] = scratch.y;
    depth[i] = scratch.depth;
  }
  for (const list of buckets) list.length = 0;

  const segments = count > SCAN_WEB_GRADIENT_MAX_NODES ? 1 : SCAN_WEB_SEGMENTS;
  const depthSign = style.frontIsLowerDepth === false ? -1 : 1;
  const centreDepth = style.centreDepth ?? depth[0];

  for (let e = 0; e < graph.edges.length; e += 2) {
    const a = graph.edges[e];
    const b = graph.edges[e + 1];
    if (!visible[a] || !visible[b]) continue;
    const side = depthSign * (depth[a] + depth[b]) / 2 < depthSign * centreDepth ? 1 : 0;
    const ax = screenX[a];
    const ay = screenY[a];
    const bx = screenX[b];
    const by = screenY[b];
    for (let s = 0; s < segments; s++) {
      const t0 = s / segments;
      const t1 = (s + 1) / segments;
      const heat = heats[a] + (heats[b] - heats[a]) * ((t0 + t1) / 2);
      const level = Math.min(SCAN_HEAT_STEPS - 1, Math.max(0, Math.round(heat * (SCAN_HEAT_STEPS - 1))));
      buckets[level * 2 + side].push(
        ax + (bx - ax) * t0, ay + (by - ay) * t0,
        ax + (bx - ax) * t1, ay + (by - ay) * t1,
      );
    }
  }

  // A sweep small enough to hold one supercluster has a contact but no route to draw it along.
  if (graph.edges.length === 0) {
    for (let i = 0; i < count; i++) {
      if (!visible[i]) continue;
      const heat = heats[i];
      const target = depthSign * depth[i] < depthSign * centreDepth ? front : back;
      target.circle(screenX[i], screenY[i], style.width * SCAN_WEB_NODE_RADIUS_PX);
      target.stroke({
        color: heatColor(heat),
        width: style.width,
        alpha: style.alpha * (SCAN_WEB_MIN_ALPHA + (1 - SCAN_WEB_MIN_ALPHA) * Math.sqrt(heat)),
      });
    }
  }

  for (let level = 0; level < SCAN_HEAT_STEPS; level++) {
    const heat = level / (SCAN_HEAT_STEPS - 1);
    const color = heatColor(heat);
    const weight = SCAN_WEB_MIN_ALPHA + (1 - SCAN_WEB_MIN_ALPHA) * Math.sqrt(heat);
    for (let side = 0; side < 2; side++) {
      const points = buckets[level * 2 + side];
      if (points.length === 0) continue;
      const target = side === 1 ? front : back;
      for (let i = 0; i < points.length; i += 4) {
        target.moveTo(points[i], points[i + 1]).lineTo(points[i + 2], points[i + 3]);
      }
      const sideAlpha = side === 1 ? SCAN_WEB_FRONT_ALPHA : SCAN_WEB_BACK_ALPHA;
      target.stroke({ color, width: style.width, alpha: style.alpha * sideAlpha * weight });
    }
  }
}
