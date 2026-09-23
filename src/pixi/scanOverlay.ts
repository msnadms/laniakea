import { Container, Graphics } from 'pixi.js';
import type { ScanFinding } from '../firebase/scans';
import { heatBloom, jitteredHeat } from '../game/scanGraph';
import {
  SCAN_HEAT_NOISE_CELL,
  SCAN_MARK_COLOR,
  SCAN_MARK_LINE_PX,
  SCAN_WEB_LINE_PX,
} from '../game/constants';
import { superclusterFindings, universeFindings, useScanStore } from '../store/scanStore';
import { projectUniverseMark, universeFog, type FlyBasis } from './flyProjection';
import { drawScanWeb } from './scanWeb';
import { projectPlanePointWithBasis, type ProjectedPoint, type ProjectionBasis } from './projection';

const MARK_MIN_ALPHA = 0.55;
const MARK_FADE_FOG = 0.05;
const MARK_ARM_PX = 11;
const MARK_GAP_PX = 4;

function emptyPoint(): ProjectedPoint {
  return { x: 0, y: 0, depth: 0, scale: 1 };
}

// A node's heat is read from every sweep that covers it, so a narrower overlapping sweep
// tightens the map the moment it lands.
function createHeatCache() {
  let key = '';
  let heats = new Map<string, number[]>();
  return {
    get key() {
      return key;
    },
    sync(findings: readonly ScanFinding[]) {
      const next = findings.map((finding) => `${finding.id}:${finding.strength}`).join(',');
      if (next === key) return heats;
      key = next;
      heats = new Map();
      for (const finding of findings) {
        const cell = heatBloom(finding) * SCAN_HEAT_NOISE_CELL;
        const values: number[] = [];
        for (let i = 0; i * 3 < finding.nodes.length; i++) {
          values.push(jitteredHeat(
            findings,
            finding.nodes[i * 3],
            finding.nodes[i * 3 + 1],
            finding.nodes[i * 3 + 2],
            cell,
          ));
        }
        heats.set(finding.id, values);
      }
      return heats;
    },
  };
}

// The web's geometry only moves when the view or the findings do, so a still frame redraws
// nothing and the pulse rides on the layers' alpha instead.
function fold(values: readonly number[]): number {
  let hash = 0;
  for (const value of values) hash = hash * 31 + value;
  return hash;
}

// The back half sits under the dot field so the web reads as a volume the dots are inside of,
// so it is a node of its own for the view to place.
function createWebLayers(container: Container) {
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
  const web = createWebLayers(container);
  const cache = createHeatCache();
  let drawnAt = NaN;
  let drawnKey = '';

  return {
    node: container,
    backNode: web.back,
    update(basis: FlyBasis, cameraScale: number, elapsedSecs: number) {
      const findings = universeFindings(useScanStore.getState().findings);
      const heatmap = cache.sync(findings);
      const pulse = 0.85 + 0.15 * Math.sin(elapsedSecs * Math.PI);
      web.back.alpha = pulse;
      web.front.alpha = pulse;
      const signature = fold([
        basis.x, basis.y, basis.z, basis.cosYaw, basis.sinYaw, basis.cosPitch, basis.sinPitch,
        basis.focal, basis.halfWidth, basis.halfHeight, cameraScale,
      ]);
      if (signature === drawnAt && cache.key === drawnKey) return;
      drawnAt = signature;
      drawnKey = cache.key;
      web.back.clear();
      web.front.clear();
      for (const finding of findings) {
        if (finding.nodes.length < 3) continue;
        const distance = Math.hypot(finding.x - basis.x, finding.y - basis.y, finding.z - basis.z);
        const fog = universeFog(distance);
        if (fog <= 0) continue;
        const alpha = (MARK_MIN_ALPHA + (1 - MARK_MIN_ALPHA) * fog) * Math.min(1, fog / MARK_FADE_FOG);
        drawScanWeb(
          web.back,
          web.front,
          finding,
          heatmap.get(finding.id)!,
          (x, y, z, out) => projectUniverseMark(x, y, z, basis, out),
          { width: SCAN_WEB_LINE_PX / cameraScale, alpha },
        );
      }
    },
    destroy() {
      web.back.destroy();
      container.destroy({ children: true });
    },
  };
}

export function createSuperclusterScanOverlay(superclusterSeed: number) {
  const container = new Container();
  container.eventMode = 'none';
  const marks = new Graphics();
  marks.eventMode = 'none';
  container.addChild(marks);
  const projected = emptyPoint();

  return {
    node: container,
    // A sweep inside a supercluster resolves to the galaxy itself, so it is marked outright
    // rather than drawn as a field to narrow.
    update(basis: ProjectionBasis, cameraScale: number, elapsedSecs: number) {
      const findings = superclusterFindings(useScanStore.getState().findings, superclusterSeed);
      marks.clear();
      const pulse = 0.72 + 0.28 * Math.abs(Math.sin(elapsedSecs * Math.PI * 0.6));
      const arm = MARK_ARM_PX / cameraScale;
      const gap = MARK_GAP_PX / cameraScale;
      for (const finding of findings) {
        for (let i = 0; i + 3 < finding.signals.length; i += 4) {
          projectPlanePointWithBasis(finding.signals[i], finding.signals[i + 1], finding.signals[i + 2], basis, projected);
          const { x, y } = projected;
          marks.moveTo(x - arm, y).lineTo(x - gap, y);
          marks.moveTo(x + gap, y).lineTo(x + arm, y);
          marks.moveTo(x, y - arm).lineTo(x, y - gap);
          marks.moveTo(x, y + gap).lineTo(x, y + arm);
          marks.circle(x, y, gap);
        }
      }
      marks.stroke({ color: SCAN_MARK_COLOR, width: SCAN_MARK_LINE_PX / cameraScale, alpha: pulse });
    },
    destroy() {
      container.destroy({ children: true });
    },
  };
}
