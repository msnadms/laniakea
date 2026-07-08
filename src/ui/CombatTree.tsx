import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUIStore, computeCombatEffects, COMBAT_POINT_BUDGET } from '../store/uiStore';
import { SKILL_NODES } from '../data/skillTree';
import { COMBAT_CORES } from '../data/upgrades';
import type { SkillNode, CombatEffect } from '../game/types';
import { fmt } from './strings';
import './CombatTree.css';

const CURRENCY_LABEL: Record<string, string> = { alloys: 'Alloys', exotic: 'Exotic', helium: 'He-3' };
const CORE_NAME: Record<string, string> = Object.fromEntries(COMBAT_CORES.map((c) => [c.id, c.name]));

function describeEffect(e: CombatEffect): string[] {
  const out: string[] = [];
  if (e.enablesFire) out.push('Unlocks railgun FIRE');
  if (e.ammoCapBonus) out.push(`+${e.ammoCapBonus} max ammo`);
  if (e.fireCostDelta) out.push(`${e.fireCostDelta < 0 ? '' : '+'}${e.fireCostDelta} ammo / shot`);
  if (e.cooldownMult) out.push(`${Math.round((1 - e.cooldownMult) * 100)}% faster fire`);
  if (e.detentBonus) out.push(`+${e.detentBonus} detection cleared / shot`);
  if (e.riseChanceMult) out.push(`−${Math.round((1 - e.riseChanceMult) * 100)}% detection risk`);
  if (e.decayBonus) out.push('lock fades faster');
  if (e.shieldCapacity) out.push(`+${e.shieldCapacity} deflector charge`);
  if (e.fullPurge) out.push('FIRE wipes all detection');
  if (e.autoFire) out.push('auto-fires to survive a lethal lock');
  if (e.aegis) out.push('absorbs a lethal lock');
  return out;
}

function childrenOf(node: SkillNode, treeNodes: SkillNode[]): SkillNode[] {
  return treeNodes.filter((n) => n.prereqs.includes(node.id));
}

const STAGE_W = 1300;
const STAGE_H = 780;
const NODE_R = 11;
const ROOT_R = 15;
const CARD_W = 176;
const ELBOW = 52;
const ROWS = [80, 180, 280, 380, 480, 580, 680];
const LEAF_YS = [150, 300, 460, 610];

const CLUSTERS: Record<'weapon' | 'shield', { side: 'left' | 'right'; xByDepth: number[] }> = {
  weapon: { side: 'left', xByDepth: [470, 380, 300] },
  shield: { side: 'right', xByDepth: [830, 920, 1000] },
};

interface NodeLayout {
  node: SkillNode;
  cx: number;
  cy: number;
  r: number;
  isRoot: boolean;
  tree: 'weapon' | 'shield';
  side: 'left' | 'right';
  cardX: number;
  rowY: number;
  leader: string;
}

function buildLayout(): { nodes: NodeLayout[]; spokes: { tree: string; d: string }[] } {
  const nodes: NodeLayout[] = [];
  const spokes: { tree: string; d: string }[] = [];

  (Object.keys(CLUSTERS) as ('weapon' | 'shield')[]).forEach((tree) => {
    const cfg = CLUSTERS[tree];
    const treeNodes = SKILL_NODES.filter((n) => n.tree === tree);
    const root = treeNodes.find((n) => n.tier === 0)!;
    const cardX = cfg.side === 'left' ? 12 : STAGE_W - 12 - CARD_W;
    const anchorX = cfg.side === 'left' ? cardX + CARD_W : cardX;
    const elbowX = cfg.side === 'left' ? anchorX + ELBOW : anchorX - ELBOW;

    const pos = new Map<string, { x: number; y: number }>();
    let leafIdx = 0;
    const place = (node: SkillNode, depth: number): number => {
      const kids = childrenOf(node, treeNodes);
      const x = cfg.xByDepth[Math.min(depth, cfg.xByDepth.length - 1)];
      let y: number;
      if (kids.length === 0) {
        y = LEAF_YS[Math.min(leafIdx++, LEAF_YS.length - 1)];
      } else {
        const kidYs = kids.map((k) => place(k, depth + 1));
        y = kidYs.reduce((a, c) => a + c, 0) / kidYs.length;
        for (const k of kids) {
          const kp = pos.get(k.id)!;
          spokes.push({ tree, d: `M ${x} ${y} L ${kp.x} ${kp.y}` });
        }
      }
      pos.set(node.id, { x, y });
      return y;
    };
    place(root, 0);

    const ordered = [...treeNodes].sort((a, c) => pos.get(a.id)!.y - pos.get(c.id)!.y);
    ordered.forEach((n, i) => {
      const p = pos.get(n.id)!;
      const rowY = ROWS[Math.min(i, ROWS.length - 1)];
      nodes.push({
        node: n, cx: p.x, cy: p.y, r: n.id === root.id ? ROOT_R : NODE_R, isRoot: n.id === root.id,
        tree, side: cfg.side, cardX, rowY,
        leader: `${p.x},${p.y} ${elbowX},${rowY} ${anchorX},${rowY}`,
      });
    });
  });

  return { nodes, spokes };
}

