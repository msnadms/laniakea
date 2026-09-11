import { Graphics, type Container } from 'pixi.js';
import { anomalyVisualRng } from '../../game/anomalies';
import type { Point3D, ProjectionBasis } from '../projection';
import {
  applyIntegrity,
  buildSphereLattice,
  createPanelSet,
  drawShellHalf,
  orientShell,
  orthonormalFrame,
  type PanelSet,
  type PanelShader,
} from './shellLattice';
import { makeSelectable, mixColor, randomUnitVector, scaleColor, SHELL_Z, TAU } from './shared';
import type { AnomalyVisual, AnomalyVisualContext } from './types';

const TOTAL_PANELS = 600;
const MIN_SHELL_PANELS = 48;
const EMBER = 0xff8a3c;
const DEEP_RED = 0x3c0605;
const THOUGHT_COLOR = 0xffb877;
const THOUGHT_COUNT = 3;
const THOUGHT_WIDTH = 0.14;
const THOUGHT_TRAIL = 1.7;

interface Shell {
  set: PanelSet;
  color: number;
  spin: number;
  spinSpeed: number;
}

interface Thought {
  axis: Point3D;
  tangent: Point3D;
  bitangent: Point3D;
  speed: number;
  phase: number;
  cadence: number;
  cadencePhase: number;
}

function dot(a: Point3D, b: Point3D): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function createMatrioshkaBrain({ anomaly, sunRadius, innermostOrbit, onSelect }: AnomalyVisualContext): AnomalyVisual {
  const rng = anomalyVisualRng(anomaly);
  const innerRadius = sunRadius * 1.3;
  const outerRadius = Math.max(innermostOrbit * 0.8, innerRadius * 1.35);
  const shellCount = 3 + Math.floor(rng() * 3);
  const radii = Array.from({ length: shellCount }, (_, i) => innerRadius * Math.pow(outerRadius / innerRadius, i / (shellCount - 1)));
  const area = radii.reduce((sum, radius) => sum + radius * radius, 0);

  const shells: Shell[] = radii.map((radius, index) => {
    const count = Math.max(MIN_SHELL_PANELS, Math.round(TOTAL_PANELS * radius * radius / area));
    const integrity = Math.min(0.99, Math.max(0.8, anomaly.integrity + (rng() - 0.5) * 0.06));
    return {
      set: createPanelSet(applyIntegrity(buildSphereLattice(count, rng), integrity, rng), radius),
      color: mixColor(EMBER, DEEP_RED, index / (shellCount - 1)),
      spin: rng() * TAU,
      spinSpeed: (index % 2 === 0 ? 1 : -1) * (0.008 + rng() * 0.018),
    };
  });

  const thoughts: Thought[] = Array.from({ length: THOUGHT_COUNT }, () => {
    const axis = randomUnitVector(rng);
    return {
      axis,
      ...orthonormalFrame(axis),
      speed: 0.22 + rng() * 0.22,
      phase: rng() * TAU,
      cadence: 0.1 + rng() * 0.14,
      cadencePhase: rng() * TAU,
    };
  });

  let now = 0;
  const thoughtGlow = (normal: Point3D) => {
    let glow = 0;
    for (const thought of thoughts) {
      const intensity = Math.sin(now * thought.cadence + thought.cadencePhase);
      if (intensity <= 0) continue;
      const across = dot(normal, thought.axis);
      if (Math.abs(across) > THOUGHT_WIDTH * 3) continue;
      const along = Math.atan2(dot(normal, thought.bitangent), dot(normal, thought.tangent));
      const lag = (((now * thought.speed + thought.phase - along) % TAU) + TAU) % TAU;
      if (lag > THOUGHT_TRAIL) continue;
      glow += intensity * Math.exp(-((across / THOUGHT_WIDTH) ** 2)) * (1 - lag / THOUGHT_TRAIL);
    }
    return Math.min(1, glow);
  };

  const outermost = shells[shells.length - 1];
  const shaders: PanelShader[] = shells.map((shell) => (panel, facing, out) => {
    if (facing < 0) {
      out.color = scaleColor(shell.color, 0.5 + 0.35 * panel.shade);
      out.alpha = 0.95;
      return;
    }
    const rim = Math.pow(1 - facing, 3);
    const base = mixColor(scaleColor(shell.color, 0.26 + 0.18 * panel.shade), shell.color, rim * 0.45);
    out.color = shell === outermost ? mixColor(base, THOUGHT_COLOR, thoughtGlow(panel.normal) * 0.85) : base;
    out.alpha = 0.97;
  });

  const back = new Graphics();
  back.zIndex = -SHELL_Z;
  const front = new Graphics();
  front.zIndex = SHELL_Z;
  makeSelectable(back, outerRadius, onSelect);
  makeSelectable(front, outerRadius, onSelect);
  const nodes: Container[] = [back, front];

  return {
    nodes,
    extent: outerRadius,
    starAlpha: 0.08,
    coronaAlpha: 0,
    nebulaColor: 0x4a1208,
    update(dt: number, elapsed: number, basis: ProjectionBasis) {
      now = elapsed;
      for (const shell of shells) {
        shell.spin += shell.spinSpeed * dt;
        orientShell(shell.set, basis, shell.spin);
      }
      back.clear();
      front.clear();
      for (let i = shells.length - 1; i >= 0; i--) drawShellHalf(back, shells[i].set, shaders[i], 'back');
      for (let i = 0; i < shells.length; i++) drawShellHalf(front, shells[i].set, shaders[i], 'front');
    },
    destroy() {
      for (const node of nodes) node.destroy();
    },
  };
}
