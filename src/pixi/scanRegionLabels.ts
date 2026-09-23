import { Container } from 'pixi.js';
import { projectPlanePointWithBasis, type ProjectedPoint, type ProjectionBasis } from './projection';
import { createPointerLabel } from './labels';

const FONT_SIZE = 15;
const LINE_LENGTH = 40;
const DOT_RADIUS = 3;
const LINE_WIDTH = 2;
const Z_INDEX = 99000;

function emptyPoint(): ProjectedPoint {
  return { x: 0, y: 0, depth: 0, scale: 1 };
}

export interface ScanRegionLabel {
  x: number;
  y: number;
  z: number;
  name: string;
}

export function createScanRegionLabels(root: Container, labels: readonly ScanRegionLabel[]) {
  const container = new Container();
  container.zIndex = Z_INDEX;
  container.eventMode = 'none';

  const groups = labels.map((label, i) => {
    const group = createPointerLabel(label.name, FONT_SIZE, {
      lineLength: LINE_LENGTH,
      dotRadius: DOT_RADIUS,
      lineWidth: LINE_WIDTH,
      direction: i % 2 === 0 ? 1 : -1,
    });
    container.addChild(group);
    return { group, point: emptyPoint() };
  });
  root.addChild(container);

  let scale = NaN;

  return {
    project(basis: ProjectionBasis) {
      labels.forEach((label, i) => {
        const { group, point } = groups[i];
        projectPlanePointWithBasis(label.x, label.y, label.z, basis, point);
        group.position.set(point.x, point.y);
      });
    },
    // Text baked at one size blurs as the world container scales up, so the labels are
    // drawn at screen size and counter-scaled instead.
    tick(cameraScale: number) {
      if (cameraScale === scale) return;
      scale = cameraScale;
      for (const { group } of groups) group.scale.set(1 / cameraScale);
    },
    destroy() {
      root.removeChild(container);
      container.destroy({ children: true });
    },
  };
}
