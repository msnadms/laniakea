import { memo, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useUIStore } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';
import { useFlightStore } from '../store/flightStore';
import { fireBackZoom } from '../pixi/zoomAnim';
import { Codex } from './Codex';
import { ProbeButton } from './Probes';
import { FuelGauge } from './FuelGauge';
import { Minimap } from './Minimap';
import { BaseButton } from './BasePanel';
import { getAnomalyLore } from '../game/anomalyLore';
import './ShipHUD.css';
import './AnomalyToast.css';

const COORD_TYPES = new Set(['supercluster', 'galaxy', 'system']);
const HUD_SLANT_PX = 27;
const HUD_TICK_PX = 22;
const HUD_TOP_RATIO = 0.1;

const TrapezoidOutline = ({ points }: { points: string }) => (
  <svg className="nav-back-btn-outline" viewBox="0 0 1 1" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <polygon
      vectorEffect="non-scaling-stroke"
      points={points}
      fill="transparent"
      stroke="rgba(0, 190, 230, 0.55)"
      strokeWidth="1"
      pointerEvents="all"
    />
  </svg>
);

const NavBack = memo(function NavBack() {
  const view = useUIStore((s) => s.view);
  const setView = useUIStore((s) => s.setView);
  const popAddress = useUIStore((s) => s.popAddress);
  const removeAddressType = useUIStore((s) => s.removeAddressType);
  const setSelectedPlanet = useUIStore((s) => s.setSelectedPlanet);
  const setSystem = useGameStore((s) => s.setSystem);

  const clearAddress = useUIStore((s) => s.clearAddress);

  const disabled = view === 'universe';

  function handleBack() {
    if (fireBackZoom()) return;
    if (view === 'system') {
      setSelectedPlanet(null);
      removeAddressType('system');
      setSystem(null);
      setView('galaxy');
    } else if (view === 'galaxy') {
      popAddress();
      removeAddressType('attractor');
      setView('supercluster');
    } else if (view === 'supercluster') {
      clearAddress();
      setView('universe');
    }
  }

  return (
    <button className={`side-btn nav-back-btn${disabled ? ' nav-back-btn--disabled' : ''}`} onClick={disabled ? undefined : handleBack}>
      <TrapezoidOutline points="1,0.1 0.39,0.1 0.05,1 0.65,1" />
      <span className="nav-back-btn-icon nav-back-content">◀</span>
      <span className="nav-back-btn-label">Back</span>
    </button>
  );
});

function LiveCoords() {
  const position = useFlightStore((s) => s.position);
  if (!position) return null;
  return <div className="hud-address-coords hud-address-coords--live">{position.join('.')}</div>;
}

function AddressReadout() {
  const address = useUIStore((s) => s.address);
  const coords = address
    .filter((s) => COORD_TYPES.has(s.type))
    .map((s) => `${Math.round(s.x)}.${Math.round(s.y)}.${Math.round(s.z)}`)
    .join(':');
  return (
    <div className="hud-address">
      <div className="hud-address-breadcrumb">
        {address.map((segment, i) => (
          <span key={i}>
            {i > 0 && <span className="hud-address-sep">›</span>}
            <span className={`hud-address-seg${i === address.length - 1 ? ' hud-address-seg--current' : ''}`}>
              {segment.name}
            </span>
          </span>
        ))}
      </div>
      {coords ? <div className="hud-address-coords">{coords}</div> : <LiveCoords />}
    </div>
  );
}

function AnomalyReadout() {
  const view = useUIStore((s) => s.view);
  const anomaly = useGameStore((s) => (s.system ? s.galaxyAnomalies.byHost.get(s.system.id) : undefined) ?? null);
  if (view !== 'system' || !anomaly) return null;
  const lore = getAnomalyLore(anomaly);

  function openPanel() {
    useUIStore.getState().setSelectedPlanet(null);
    useUIStore.getState().setAnomalyPanelOpen(true);
  }

  return (
    <button className={`hud-anomaly anomaly-tier-${lore.tier.toLowerCase()}`} onClick={openPanel}>
      ◬ {lore.name}
    </button>
  );
}

