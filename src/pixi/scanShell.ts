import { Graphics } from 'pixi.js';
import type { ProjectedPoint } from './projection';

const SEGMENTS = 40;
const LATITUDES = [-0.8, -0.45, 0, 0.45, 0.8];
const MERIDIANS = 4;

export type ShellProject = (ux: number, uy: number, uz: number, out: ProjectedPoint) => boolean;

export interface ShellStyle {
  color: number;
  width: number;
  backAlpha: number;
  frontAlpha: number;
  frontIsLowerDepth?: boolean;
  centreDepth?: number;
}

function emptyPoint(): ProjectedPoint {
  return { x: 0, y: 0, depth: 0, scale: 1 };
}

const centre = emptyPoint();
const head = emptyPoint();
const tail = emptyPoint();
const unit: number[] = [0, 0, 0];

export function drawScanShell(
  back: Graphics,
  front: Graphics,
  project: ShellProject,
  style: ShellStyle,
): void {
  let centreDepth = style.centreDepth;
  if (centreDepth === undefined) {
    if (!project(0, 0, 0, centre)) return;
    centreDepth = centre.depth;
  }
  const depthSign = style.frontIsLowerDepth === false ? -1 : 1;

  const ring = (point: (t: number, out: number[]) => void) => {
    let hasTail = false;
    for (let i = 0; i <= SEGMENTS; i++) {
      point(i / SEGMENTS, unit);
      const ok = project(unit[0], unit[1], unit[2], head);
      if (ok && hasTail) {
        const target = depthSign * (head.depth + tail.depth) / 2 < depthSign * centreDepth ? front : back;
        target.moveTo(tail.x, tail.y).lineTo(head.x, head.y);
      }
      hasTail = ok;
      tail.x = head.x;
      tail.y = head.y;
      tail.depth = head.depth;
    }
  };

  for (const height of LATITUDES) {
    const radius = Math.sqrt(1 - height * height);
    ring((t, out) => {
      const angle = t * Math.PI * 2;
      out[0] = Math.cos(angle) * radius;
      out[1] = height;
      out[2] = Math.sin(angle) * radius;
    });
  }
  for (let m = 0; m < MERIDIANS; m++) {
    const turn = (m / MERIDIANS) * Math.PI;
    const cosTurn = Math.cos(turn);
    const sinTurn = Math.sin(turn);
    ring((t, out) => {
      const angle = t * Math.PI * 2;
      const across = Math.sin(angle);
      out[0] = across * cosTurn;
      out[1] = Math.cos(angle);
      out[2] = across * sinTurn;
    });
  }

  back.stroke({ color: style.color, width: style.width, alpha: style.backAlpha });
  front.stroke({ color: style.color, width: style.width, alpha: style.frontAlpha });
}

export function createScanShell() {
  const back = new Graphics();
  const front = new Graphics();
  back.eventMode = 'none';
  front.eventMode = 'none';

  return {
    back,
    front,
    clear() {
      back.clear();
      front.clear();
    },
    draw(project: ShellProject, style: ShellStyle) {
      back.clear();
      front.clear();
      drawScanShell(back, front, project, style);
    },
    destroy() {
      back.destroy();
      front.destroy();
    },
  };
}
