import { useEffect, useState, type ReactNode } from 'react';
import {
  baseAlloyCapacity,
  baseCondensateCapacity,
  alloyRate,
  buildersBusy,
  crewUsed,
  hangarUsed,
  placeDefence as planPlaceDefence,
  populationCapacity,
  queueShip as planQueueShip,
  shipCost,
  siphonRate,
  upgradeBuilding as planUpgradeBuilding,
  upgradeDefence as planUpgradeDefence,
  type Base,
  type Outcome,
} from '../game/base';
import {
  builderSlots,
  BUILDING_KINDS,
  buildingCost,
  BUILDINGS,
  hangarCapacity,
  platformLimit,
  type BuildingKind,
  type LevelCost,
} from '../game/baseBuildings';
import { BASE_MAX_LEVEL, DEFENCE_ORBIT_SLOTS } from '../game/constants';
import {
  DEFENCE_KINDS,
  defenceCost,
  defenceStats,
  DEFENCES,
  ORBIT_NAMES,
  platformAt,
  type DefenceKind,
  type Platform,
  type SlotRef,
} from '../game/defences';
import { isDocked } from '../game/fuel';
import { SHIP_CLASSES, SHIPS, type ShipClass } from '../game/ships';
import { locateSupercluster } from '../game/universe';
import { formatDuration, useBase } from '../hooks/useBase';
import { ApiError } from '../net/api';
import { collectCondensate, moveDefence, placeDefence, queueShip, upgradeBuilding, upgradeDefence } from '../net/base';
import { useBaseStore, type BaseTab } from '../store/baseStore';
import { useFuelStore } from '../store/fuelStore';
import { useTechStore } from '../store/techStore';
import './BasePanel.css';

const TABS: { id: BaseTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'buildings', label: 'Buildings' },
  { id: 'shipyard', label: 'Shipyard' },
  { id: 'defences', label: 'Defences' },
];

const NUMERALS = ['0', 'I', 'II', 'III', 'IV', 'V'];

const DEFENCE_GLYPHS: Record<DefenceKind, string> = { pointDefence: '✦', missile: '◆', railgun: '▲', shield: '⬡' };

function whole(value: number): string {
  return Math.floor(value).toLocaleString('en-US');
}

function refusalOf(outcome: Outcome): string | null {
  return outcome.ok ? null : outcome.refusal.message;
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (call: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    call()
      .catch((err) => setError(err instanceof ApiError ? err.message : 'The order could not be given'))
      .finally(() => setBusy(false));
  };
  return { busy, error, run };
}

function Cost({ cost }: { cost: LevelCost }) {
  return (
    <div className="base-cost">
      <span>{whole(cost.alloys)} alloys</span>
      {cost.technology > 0 && <span>{cost.technology} advanced technology</span>}
      {cost.crew > 0 && <span>{cost.crew} crew</span>}
      <span>{formatDuration(cost.seconds * 1000)}</span>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="base-stat">
      <div className="base-stat-label">{label}</div>
      <div className="base-stat-value">{value}</div>
      {sub && <div className="base-stat-sub">{sub}</div>}
    </div>
  );
}