const LAYOUT = buildLayout();

type NodeStatus = { owned: boolean; purchasable: boolean; state: 'owned' | 'available' | 'locked' };

function statusOf(node: SkillNode, skillNodes: string[], ownedCores: string[], alloys: number, exotic: number, helium: number): NodeStatus {
  const owned = skillNodes.includes(node.id);
  const prereqMet = node.prereqs.every((p) => skillNodes.includes(p));
  const coreMet = !node.requiresCore || ownedCores.includes(node.requiresCore);
  const budgetOk = skillNodes.length < COMBAT_POINT_BUDGET;
  const affordable = (node.cost.alloys ?? 0) <= alloys && (node.cost.exotic ?? 0) <= exotic && (node.cost.helium ?? 0) <= helium;
  const purchasable = !owned && prereqMet && coreMet && budgetOk && affordable;
  return { owned, purchasable, state: owned ? 'owned' : prereqMet ? 'available' : 'locked' };
}

function LabelCard({ l, status, hovered, onHover }: { l: NodeLayout; status: NodeStatus; hovered: boolean; onHover: (id: string | null) => void }) {
  const ownedCores = useUIStore((s) => s.ownedCores);
  const purchaseSkillNode = useUIStore((s) => s.purchaseSkillNode);
  const { node } = l;
  const coreMet = !node.requiresCore || ownedCores.includes(node.requiresCore);

  return (
    <div
      className={`ct-card ct-card--${l.side} ct-card--${node.tree} ct-card--${status.state}${hovered ? ' ct-card--hover' : ''}`}
      style={{ left: l.cardX, top: l.rowY, width: CARD_W }}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="ct-card-head">
        <span className="ct-card-name">{node.name}</span>
        {status.owned && <span className="ct-card-owned">◆</span>}
      </div>
      <div className="ct-card-effects">{describeEffect(node.effect).join('  ·  ')}</div>
      <div className="ct-card-desc">{node.desc}</div>
      {node.requiresCore && (
        <div className={`ct-card-core${coreMet ? ' ct-card-core--met' : ''}`}>Core: {CORE_NAME[node.requiresCore] ?? node.requiresCore}</div>
      )}
      {!status.owned && (
        <button
          className={`ct-card-btn${!status.purchasable ? ' ct-card-btn--dim' : ''}`}
          disabled={!status.purchasable}
          onClick={() => purchaseSkillNode(node.id)}
        >
          {status.state === 'locked'
            ? 'LOCKED'
            : Object.entries(node.cost)
                .filter(([, v]) => v)
                .map(([k, v]) => `${fmt(v as number)} ${CURRENCY_LABEL[k] ?? k}`)
                .join('   ')}
        </button>
      )}
    </div>
  );
}