const BUTTON_WIDTH = 78;
const BUTTON_OVERLAP = 20;
const PROBE_BUTTON_OFFSET = 38;
const LEFT_BUTTON_EDGE = PROBE_BUTTON_OFFSET + BUTTON_WIDTH;
const RIGHT_BUTTON_EDGE = BUTTON_WIDTH - BUTTON_OVERLAP;
const LEFT_BUTTON_FOOT = LEFT_BUTTON_EDGE - BUTTON_WIDTH * 0.35;
const RIGHT_BUTTON_FOOT = BUTTON_WIDTH * 0.65 - BUTTON_OVERLAP;
const POD_GAP = 48;
const POD_SIZE = 116;
const BEZEL_RADIUS = 66;
const INSET_PX = 5;
const INSET_START_RATIO = 0.4;
const CORNER_PX = 16;
const TAB_HALF_PX = 46;
const TAB_SLANT_PX = 8;
const TAB_DEPTH_PX = 5;
const RULER_STEP_PX = 12;
const RULER_MAJOR_EVERY = 5;

function bezelChord(dy: number): number {
  return Math.sqrt(Math.max(0, BEZEL_RADIUS * BEZEL_RADIUS - dy * dy));
}

function rulerPath(from: number, to: number, y: number): string {
  const center = (from + to) / 2;
  const steps = Math.floor((to - from) / 2 / RULER_STEP_PX);
  const marks: string[] = [];
  for (let i = -steps; i <= steps; i++) {
    const x = center + i * RULER_STEP_PX;
    const length = i % RULER_MAJOR_EVERY === 0 ? 4 : 2;
    marks.push(`M ${x} ${y} V ${y - length}`);
  }
  return marks.join(' ');
}

