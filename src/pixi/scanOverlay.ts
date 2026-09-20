import { Container, Graphics, Text } from 'pixi.js';
import type { ScanFinding } from '../firebase/scans';
import { SCAN_STRENGTH_COLORS, SCAN_STRENGTH_LABELS } from '../game/scan';
import {
  SCAN_FINDING_BACK_ALPHA,
  SCAN_FINDING_COLOR,
  SCAN_FINDING_FRONT_ALPHA,
  SCAN_SHELL_LINE_PX,
} from '../game/constants';
import { superclusterFindings, universeFindings, useScanStore } from '../store/scanStore';
import { projectUniverseMark, universeFog, universeMarkDepth, type FlyBasis } from './flyProjection';
import { drawScanShell } from './scanShell';
import { projectPlanePointWithBasis, type ProjectedPoint, type ProjectionBasis } from './projection';

const RETICLE_ARM = 9;
const RETICLE_GAP = 4;
const MARK_MIN_ALPHA = 0.55;
const MARK_FADE_FOG = 0.05;

function emptyPoint(): ProjectedPoint {
  return { x: 0, y: 0, depth: 0, scale: 1 };
}

function findingLabel(finding: ScanFinding): string {
  const strength = SCAN_STRENGTH_LABELS[finding.strength];
  return finding.sources > 1 ? `${strength} · ${finding.sources} sources` : strength;
}

function drawReticle(gfx: Graphics, x: number, y: number, color: number, scale: number, alpha: number) {
  const arm = RETICLE_ARM / scale;
  const gap = RETICLE_GAP / scale;
  gfx.moveTo(x - arm, y).lineTo(x - gap, y);
  gfx.moveTo(x + gap, y).lineTo(x + arm, y);
  gfx.moveTo(x, y - arm).lineTo(x, y - gap);
  gfx.moveTo(x, y + gap).lineTo(x, y + arm);
  gfx.stroke({ color, width: 1.5 / scale, alpha });
}

function createLabelLayer(container: Container) {
  const labels = new Map<string, Text>();
  return {
    labels,
    sync(findings: readonly ScanFinding[]) {
      const live = new Set(findings.map((finding) => finding.id));
      for (const [id, text] of labels) {
        if (live.has(id)) continue;
        text.destroy();
        labels.delete(id);
      }
      for (const finding of findings) {
        if (labels.has(finding.id)) continue;
        const text = new Text({
          text: findingLabel(finding),
          style: { fontFamily: 'IBM Plex Sans', fontSize: 12, fill: SCAN_STRENGTH_COLORS[finding.strength] },
        });
        text.anchor.set(0.5, 1);
        container.addChild(text);
        labels.set(finding.id, text);
      }
    },
  };
}

function shellStyle(width: number, alpha: number, frontIsLowerDepth: boolean, centreDepth?: number) {
  return {
    color: SCAN_FINDING_COLOR,
    width,
    backAlpha: SCAN_FINDING_BACK_ALPHA * alpha,
    frontAlpha: SCAN_FINDING_FRONT_ALPHA * alpha,
    frontIsLowerDepth,
    centreDepth,
  };
}

// The back half and the tint sit under the dot field so a sphere reads as a volume the
// dots are inside of, so they are a node of their own for the view to place.
function createShellLayers(container: Container) {
  const back = new Graphics();
  const front = new Graphics();
  back.eventMode = 'none';
  front.eventMode = 'none';
  container.addChild(front);
  return { back, front };
}

export function createUniverseScanOverlay() {
  const container = new Container();
  container.eventMode = 'none';
  const shell = createShellLayers(container);
  const rings = new Graphics();
  container.addChild(rings);
  const layer = createLabelLayer(container);
  const projected = emptyPoint();

  return {
    node: container,
    backNode: shell.back,
    update(basis: FlyBasis, cameraScale: number, elapsedSecs: number) {
      const findings = universeFindings(useScanStore.getState().findings);
      layer.sync(findings);
      shell.back.clear();
      shell.front.clear();
      rings.clear();
      const pulse = 0.85 + 0.15 * Math.sin(elapsedSecs * Math.PI);
      for (const finding of findings) {
        const label = layer.labels.get(finding.id)!;
        label.visible = false;
        const distance = Math.hypot(finding.x - basis.x, finding.y - basis.y, finding.z - basis.z);
        const fog = universeFog(distance);
        if (fog <= 0) continue;
        const alpha = (MARK_MIN_ALPHA + (1 - MARK_MIN_ALPHA) * fog) * Math.min(1, fog / MARK_FADE_FOG);
        drawScanShell(
          shell.back,
          shell.front,
          (ux, uy, uz, out) => projectUniverseMark(
            finding.x + ux * finding.radius,
            finding.y + uy * finding.radius,
            finding.z + uz * finding.radius,
            basis,
            out,
          ),
          shellStyle(
            SCAN_SHELL_LINE_PX / cameraScale,
            alpha * pulse,
            true,
            universeMarkDepth(finding.x, finding.y, finding.z, basis),
          ),
        );
        if (!projectUniverseMark(finding.markX, finding.markY, finding.markZ, basis, projected)) continue;
        drawReticle(rings, projected.x, projected.y, SCAN_STRENGTH_COLORS[finding.strength], cameraScale, alpha);
        label.visible = true;
        label.position.set(projected.x, projected.y - finding.radius * projected.scale - 6 / cameraScale);
        label.scale.set(1 / cameraScale);
        label.alpha = alpha;
      }
    },
    destroy() {
      shell.back.destroy();
      container.destroy({ children: true });
    },
  };
}

export function createSuperclusterScanOverlay(superclusterSeed: number) {
  const container = new Container();
  container.eventMode = 'none';
  const shell = createShellLayers(container);
  const rings = new Graphics();
  container.addChild(rings);
  const layer = createLabelLayer(container);
  const mark = emptyPoint();

  return {
    node: container,
    backNode: shell.back,
    update(basis: ProjectionBasis, cameraScale: number, elapsedSecs: number) {
      const findings = superclusterFindings(useScanStore.getState().findings, superclusterSeed);
      layer.sync(findings);
      shell.back.clear();
      shell.front.clear();
      rings.clear();
      const pulse = 0.85 + 0.15 * Math.sin(elapsedSecs * Math.PI);
      for (const finding of findings) {
        projectPlanePointWithBasis(finding.markX, finding.markY, finding.markZ, basis, mark);
        drawScanShell(
          shell.back,
          shell.front,
          (ux, uy, uz, out) => {
            projectPlanePointWithBasis(
              finding.x + ux * finding.radius,
              finding.y + uz * finding.radius,
              finding.z + uy * finding.radius,
              basis,
              out,
            );
            return true;
          },
          shellStyle(SCAN_SHELL_LINE_PX / cameraScale, pulse, false),
        );
        drawReticle(rings, mark.x, mark.y, SCAN_STRENGTH_COLORS[finding.strength], cameraScale, 0.9);
        const label = layer.labels.get(finding.id)!;
        label.position.set(mark.x, mark.y - (RETICLE_ARM + 6) / cameraScale);
        label.scale.set(1 / cameraScale);
      }
    },
    destroy() {
      shell.back.destroy();
      container.destroy({ children: true });
    },
  };
}
