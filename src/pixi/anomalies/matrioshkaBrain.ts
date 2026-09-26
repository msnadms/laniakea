import type { Container } from 'pixi.js';
import { anomalyVisualRng } from '../../game/anomalies';
import type { Point3D, ProjectionBasis } from '../projection';
import { buildShellLattice, orthonormalFrame, paintActivity, type ShellLattice } from './shellLattice';
import { createShellGeometry, createShellSurface, type ShellSurface } from './shellSurface';
import { makeSelectable, mixColor, randomUnitVector, scaleColor, SHELL_Z, TAU } from './shared';
import type { AnomalyVisual, AnomalyVisualContext } from './types';

const TOTAL_PANELS = 600;
const MIN_SHELL_PANELS = 48;
const CORE_GLOW = 0xffd9a0;
const EMBER = 0xff8a3c;
const DEEP_RED = 0x3c0605;
const THOUGHT_COLOR = 0xffb877;
const THOUGHT_COUNT = 3;
const THOUGHT_WIDTH = 0.14;
const THOUGHT_TRAIL = 1.7;

interface Shell {
  lattice: ShellLattice;
  surface: ShellSurface;
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

  const geometry = createShellGeometry();
  const colors = radii.map((_, index) => mixColor(EMBER, DEEP_RED, index / (shellCount - 1)));
  const shells: Shell[] = radii.map((radius, index) => {
    const count = Math.max(MIN_SHELL_PANELS, Math.round(TOTAL_PANELS * radius * radius / area));
    const integrity = Math.min(anomaly.living ? 1 : 0.99, Math.max(0.8, anomaly.integrity + (rng() - 0.5) * 0.06));
    const lattice = buildShellLattice(count, integrity, rng);
    const color = colors[index];
    const surface = createShellSurface(geometry, lattice, {
      hull: scaleColor(color, 0.16),
      heat: color,
      heatStrength: anomaly.living ? 0.35 : 0.12,
      inner: index === 0 ? CORE_GLOW : colors[index - 1],
      interior: index === 0 ? 2 : 2.6,
      activity: THOUGHT_COLOR,
      rim: 0.35,
      lights: false,
      subcells: 3,
      gap: 0.06,
    }, radius);
    const depthStep = 1 + index / shellCount;
    surface.back.zIndex = -SHELL_Z * depthStep;
    surface.front.zIndex = SHELL_Z * depthStep;
    return {
      lattice,
      surface,
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
  makeSelectable(outermost.surface.back, 1, onSelect);
  makeSelectable(outermost.surface.front, 1, onSelect);
  const nodes: Container[] = shells.flatMap((shell) => [shell.surface.back, shell.surface.front]);

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
        shell.surface.orient(basis, shell.spin, elapsed);
      }
      paintActivity(outermost.lattice, thoughtGlow);
    },
    destroy() {
      for (const shell of shells) {
        shell.surface.destroy();
        shell.lattice.source.destroy();
      }
      geometry.destroy();
    },
  };
}