function HudFrame() {
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    const measure = () => setSize({ w: host.offsetWidth, h: host.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const w = Math.max(size.w, 1);
  const h = Math.max(size.h, 1);
  const top = h * HUD_TOP_RATIO;
  const mid = h / 2;

  const slantLength = Math.hypot(HUD_SLANT_PX, h - top);
  const normalX = (h - top) / slantLength;
  const normalY = -HUD_SLANT_PX / slantLength;
  const innerLeft = (y: number) => INSET_PX * normalX + (y - top - INSET_PX * normalY) / (h - top) * HUD_SLANT_PX;
  const innerTop = top + (h - top) * INSET_START_RATIO;
  const innerBottom = h - INSET_PX;
  const inner = [
    `${innerLeft(innerTop)},${innerTop}`,
    `${innerLeft(innerBottom)},${innerBottom}`,
    `${w - innerLeft(innerBottom)},${innerBottom}`,
    `${w - innerLeft(innerTop)},${innerTop}`,
  ].join(' ');

  const cornerUpX = HUD_SLANT_PX / slantLength * CORNER_PX;
  const cornerUpY = (h - top) / slantLength * CORNER_PX;
  const corners = [
    `M ${HUD_SLANT_PX - cornerUpX} ${h - cornerUpY} L ${HUD_SLANT_PX} ${h} H ${HUD_SLANT_PX + CORNER_PX}`,
    `M ${w - HUD_SLANT_PX + cornerUpX} ${h - cornerUpY} L ${w - HUD_SLANT_PX} ${h} H ${w - HUD_SLANT_PX - CORNER_PX}`,
  ].join(' ');

  const tab = [
    `${w / 2 - TAB_HALF_PX},${h}`,
    `${w / 2 - TAB_HALF_PX + TAB_SLANT_PX},${h + TAB_DEPTH_PX}`,
    `${w / 2 + TAB_HALF_PX - TAB_SLANT_PX},${h + TAB_DEPTH_PX}`,
    `${w / 2 + TAB_HALF_PX},${h}`,
  ].join(' ');

  const leftPod = -(LEFT_BUTTON_EDGE + POD_GAP + POD_SIZE / 2);
  const rightPod = w + RIGHT_BUTTON_EDGE + POD_GAP + POD_SIZE / 2;
  const topChord = bezelChord(mid - top);
  const footChord = bezelChord(h - mid);
  const conduits = [
    `M ${-LEFT_BUTTON_EDGE} ${top} H ${leftPod + topChord}`,
    `M ${-LEFT_BUTTON_FOOT} ${h} H ${leftPod + footChord}`,
    `M ${w + RIGHT_BUTTON_EDGE} ${top} H ${rightPod - topChord}`,
    `M ${w + RIGHT_BUTTON_FOOT} ${h} H ${rightPod - footChord}`,
  ].join(' ');
  const joints = [
    [leftPod + topChord, top], [leftPod + footChord, h],
    [rightPod - topChord, top], [rightPod - footChord, h],
  ];

  return (
    <svg ref={ref} className="hud-frame" viewBox={`0 0 ${w} ${h}`} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {[leftPod, rightPod].map((cx, i) => (
        <g key={i}>
          <circle className="hud-bezel hud-draw" cx={cx} cy={mid} r={BEZEL_RADIUS} pathLength={1} />
          <path
            className="hud-bezel-accent hud-draw"
            pathLength={1}
            d={`M ${cx - BEZEL_RADIUS * 0.5} ${mid - BEZEL_RADIUS * 0.866} A ${BEZEL_RADIUS} ${BEZEL_RADIUS} 0 0 1 ${cx + BEZEL_RADIUS * 0.5} ${mid - BEZEL_RADIUS * 0.866}`}
          />
          <path
            className="hud-bezel-ticks"
            d={`M ${cx} ${mid - BEZEL_RADIUS - 4} V ${mid - BEZEL_RADIUS} M ${cx} ${mid + BEZEL_RADIUS} V ${mid + BEZEL_RADIUS + 4} M ${cx - BEZEL_RADIUS - 4} ${mid} H ${cx - BEZEL_RADIUS} M ${cx + BEZEL_RADIUS} ${mid} H ${cx + BEZEL_RADIUS + 4}`}
          />
        </g>
      ))}
      <path className="hud-conduit hud-draw" d={conduits} pathLength={1} />
      {joints.map(([x, y], i) => <circle key={i} className="hud-joint" cx={x} cy={y} r={1.5} />)}
      <polyline className="hud-inner hud-draw" points={inner} pathLength={1} />
      <path className="hud-ruler hud-draw" d={rulerPath(innerLeft(innerBottom) + CORNER_PX, w - innerLeft(innerBottom) - CORNER_PX, innerBottom)} pathLength={1} />
      <polyline
        className="hud-edge hud-draw"
        points={`0,${top} ${HUD_SLANT_PX},${h} ${w - HUD_SLANT_PX},${h} ${w},${top}`}
        pathLength={1}
      />
      <polyline className="hud-tab hud-draw" points={tab} pathLength={1} />
      <path className="hud-corner hud-draw" d={corners} pathLength={1} />
      <path className="hud-corner hud-draw" d={`M 0 ${top} H ${HUD_TICK_PX} M ${w} ${top} H ${w - HUD_TICK_PX}`} pathLength={1} />
    </svg>
  );
}

function HudPod({ side, children }: { side: 'left' | 'right'; children: ReactNode }) {
  const offset = (side === 'left' ? LEFT_BUTTON_EDGE : RIGHT_BUTTON_EDGE) + POD_GAP;
  return (
    <div
      className={`hud-pod hud-pod--${side}`}
      style={side === 'left' ? { right: `calc(100% + ${offset}px)` } : { left: `calc(100% + ${offset}px)` }}
    >
      {children}
    </div>
  );
}

export function ShipHUD() {
  return (
    <div className="ship-hud">
      <div className="hud-glass" />
      <HudFrame />
      <HudPod side="left">
        <FuelGauge />
      </HudPod>
      <HudPod side="right">
        <Minimap />
      </HudPod>
      <Codex />
      <ProbeButton />
      <NavBack />
      <div className="hud-header">Navigation</div>
      <AddressReadout />
      <AnomalyReadout />
      <BaseButton />
    </div>
  );
}
