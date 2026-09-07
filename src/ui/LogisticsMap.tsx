import { useEffect, useMemo, useRef, useState } from 'react';
import { ICON_PATHS } from './iconPaths';
import { MAP_SIZE, NODE_R } from './logisticsProject';
import type { ProjectedMapNode } from './logisticsProject';
import type { RouteEdge, SlotStatus } from '../game/types';
import type { EdgeFlowResult } from '../store/logisticsStore';
import { edgeKey } from '../store/logisticsStore';

const ICON_SIZE = NODE_R * 1.6;
const ICON_HALF = ICON_SIZE / 2;

const MIN_VIEW_SIZE = MAP_SIZE * 0.18;
const DEFAULT_VIEW = { cx: MAP_SIZE / 2, cy: MAP_SIZE / 2, size: MAP_SIZE };
const FIT_PADDING = NODE_R + 26;
const ZOOM_STEP = 1.25;

type MapView = { cx: number; cy: number; size: number };

function fitViewOf(projected: ProjectedMapNode[]): MapView {
  if (projected.length === 0) return DEFAULT_VIEW;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of projected) {
    minX = Math.min(minX, p.svgX);
    maxX = Math.max(maxX, p.svgX);
    minY = Math.min(minY, p.svgY);
    maxY = Math.max(maxY, p.svgY);
  }
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    size: Math.max(MAP_SIZE * 0.5, maxX - minX + FIT_PADDING * 2, maxY - minY + FIT_PADDING * 2),
  };
}

const STATUS_RING: Record<SlotStatus, string | null> = {
  idle: null,
  ready: 'rgba(120,220,255,0.9)',
  starved: 'rgba(255,180,60,0.9)',
  jammed: 'rgba(255,80,80,0.95)',
  flowing: 'rgba(60,220,120,0.9)',
};

function NodeIcon({ cx, cy, resourceType, color }: { cx: number; cy: number; resourceType: string; color: string }) {
  const d = ICON_PATHS[resourceType as keyof typeof ICON_PATHS];
  if (!d) return null;
  return (
    <path
      d={d}
      fill={color}
      transform={`translate(${cx - ICON_HALF},${cy - ICON_HALF}) scale(${ICON_SIZE / 960}) translate(0,960)`}
      style={{ pointerEvents: 'none' }}
    />
  );
}

function clampViewSize(size: number, fitSize: number): number {
  return Math.max(MIN_VIEW_SIZE, Math.min(fitSize * 2.5, size));
}

function viewBoxOf(view: MapView, aspect: number) {
  const w = aspect >= 1 ? view.size * aspect : view.size;
  const h = aspect >= 1 ? view.size : view.size / aspect;
  return { x: view.cx - w / 2, y: view.cy - h / 2, w, h };
}

function flowLabel(flow: EdgeFlowResult | undefined): string {
  if (!flow) return '';
  return `${flow.used}/${flow.capacity}`;
}

function flowDetail(flow: EdgeFlowResult | undefined): string {
  if (!flow) return 'No dispatch data yet';
  const cargo = [
    ...Object.entries(flow.raw).map(([id, amount]) => `${id}: ${amount}`),
    ...Object.entries(flow.materials).map(([id, amount]) => `${id}: ${amount}`),
  ];
  const rejected = Object.entries(flow.rejected).filter(([, amount]) => amount > 0)
    .map(([id, amount]) => `${id}: ${amount}`).join(', ');
  return [`${flow.used}/${flow.capacity} material capacity`, cargo.join(', ') || 'No cargo moved', rejected ? `Redirected: ${rejected}` : ''].filter(Boolean).join('\n');
}