function ActiveSystems() {
  const skillNodes = useUIStore((s) => s.skillNodes);
  const ownedCores = useUIStore((s) => s.ownedCores);
  const railgunAmmo = useUIStore((s) => s.railgunAmmo);
  const shieldCharge = useUIStore((s) => s.shieldCharge);
  const detectionRating = useUIStore((s) => s.detectionRating);
  const helium3Reserves = useUIStore((s) => s.helium3Reserves);
  const fireRailgun = useUIStore((s) => s.fireRailgun);
  const reloadRailgun = useUIStore((s) => s.reloadRailgun);
  const fx = computeCombatEffects(skillNodes);
  const spent = skillNodes.length;

  return (
    <div className="ct-active">
      <div className="ct-active-stats">
        <div className="ct-budget">
          <span className="ct-budget-label">SYSTEM POINTS</span>
          <div className="ct-budget-dots">
            {Array.from({ length: COMBAT_POINT_BUDGET }, (_, i) => (
              <div key={i} className={`ct-budget-dot${i < spent ? ' ct-budget-dot--filled' : ''}`} />
            ))}
          </div>
          <span className="ct-budget-count">{COMBAT_POINT_BUDGET - spent} left</span>
        </div>
        <div className="ct-cores">
          <span className="ct-cores-label">CORES</span>
          {COMBAT_CORES.map((c) => (
            <span key={c.id} className="ct-core-chip">{c.name.split(' ')[0]} ×{ownedCores.filter((id) => id === c.id).length}</span>
          ))}
        </div>
      </div>
      {fx.hasFire && (
        <div className="ct-active-controls">
          <span className="ct-active-readout">AMMO {fmt(railgunAmmo)}/{fmt(fx.ammoCap)}</span>
          {fx.shieldCapacity > 0 && <span className="ct-active-readout">SHIELD {shieldCharge}/{fx.shieldCapacity}</span>}
          <span className="ct-active-readout">DETECTION {detectionRating}/5</span>
          <button className="ct-fire-btn" disabled={detectionRating <= 0 || railgunAmmo < fx.fireCost} onClick={fireRailgun}>
            FIRE −{fx.hasFullPurge ? 'ALL' : fx.detentPerShot} ({fx.fireCost} ammo)
          </button>
          <button className="ct-reload-btn" disabled={railgunAmmo >= fx.ammoCap || helium3Reserves <= 0} onClick={reloadRailgun}>RELOAD</button>
        </div>
      )}
    </div>
  );
}

function CombatTreeInner() {
  const toggle = useUIStore((s) => s.toggleCombatTree);
  const skillNodes = useUIStore((s) => s.skillNodes);
  const ownedCores = useUIStore((s) => s.ownedCores);
  const alloys = useUIStore((s) => s.alloys);
  const exoticMatter = useUIStore((s) => s.exoticMatter);
  const helium3Reserves = useUIStore((s) => s.helium3Reserves);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') toggle(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  const statuses = new Map<string, NodeStatus>();
  for (const l of LAYOUT.nodes) statuses.set(l.node.id, statusOf(l.node, skillNodes, ownedCores, alloys, exoticMatter, helium3Reserves));

  return createPortal(
    <div className="ct-overlay" onClick={toggle}>
      <div className="ct-panel" onClick={(e) => e.stopPropagation()}>
        <button className="planet-panel-close" onClick={toggle}>✕</button>
        <div className="ct-header">
          <div className="ct-title">COMBAT SYSTEMS</div>
          <div className="ct-subtitle">Weapon &amp; Shield Doctrine</div>
        </div>
        <ActiveSystems />
        <div className="ct-tree-labels">
          <span className="ct-tree-label ct-tree-label--weapon">RAILGUNS · destroy sentinel probes</span>
          <span className="ct-tree-label ct-tree-label--shield">DEFLECTORS · evade sentinel probes altogether</span>
        </div>
        <div className="ct-stage-scroll">
          <div className="ct-stage" style={{ width: STAGE_W, height: STAGE_H }}>
            <svg className="ct-svg" viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} width={STAGE_W} height={STAGE_H}>
              {LAYOUT.spokes.map((s, i) => (
                <path key={i} d={s.d} className={`ct-spoke ct-spoke--${s.tree}`} />
              ))}
              {LAYOUT.nodes.map((l) => {
                const st = statuses.get(l.node.id)!;
                return (
                  <polyline
                    key={`ld-${l.node.id}`}
                    points={l.leader}
                    className={`ct-leader ct-leader--${l.tree} ct-leader--${st.state}${hovered === l.node.id ? ' ct-leader--hover' : ''}`}
                  />
                );
              })}
              {LAYOUT.nodes.map((l) => {
                const st = statuses.get(l.node.id)!;
                return (
                  <circle
                    key={`nd-${l.node.id}`}
                    cx={l.cx}
                    cy={l.cy}
                    r={l.r}
                    className={`ct-node ct-node--${l.tree} ct-node--${st.state}${l.isRoot ? ' ct-node--root' : ''}${st.purchasable ? ' ct-node--ready' : ''}${hovered === l.node.id ? ' ct-node--hover' : ''}`}
                    onMouseEnter={() => setHovered(l.node.id)}
                    onMouseLeave={() => setHovered(null)}
                  />
                );
              })}
            </svg>
            {LAYOUT.nodes.map((l) => (
              <LabelCard key={`card-${l.node.id}`} l={l} status={statuses.get(l.node.id)!} hovered={hovered === l.node.id} onHover={setHovered} />
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function CombatTree() {
  const show = useUIStore((s) => s.showCombatTree);
  if (!show) return null;
  return <CombatTreeInner />;
}