function Overview({ base, now }: { base: Base; now: number }) {
  const ship = useFuelStore((s) => s.ship);
  const home = locateSupercluster(base.superclusterSeed);
  const docked = ship !== null && home !== null && isDocked(ship, home);
  const { busy, error, run } = useAction();
  const [collected, setCollected] = useState<number | null>(null);
  const building = BUILDING_KINDS.filter((kind) => base.buildings[kind].readyAt !== null);
  const platforms = base.defences.filter((platform) => platform.readyAt !== null);

  const collect = () => run(async () => setCollected(await collectCondensate()));

  return (
    <div className="base-overview">
      <div className="base-stats">
        <Stat label="Alloys" value={`${whole(base.alloys)} / ${whole(baseAlloyCapacity(base))}`} sub={`+${whole(alloyRate(base))} per hour`} />
        <Stat
          label="Negative-energy condensate"
          value={`${base.condensate.toFixed(1)} / ${baseCondensateCapacity(base)}`}
          sub={`+${siphonRate(base).toFixed(1)} per hour`}
        />
        <Stat label="Population" value={`${whole(base.population)} / ${populationCapacity(base)}`} sub={`World carries ${base.quality.populationCap}`} />
        <Stat label="Crew assigned" value={`${crewUsed(base)} / ${whole(base.population)}`} />
        <Stat label="Construction crews" value={`${buildersBusy(base)} / ${builderSlots(base.buildings.command.level)} busy`} />
        <Stat label="Hangar" value={`${hangarUsed(base)} / ${hangarCapacity(base.buildings.hangar.level)} hull units`} />
      </div>

      <section className="base-section">
        <div className="base-section-title">Collect</div>
        <p className="base-note">
          Negative-energy condensate from the siphon waits in the vault until the ship docks at {base.superclusterName} to take it aboard.
        </p>
        <button type="button" className="base-action" disabled={!docked || busy || base.condensate < 0.1} onClick={collect}>
          {docked ? busy ? 'Transferring…' : 'Transfer to ship' : `Dock at ${base.superclusterName} to collect`}
        </button>
        {collected !== null && <div className="base-note">{collected.toFixed(1)} negative-energy condensate taken aboard.</div>}
        {error && <div className="base-error" role="alert">{error}</div>}
      </section>

      <section className="base-section">
        <div className="base-section-title">Under construction</div>
        {building.length === 0 && platforms.length === 0 && base.shipQueue.length === 0 && <p className="base-note">Nothing is being built.</p>}
        <ul className="base-list">
          {building.map((kind) => (
            <li key={kind}>
              <span>{BUILDINGS[kind].name} {NUMERALS[base.buildings[kind].level + 1]}</span>
              <span>{formatDuration(base.buildings[kind].readyAt! - now)}</span>
            </li>
          ))}
          {platforms.map((platform) => (
            <li key={`${platform.orbit}-${platform.slot}`}>
              <span>{DEFENCES[platform.kind].name} {NUMERALS[platform.level + 1]}</span>
              <span>{formatDuration(platform.readyAt! - now)}</span>
            </li>
          ))}
          {base.shipQueue.map((queued, i) => (
            <li key={i}>
              <span>{SHIPS[queued.shipClass].name}</span>
              <span>{formatDuration(queued.readyAt - now)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="base-section">
        <div className="base-section-title">Fleet</div>
        <ul className="base-list">
          {SHIP_CLASSES.map((shipClass) => (
            <li key={shipClass}><span>{SHIPS[shipClass].name}s</span><span>{base.fleet[shipClass]}</span></li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function effectLine(base: Base, kind: BuildingKind): string {
  const level = base.buildings[kind].level;
  const next = Math.min(level + 1, BASE_MAX_LEVEL);
  switch (kind) {
    case 'command':
      return `Crews ${builderSlots(level)} → ${builderSlots(next)} · Platforms ${platformLimit(level)} → ${platformLimit(next)}`;
    case 'refinery':
      return `Alloys ${base.quality.alloyRate * level} → ${base.quality.alloyRate * next} per hour`;
    case 'siphon':
      return `Condensate ${(base.quality.siphonRate * level).toFixed(1)} → ${(base.quality.siphonRate * next).toFixed(1)} per hour`;
    case 'vault':
      return 'Holds more alloys and negative-energy condensate';
    case 'habitat':
      return `Room for more people, up to the world's ${base.quality.populationCap}`;
    case 'shipyard':
      return next >= 4 ? 'Cruisers from level IV' : next >= 2 ? 'Destroyers from level II' : 'Corvettes from level I';
    case 'hangar':
      return `${hangarCapacity(level)} → ${hangarCapacity(next)} hull units`;
  }
}

function BuildingCard({ base, kind, technology, now }: { base: Base; kind: BuildingKind; technology: number; now: number }) {
  const { busy, error, run } = useAction();
  const construction = base.buildings[kind];
  const cost = buildingCost(kind, construction.level);
  const refusal = refusalOf(planUpgradeBuilding(base, kind, technology, now));
  return (
    <div className="base-card">
      <div className="base-card-head">
        <span className="base-card-name">{BUILDINGS[kind].name}</span>
        <span className="base-card-level">{NUMERALS[construction.level]}</span>
      </div>
      <p className="base-card-blurb">{BUILDINGS[kind].blurb}</p>
      {cost && <div className="base-card-effect">{effectLine(base, kind)}</div>}
      {construction.readyAt !== null ? (
        <div className="base-card-status">Building {NUMERALS[construction.level + 1]} · {formatDuration(construction.readyAt - now)}</div>
      ) : cost ? (
        <>
          <Cost cost={cost} />
          <button type="button" className="base-action" disabled={refusal !== null || busy} onClick={() => run(() => upgradeBuilding(kind))}>
            {busy ? 'Ordering…' : refusal ?? `Build ${NUMERALS[construction.level + 1]}`}
          </button>
        </>
      ) : (
        <div className="base-card-status">Fully built</div>
      )}
      {error && <div className="base-error" role="alert">{error}</div>}
    </div>
  );
}

function Buildings({ base, technology, now }: { base: Base; technology: number; now: number }) {
  return (
    <div className="base-grid">
      {BUILDING_KINDS.map((kind) => <BuildingCard key={kind} base={base} kind={kind} technology={technology} now={now} />)}
    </div>
  );
}

function ShipCard({ base, shipClass, technology, now }: { base: Base; shipClass: ShipClass; technology: number; now: number }) {
  const { busy, error, run } = useAction();
  const spec = SHIPS[shipClass];
  const refusal = refusalOf(planQueueShip(base, shipClass, technology, now));
  return (
    <div className="base-card">
      <div className="base-card-head">
        <span className="base-card-name">{spec.name}</span>
        <span className="base-card-level">{base.fleet[shipClass]}</span>
      </div>
      <p className="base-card-blurb">{spec.blurb}</p>
      <dl className="base-ship-stats">
        <dt>Hull</dt><dd>{spec.hull}</dd>
        <dt>Damage</dt><dd>{spec.damage}</dd>
        <dt>Range</dt><dd>{spec.range}</dd>
        <dt>Speed</dt><dd>{spec.speed}</dd>
        <dt>Hull units</dt><dd>{spec.hullUnits}</dd>
      </dl>
      <Cost cost={shipCost(shipClass)} />
      <button type="button" className="base-action" disabled={refusal !== null || busy} onClick={() => run(() => queueShip(shipClass))}>
        {busy ? 'Ordering…' : refusal ?? 'Lay down hull'}
      </button>
      {error && <div className="base-error" role="alert">{error}</div>}
    </div>
  );
}

function Shipyard({ base, technology, now }: { base: Base; technology: number; now: number }) {
  return (
    <>
      <div className="base-grid base-grid--three">
        {SHIP_CLASSES.map((shipClass) => <ShipCard key={shipClass} base={base} shipClass={shipClass} technology={technology} now={now} />)}
      </div>
      <section className="base-section">
        <div className="base-section-title">
          Queue · {base.shipQueue.length} / {base.buildings.shipyard.level} · Hangar {hangarUsed(base)} / {hangarCapacity(base.buildings.hangar.level)}
        </div>
        {base.shipQueue.length === 0 && <p className="base-note">The slipways are empty.</p>}
        <ul className="base-list">
          {base.shipQueue.map((queued, i) => (
            <li key={i}><span>{SHIPS[queued.shipClass].name}</span><span>{formatDuration(queued.readyAt - now)}</span></li>
          ))}
        </ul>
      </section>
    </>
  );
}

const ORBIT_RADII = [30, 40, 48];

function slotPosition({ orbit, slot }: SlotRef): { x: number; y: number } {
  const angle = (slot / DEFENCE_ORBIT_SLOTS[orbit]) * Math.PI * 2 - Math.PI / 2 + orbit * 0.3;
  return { x: 50 + ORBIT_RADII[orbit] * Math.cos(angle), y: 50 + ORBIT_RADII[orbit] * Math.sin(angle) };
}

function sameSlot(a: SlotRef | null, b: SlotRef): boolean {
  return a !== null && a.orbit === b.orbit && a.slot === b.slot;
}

function PlatformDetail({ base, platform, technology, now, moving, onMove }: {
  base: Base;
  platform: Platform;
  technology: number;
  now: number;
  moving: boolean;
  onMove: () => void;
}) {
  const { busy, error, run } = useAction();
  const stats = defenceStats(platform.kind, Math.max(1, platform.level));
  const cost = defenceCost(platform.kind, platform.level);
  const refusal = refusalOf(planUpgradeDefence(base, platform, technology, now));
  return (
    <div className="base-defence-detail">
      <div className="base-card-head">
        <span className="base-card-name">{DEFENCES[platform.kind].name}</span>
        <span className="base-card-level">{NUMERALS[platform.level]}</span>
      </div>
      <div className="base-note">{ORBIT_NAMES[platform.orbit]}, slot {platform.slot + 1}</div>
      <p className="base-card-blurb">{DEFENCES[platform.kind].blurb}</p>
      <dl className="base-ship-stats">
        <dt>Hull</dt><dd>{stats.hull}</dd>
        {stats.damage > 0 && <><dt>Damage</dt><dd>{stats.damage}</dd></>}
        {stats.range > 0 && <><dt>Range</dt><dd>{stats.range}</dd></>}
        {stats.shield > 0 && <><dt>Shield</dt><dd>{stats.shield}</dd></>}
      </dl>
      {platform.readyAt !== null ? (
        <div className="base-card-status">Building {NUMERALS[platform.level + 1]} · {formatDuration(platform.readyAt - now)}</div>
      ) : (
        <>
          {cost && <Cost cost={cost} />}
          {cost && (
            <button type="button" className="base-action" disabled={refusal !== null || busy} onClick={() => run(() => upgradeDefence(platform))}>
              {busy ? 'Ordering…' : refusal ?? `Upgrade to ${NUMERALS[platform.level + 1]}`}
            </button>
          )}
          <button type="button" className={`base-action base-action--quiet${moving ? ' base-action--active' : ''}`} onClick={onMove}>
            {moving ? 'Choose an empty slot…' : 'Move platform'}
          </button>
        </>
      )}
      {error && <div className="base-error" role="alert">{error}</div>}
    </div>
  );
}

function SlotDetail({ base, slot, technology, now }: { base: Base; slot: SlotRef; technology: number; now: number }) {
  const { busy, error, run } = useAction();
  return (
    <div className="base-defence-detail">
      <div className="base-card-name">{ORBIT_NAMES[slot.orbit]}, slot {slot.slot + 1}</div>
      <div className="base-note">{base.defences.length} / {platformLimit(base.buildings.command.level)} platforms</div>
      {DEFENCE_KINDS.map((kind) => {
        const refusal = refusalOf(planPlaceDefence(base, slot, kind, technology, now));
        return (
          <div key={kind} className="base-defence-option">
            <div className="base-card-head">
              <span className="base-card-name">{DEFENCE_GLYPHS[kind]} {DEFENCES[kind].name}</span>
            </div>
            <Cost cost={defenceCost(kind, 0)!} />
            <button type="button" className="base-action" disabled={refusal !== null || busy} onClick={() => run(() => placeDefence(slot, kind))}>
              {refusal ?? 'Place'}
            </button>
          </div>
        );
      })}
      {error && <div className="base-error" role="alert">{error}</div>}
    </div>
  );
}

function Defences({ base, technology, now }: { base: Base; technology: number; now: number }) {
  const [selected, setSelected] = useState<SlotRef | null>(null);
  const [moving, setMoving] = useState(false);
  const { error, run } = useAction();
  const selectedPlatform = selected ? platformAt(base.defences, selected) : undefined;

  const pick = (slot: SlotRef) => {
    const occupant = platformAt(base.defences, slot);
    if (moving && selected && selectedPlatform && !occupant) {
      const from = selected;
      setMoving(false);
      setSelected(slot);
      run(() => moveDefence(from, slot));
      return;
    }
    setMoving(false);
    setSelected(sameSlot(selected, slot) ? null : slot);
  };

  return (
    <div className="base-defences">
      <svg className="base-orbits" viewBox="0 0 100 100" role="group" aria-label="Orbital defence layout">
        <circle className="base-orbit-world" cx="50" cy="50" r="13" />
        <text className="base-orbit-world-label" x="50" y="51.5">{base.planetName}</text>
        {ORBIT_RADII.map((r, orbit) => <circle key={orbit} className="base-orbit-ring" cx="50" cy="50" r={r} />)}
        {DEFENCE_ORBIT_SLOTS.flatMap((count, orbit) => Array.from({ length: count }, (_, slot) => {
          const ref = { orbit, slot };
          const { x, y } = slotPosition(ref);
          const platform = platformAt(base.defences, ref);
          const classes = [
            'base-slot',
            platform ? `base-slot--${platform.kind}` : 'base-slot--empty',
            platform && platform.readyAt !== null ? 'base-slot--building' : '',
            sameSlot(selected, ref) ? 'base-slot--selected' : '',
            moving && !platform ? 'base-slot--target' : '',
          ].filter(Boolean).join(' ');
          return (
            <g key={`${orbit}-${slot}`} className={classes} onClick={() => pick(ref)} role="button" aria-label={`${ORBIT_NAMES[orbit]} slot ${slot + 1}`}>
              <circle cx={x} cy={y} r="3.2" />
              {platform && <text x={x} y={y + 1.1}>{DEFENCE_GLYPHS[platform.kind]}</text>}
            </g>
          );
        }))}
      </svg>
      <div className="base-defence-side">
        {selected === null && (
          <div className="base-defence-detail">
            <div className="base-card-name">Orbital layout</div>
            <p className="base-card-blurb">
              Platforms hold three orbits around {base.planetName}. Select an empty slot to place one, or a platform to upgrade or move it.
              Moving a finished platform costs nothing, so the layout can change as often as you like.
            </p>
            <div className="base-note">{base.defences.length} / {platformLimit(base.buildings.command.level)} platforms</div>
          </div>
        )}
        {selected && selectedPlatform && (
          <PlatformDetail
            key={`${selected.orbit}-${selected.slot}`}
            base={base} platform={selectedPlatform} technology={technology} now={now}
            moving={moving} onMove={() => setMoving(!moving)}
          />
        )}
        {selected && !selectedPlatform && <SlotDetail key={`${selected.orbit}-${selected.slot}`} base={base} slot={selected} technology={technology} now={now} />}
        {error && <div className="base-error" role="alert">{error}</div>}
      </div>
    </div>
  );
}

export function BaseButton() {
  const hasBase = useBaseStore((s) => s.base !== null);
  if (!hasBase) return null;
  return (
    <button type="button" className="hud-anomaly hud-base-btn" onClick={() => useBaseStore.getState().setOpen(true)}>
      ⌂ Base
    </button>
  );
}

export function BasePanel() {
  const open = useBaseStore((s) => s.open);
  const tab = useBaseStore((s) => s.tab);
  const setOpen = useBaseStore((s) => s.setOpen);
  const setTab = useBaseStore((s) => s.setTab);
  const technology = useTechStore((s) => s.technology);
  const live = useBase();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open || !live) return null;
  const { base, now } = live;

  return (
    <div className="base-overlay" role="dialog" aria-modal="true" aria-label="Base" onClick={() => setOpen(false)}>
      <div className="base-panel" onClick={(event) => event.stopPropagation()}>
        <header className="base-header">
          <div>
            <div className="base-title">{base.planetName}</div>
            <div className="base-subtitle">{base.systemName} · {base.galaxyName} · {base.superclusterName}</div>
          </div>
          <div className="base-balance">
            <span className="base-balance-value">{whole(base.alloys)}</span>
            <span className="base-balance-label">Alloys</span>
            <span className="base-balance-value">{technology}</span>
            <span className="base-balance-label">Advanced technology</span>
          </div>
          <button type="button" className="base-close" onClick={() => setOpen(false)} aria-label="Close base">✕</button>
        </header>
        <nav className="base-tabs">
          {TABS.map(({ id, label }) => (
            <button key={id} type="button" className={`base-tab${tab === id ? ' base-tab--active' : ''}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="base-body">
          {tab === 'overview' && <Overview base={base} now={now} />}
          {tab === 'buildings' && <Buildings base={base} technology={technology} now={now} />}
          {tab === 'shipyard' && <Shipyard base={base} technology={technology} now={now} />}
          {tab === 'defences' && <Defences base={base} technology={technology} now={now} />}
        </div>
      </div>
    </div>
  );
}