export function StationMap({
  projected,
  draftNodes,
  draftEdges,
  nodeStatus,
  edgeFlows,
  heldNodeIds,
  islandNodes = [],
  onAddEdge,
  onRemoveEdge,
  onNodeClick,
  onBackgroundClick,
  animActiveNodeId,
  canLink,
}: {
  projected: ProjectedMapNode[];
  draftNodes: string[];
  draftEdges: RouteEdge[];
  nodeStatus?: Record<string, SlotStatus>;
  edgeFlows?: Record<string, EdgeFlowResult>;
  heldNodeIds?: Set<string>;
  islandNodes?: string[];
  onAddEdge: (from: string, to: string) => void;
  onRemoveEdge: (edge: RouteEdge) => void;
  onNodeClick: (nodeId: string) => void;
  onBackgroundClick?: () => void;
  animActiveNodeId?: string | null;
  canLink: (from: string, to: string) => boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const draggedRef = useRef(false);
  const pannedRef = useRef(false);
  const panRef = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null);
  const [drag, setDrag] = useState<{ from: string; x: number; y: number; over: string | null } | null>(null);
  const [savedView, setSavedView] = useState<{ sig: string; view: MapView } | null>(null);
  const [aspect, setAspect] = useState(1);
  const [panning, setPanning] = useState(false);
  const nodeSignature = projected.map((p) => p.nodeId).join('|');
  const fitView = fitViewOf(projected);
  const userView = savedView && savedView.sig === nodeSignature ? savedView.view : null;
  const view = userView ?? fitView;
  const box = viewBoxOf(view, aspect);
  const viewRef = useRef(view);
  const boxRef = useRef(box);
  const fitRef = useRef(fitView);
  const sigRef = useRef(nodeSignature);

  function setUserView(next: MapView | ((prev: MapView | null) => MapView) | null) {
    setSavedView((prev) => {
      if (next === null) return null;
      const current = prev && prev.sig === sigRef.current ? prev.view : null;
      return { sig: sigRef.current, view: typeof next === 'function' ? next(current) : next };
    });
  }

  useEffect(() => {
    viewRef.current = view;
    boxRef.current = box;
    fitRef.current = fitView;
    sigRef.current = nodeSignature;
  });

  const byNodeId = useMemo(
    () => Object.fromEntries(projected.map((p) => [p.nodeId, p])),
    [projected],
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setAspect(width / height);
    });
    observer.observe(svg);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const v = viewRef.current;
      const size = clampViewSize(v.size * (e.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP), fitRef.current.size);
      const next = viewBoxOf({ ...v, size }, rect.width / rect.height);
      const fx = (e.clientX - rect.left) / rect.width - 0.5;
      const fy = (e.clientY - rect.top) / rect.height - 0.5;
      setUserView({
        cx: v.cx + fx * (boxRef.current.w - next.w),
        cy: v.cy + fy * (boxRef.current.h - next.h),
        size,
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      observer.disconnect();
      svg.removeEventListener('wheel', onWheel);
    };
  }, [projected.length]);

  function zoomAtCenter(factor: number) {
    setUserView((v) => {
      const base = v ?? fitRef.current;
      return { ...base, size: clampViewSize(base.size * factor, fitRef.current.size) };
    });
  }

  function endPan() {
    panRef.current = null;
    setPanning(false);
  }

  function consumedByPan(): boolean {
    if (!pannedRef.current) return false;
    pannedRef.current = false;
    return true;
  }

  if (projected.length === 0) {
    return (
      <div className="station-map-empty">No extraction stations or fabricators placed</div>
    );
  }

  function toSvg(e: React.PointerEvent): { x: number; y: number } {
    const rect = svgRef.current!.getBoundingClientRect();
    const b = boxRef.current;
    return {
      x: b.x + ((e.clientX - rect.left) / rect.width) * b.w,
      y: b.y + ((e.clientY - rect.top) / rect.height) * b.h,
    };
  }

  function edgeGeometry(edge: RouteEdge) {
    const a = byNodeId[edge.from];
    const b = byNodeId[edge.to];
    if (!a || !b) return null;
    const dx = b.svgX - a.svgX;
    const dy = b.svgY - a.svgY;
    const len = Math.hypot(dx, dy) || 1;
    const pad = NODE_R + 3;
    return {
      x1: a.svgX + (dx / len) * pad,
      y1: a.svgY + (dy / len) * pad,
      x2: b.svgX - (dx / len) * pad,
      y2: b.svgY - (dy / len) * pad,
      toFabricator: b.nodeType === 'fabricator',
    };
  }

  return (
    <>
    <svg
      ref={svgRef}
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      className={`station-map-svg${panning ? ' station-map-svg--panning' : ''}`}
      xmlns="http://www.w3.org/2000/svg"
      onClick={() => {
        if (consumedByPan()) return;
        onBackgroundClick?.();
      }}
      onPointerDown={(e) => {
        if (drag) return;
        pannedRef.current = false;
        panRef.current = { px: e.clientX, py: e.clientY, vx: view.cx, vy: view.cy };
        setPanning(true);
      }}
      onPointerMove={(e) => {
        const pan = panRef.current;
        if (pan) {
          const rect = e.currentTarget.getBoundingClientRect();
          const dx = (e.clientX - pan.px) * (boxRef.current.w / rect.width);
          const dy = (e.clientY - pan.py) * (boxRef.current.h / rect.height);
          if (Math.abs(dx) + Math.abs(dy) > 0.5) pannedRef.current = true;
          setUserView((v) => ({ ...(v ?? fitRef.current), cx: pan.vx - dx, cy: pan.vy - dy }));
          return;
        }
        if (!drag) return;
        const p = toSvg(e);
        draggedRef.current = true;
        setDrag((d) => (d ? { ...d, x: p.x, y: p.y } : null));
      }}
      onPointerUp={() => {
        endPan();
        if (drag?.over && drag.over !== drag.from && canLink(drag.from, drag.over)) {
          onAddEdge(drag.from, drag.over);
        }
        setDrag(null);
      }}
      onPointerLeave={() => {
        endPan();
        setDrag(null);
      }}
    >
      <defs>
        <marker id="lm-arrow" markerWidth="5" markerHeight="4" refX="4" refY="2" orient="auto">
          <polygon points="0 0, 5 2, 0 4" fill="rgba(0,180,220,0.55)" />
        </marker>
        <marker id="lm-arrow-col" markerWidth="5" markerHeight="4" refX="4" refY="2" orient="auto">
          <polygon points="0 0, 5 2, 0 4" fill="rgba(60,200,100,0.55)" />
        </marker>
      </defs>

      {draftEdges.map((edge) => {
        const g = edgeGeometry(edge);
        if (!g) return null;
        const label = flowLabel(edgeFlows?.[edgeKey(edge)]);
        const mx = (g.x1 + g.x2) / 2;
        const my = (g.y1 + g.y2) / 2;
        return (
          <g key={`${edge.from}->${edge.to}`}>
            <title>{flowDetail(edgeFlows?.[edgeKey(edge)])}</title>
            <line
              x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}
              stroke={g.toFabricator ? 'rgba(60,200,100,0.45)' : 'rgba(0,180,220,0.45)'}
              strokeWidth="1.2"
              strokeDasharray="5 3"
              markerEnd={g.toFabricator ? 'url(#lm-arrow-col)' : 'url(#lm-arrow)'}
              style={{ pointerEvents: 'none' }}
            />
            <line
              x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}
              stroke="transparent"
              strokeWidth="8"
              style={{ cursor: 'pointer' }}
              onClick={(e) => { e.stopPropagation(); if (consumedByPan()) return; onRemoveEdge(edge); }}
            >
              <title>Click to remove link</title>
            </line>
            {label && (
              <text
                x={mx} y={my - 2}
                textAnchor="middle"
                fill="rgba(150,200,220,0.6)"
                fontSize="5"
                style={{ pointerEvents: 'none', fontFamily: 'var(--font-mono)' }}
              >
                {label}
              </text>
            )}
          </g>
        );
      })}

      {drag && byNodeId[drag.from] && (
        <line
          x1={byNodeId[drag.from].svgX} y1={byNodeId[drag.from].svgY}
          x2={drag.x} y2={drag.y}
          stroke={drag.over && drag.over !== drag.from && canLink(drag.from, drag.over)
            ? 'rgba(120,255,180,0.8)'
            : 'rgba(255,120,120,0.6)'}
          strokeWidth="1.4"
          strokeDasharray="3 3"
          style={{ pointerEvents: 'none' }}
        />
      )}

      {projected.map((p) => {
        const inRoute = draftNodes.includes(p.nodeId);
        const shortName = p.name.length > 9 ? p.name.slice(0, 8) + '…' : p.name;
        const isFabricator = p.nodeType === 'fabricator';
        const isAdvanced = isFabricator && !!p.advanced;
        const status = nodeStatus?.[p.nodeId];
        const statusRing = status ? STATUS_RING[status] : null;
        const island = islandNodes.includes(p.nodeId);

        const fabStrokeActive = isAdvanced ? 'rgba(255,190,80,0.9)' : 'rgba(60,220,100,0.9)';
        const fabStrokeIdle = isAdvanced ? 'rgba(150,105,30,0.5)' : 'rgba(30,140,60,0.5)';
        const fabFillActive = isAdvanced ? 'rgba(110,70,10,0.4)' : 'rgba(20,100,40,0.4)';
        const fabFillIdle = isAdvanced ? 'rgba(30,20,0,0.5)' : 'rgba(0,30,10,0.5)';
        const fabGlow = isAdvanced ? 'rgba(220,170,60,0.2)' : 'rgba(60,200,80,0.2)';
        const fabLabelActive = isAdvanced ? 'rgba(255,200,90,0.8)' : 'rgba(60,220,100,0.8)';
        const fabLabelIdle = isAdvanced ? 'rgba(150,110,35,0.55)' : 'rgba(30,140,60,0.55)';

        const strokeActive = isFabricator ? fabStrokeActive : 'rgba(0,215,255,0.85)';
        const strokeIdle = isFabricator ? fabStrokeIdle : 'rgba(0,130,180,0.45)';
        const fillActive = isFabricator ? fabFillActive : 'rgba(0,140,190,0.35)';
        const fillIdle = isFabricator ? fabFillIdle : 'rgba(0,50,80,0.5)';
        const glowActive = isFabricator ? fabGlow : 'rgba(0,210,240,0.2)';
        const labelActive = isFabricator ? fabLabelActive : 'rgba(0,200,232,0.75)';
        const labelIdle = isFabricator ? fabLabelIdle : 'rgba(0,130,170,0.5)';

        const primaryRes = p.resources?.reduce(
          (a, b) => (a.accumulated >= b.accumulated ? a : b),
          p.resources[0],
        );
        const iconColor = inRoute
          ? (isFabricator ? (isAdvanced ? 'rgba(255,205,100,0.9)' : 'rgba(80,230,120,0.9)') : 'rgba(0,230,255,0.9)')
          : (isFabricator ? (isAdvanced ? 'rgba(150,110,35,0.55)' : 'rgba(30,140,60,0.55)') : 'rgba(0,150,190,0.55)');

        return (
          <g
            key={p.nodeId}
            onClick={(e) => {
              e.stopPropagation();
              if (consumedByPan()) return;
              if (draggedRef.current) { draggedRef.current = false; return; }
              onNodeClick(p.nodeId);
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              const pt = toSvg(e);
              draggedRef.current = false;
              setDrag({ from: p.nodeId, x: pt.x, y: pt.y, over: null });
            }}
            onPointerEnter={() => setDrag((d) => (d ? { ...d, over: p.nodeId } : null))}
            onPointerLeave={() => setDrag((d) => (d && d.over === p.nodeId ? { ...d, over: null } : d))}
            style={{ cursor: 'pointer' }}
          >
            <circle cx={p.svgX} cy={p.svgY} r={NODE_R + 6} fill="transparent" />
            {p.nodeId === animActiveNodeId && (
              <circle
                cx={p.svgX} cy={p.svgY} r={NODE_R + 7}
                fill="rgba(255, 230, 80, 0.07)"
                stroke="rgba(255, 220, 60, 0.85)"
                strokeWidth="1.5"
                className="dispatch-node-pulse"
              />
            )}
            {inRoute && (
              <circle
                cx={p.svgX} cy={p.svgY} r={NODE_R + 3}
                fill="none"
                stroke={glowActive}
                strokeWidth="3"
              />
            )}
            {island && (
              <circle
                cx={p.svgX} cy={p.svgY} r={NODE_R + 7}
                fill="rgba(255,70,70,0.05)"
                stroke="rgba(255,90,90,0.9)"
                strokeWidth="1.4"
                strokeDasharray="2 2"
                style={{ pointerEvents: 'none' }}
              />
            )}
            {statusRing && (
              <circle
                cx={p.svgX} cy={p.svgY} r={NODE_R + 4}
                fill="none"
                stroke={statusRing}
                strokeWidth="1.2"
                strokeDasharray={status === 'flowing' ? undefined : '3 2'}
                style={{ pointerEvents: 'none' }}
              />
            )}
            {heldNodeIds?.has(p.nodeId) && (
              <g style={{ pointerEvents: 'none' }}>
                <circle cx={p.svgX + NODE_R - 1} cy={p.svgY - NODE_R + 1} r="3.5" fill="#ffb23d" stroke="#241400" strokeWidth="0.8" />
                <text x={p.svgX + NODE_R - 1} y={p.svgY - NODE_R + 2.3} textAnchor="middle" fill="#241400" fontSize="4.5" fontWeight="bold">!</text>
              </g>
            )}
            <circle
              cx={p.svgX} cy={p.svgY} r={NODE_R}
              fill={inRoute ? fillActive : fillIdle}
              stroke={inRoute ? strokeActive : strokeIdle}
              strokeWidth="1.5"
            />
            {p.nodeType === 'colony' ? (
              <g style={{ pointerEvents: 'none' }}>
                <polygon points={Array.from({ length: 6 }, (_, i) => `${p.svgX + 7 * Math.cos(i * Math.PI / 3)},${p.svgY + 7 * Math.sin(i * Math.PI / 3)}`).join(' ')} fill={p.supplied ? '#66e6af' : '#efb65b'} />
                <circle cx={p.svgX} cy={p.svgY} r={NODE_R + 6} fill="none" stroke={p.supplied ? '#66e6af' : '#efb65b'} strokeWidth="2" pathLength="100" strokeDasharray={`${Math.min(100, (p.populationFill ?? 0) * 100)} 100`} transform={`rotate(-90 ${p.svgX} ${p.svgY})`} />
              </g>
            ) : isFabricator ? (
              <polygon
                points={`${p.svgX},${p.svgY - ICON_HALF * 0.85} ${p.svgX + ICON_HALF * 0.65},${p.svgY} ${p.svgX},${p.svgY + ICON_HALF * 0.85} ${p.svgX - ICON_HALF * 0.65},${p.svgY}`}
                fill={iconColor}
                style={{ pointerEvents: 'none' }}
              />
            ) : p.resources && p.resources.length > 1 ? (
              <NodeIcon cx={p.svgX} cy={p.svgY} resourceType="multiSystem" color={iconColor} />
            ) : primaryRes ? (
              <NodeIcon cx={p.svgX} cy={p.svgY} resourceType={primaryRes.type} color={iconColor} />
            ) : null}
            <text
              x={p.svgX} y={p.svgY + NODE_R + 5}
              textAnchor="middle"
              dominantBaseline="hanging"
              fill={inRoute ? labelActive : labelIdle}
              fontSize="6"
              letterSpacing="0.5"
              style={{ pointerEvents: 'none', fontFamily: 'var(--font-mono)' }}
            >
              {shortName}
            </text>
          </g>
        );
      })}
    </svg>
    <div className="station-map-controls">
      <button type="button" title="Zoom in" onClick={() => zoomAtCenter(1 / ZOOM_STEP)}>+</button>
      <button type="button" title="Zoom out" onClick={() => zoomAtCenter(ZOOM_STEP)}>−</button>
      <button type="button" title="Reset view" onClick={() => setUserView(null)}>⤾</button>
    </div>
    </>
  );
}
