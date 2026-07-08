import { useEffect, useState } from 'react';
import { useQuestStore } from '../store/questStore';
import { QUESTS } from '../game/quests';
import './InfoPanel.css';

type SubviewKey = 'origins' | 'star-types' | 'phenomena' | 'species' | 'quests' | 'artifacts';

interface StarTypeEntry {
  key: string;
  desc: string;
  temp: string;
  color: string;
  mass: string;
  lifetime: string;
  abundance: string;
  lore: string;
  notes?: string[];
}

const SUBVIEWS: { key: SubviewKey; label: string; icon: string }[] = [
  { key: 'quests',     label: 'Quests',   icon: '◉' },
  { key: 'origins',    label: 'Origins',  icon: '◎' },
  { key: 'star-types', label: 'Stars',    icon: '★' },
  { key: 'phenomena',  label: 'Phenom',   icon: '⌬' },
  { key: 'species',    label: 'Species',  icon: '⬡' },
  { key: 'artifacts',  label: 'Artifacts',icon: '⌖' },
];

const STAR_TYPES: StarTypeEntry[] = [
  {
    key: 'A',
    desc: 'White',
    temp: '7.5-10k K',
    color: '#e8eeff',
    mass: '1.4-2.1 M☉',
    lifetime: '1-2 Gyr',
    abundance: 'Uncommon',
    lore: 'Hot, rapidly rotating white stars defined by strong hydrogen absorption lines. Short lifespans compress the window for complex planetary evolution.',
  },
  {
    key: 'F',
    desc: 'Yellow-White',
    temp: '6-7.5k K',
    color: '#fff8dd',
    mass: '1.0-1.4 M☉',
    lifetime: '2-7 Gyr',
    abundance: 'Common',
    lore: 'Slightly more luminous than solar-type stars with elevated UV output. The higher radiation flux may accelerate biological mutation — or sterilize worlds entirely.',
  },
  {
    key: 'G',
    desc: 'Yellow Dwarf',
    temp: '5.2-6k K',
    color: '#ffe566',
    mass: '0.8-1.1 M☉',
    lifetime: '8-12 Gyr',
    abundance: 'Common',
    lore: 'The archetype of stable, habitable-zone stars. Long-lived and consistent across their main sequence — the most surveyed class for life-bearing worlds.',
  },
  {
    key: 'K',
    desc: 'Orange Dwarf',
    temp: '3.7-5.2k K',
    color: '#ffaa44',
    mass: '0.45-0.8 M☉',
    lifetime: '15-30 Gyr',
    abundance: 'Common',
    lore: 'Low UV flux, extreme longevity, and minimal flare activity. K-dwarfs are increasingly regarded as optimal hosts for advanced, long-lived civilizations.',
  },
  {
    key: 'M',
    desc: 'Red Dwarf',
    temp: '2.4-3.7k K',
    color: '#ff6644',
    mass: '0.08-0.45 M☉',
    lifetime: '>100 Gyr',
    abundance: 'Abundant',
    lore: 'The most common stellar class — over 70% of all stars. Trillion-year lifespans, but intense UV flares and tidal locking of the habitable zone impose severe constraints on surface life.',
  },
  {
    key: 'L',
    desc: 'Brown Dwarf',
    temp: '1.3-2.1k K',
    color: '#995533',
    mass: '13-80 MJ',
    lifetime: 'Indefinite',
    abundance: 'Rare',
    lore: 'Failed stars — objects with enough mass to briefly fuse deuterium, but never sufficient to sustain hydrogen burning. They are not truly stars, nor planets. They cool indefinitely: after billions of years their outer atmospheres layer with iron vapor, silicate dust, and clouds of liquid iron droplets that rain downward through pressure gradients of extreme depth. They emit no visible light — only a dim infrared glow detectable only by spectroscopic survey. Found at the galactic fringe, drifting alone beyond the reach of stellar nurseries, they are among the oldest and coldest objects in the galaxy.\n\nSurveys have confirmed that exotic matter deposits occur exclusively in brown dwarf systems on the galactic rim. Current theory attributes this to the extreme pressure gradients within their sub-stellar cores and the absence of stellar wind — conditions found nowhere else. The mechanism by which exotic matter concentrates in these systems remains unknown.',
    notes: [
      'Invisible to naked-eye observation — infrared only',
      'Atmospheres stratified with iron cloud decks and silicate rain',
      'Surface gravity 10-100x Earth despite sub-stellar mass',
      'Sole known source of exotic matter in the galaxy',
    ],
  },
  {
    key: 'N',
    desc: 'Neutron Star',
    temp: '600k-1M K',
    color: '#aae8ff',
    mass: '1.4-2.1 M☉',
    lifetime: '>10 Gyr (cooling)',
    abundance: 'Very Rare',
    lore: 'The collapsed remnant of a massive star following a core-collapse supernova. When a star exceeding 8 solar masses exhausts its nuclear fuel, the core implodes in milliseconds — the outer layers rebound in a catastrophic explosion, leaving behind an object roughly 20 kilometers in diameter that contains more mass than the Sun.\n\nNeutron star matter is compressed beyond atomic limits: electrons are forced into protons, producing a dense fluid of neutrons packed so tightly that a single teaspoon would mass approximately one billion tonnes. Their surfaces spin hundreds of times per second; focused electromagnetic radiation escapes the magnetic poles as sweeping pulsar beams detectable across the galaxy.\n\nThe inner orbital zones of neutron star systems are subject to intense radiation flux and gravitational gradients that preclude standard extraction operations. Surveys have confirmed that neutron star matter deposits form in these zones through exotic nucleosynthesis processes unique to post-supernova environments. Accessing them requires logistics systems hardened for high-gravity, high-radiation conditions — only the most advanced extraction networks can operate safely within their reach.',
    notes: [
      'Diameter ~20 km — smaller than most cities',
      'Surface gravity 200 billion times Earth standard',
      'Magnetic field 10⁸-10¹⁵ Tesla; pulsar rotation up to 716 Hz',
      'Sole known source of neutron star matter deposits',
    ],
  },
];

function OriginsView() {
  return (
    <>
      <div className="info-section">
        <div className="info-section-title">First Principles</div>
        <div className="info-lore">
          <p>
            Miguel Alcubierre published the geometry in 1994 CE. Three centuries later, survey probes found exotic matter condensing in Neptune's upper atmosphere, and the theory
            became a drive. No one thought to ask whether a warp transit could be seen from far away, or what might be watching for exactly that.
          </p>
          <p>
            The axioms, in retrospect, are inescapable. Resources are finite, and every civilization needs them. Any species that can cross between stars can destroy whatever it
            finds when it arrives. The rational response to detecting another civilization is therefore not contact but annihilation, before it reaches the same conclusion.
            The galaxy is quiet the way a forest at night is quiet: not empty, but full of things that have learned to keep still.
          </p>
          <p>
            An object appeared near Venus, flickered in and out of a warp bubble for several hours, and vanished; the observatories that saw it logged an equipment anomaly and
            moved on. Earth outlived it by a few minutes. The survivors call the weapon an Alcubierre Cannon: a warp bubble that gathers particles against its leading edge and
            blueshifts them into a wave that atomizes whatever waits at the destination.
          </p>
          <p>
            The drive was a strategic asset before it was proven safe. The United Nations and the Pacific Compact, heirs to a rivalry centuries old, raced to militarize it, each
            certain the other would not stop at survey ships. You were in orbit, in command of the UNSS Peregrine, an armed cruiser crewed by the minds that built her. Her
            manifest holds 873 names, and as far as any instrument can determine, that manifest is now the complete census of the human race. There is nothing to return to and
            no safe way to call out; there is only the dark, and the hope that whatever lives in it considers 873 people too small to be worth finishing.
          </p>
        </div>
      </div>
      <div className="info-section">
        <div className="info-section-title">Threat Assessment</div>
        <div className="info-stat-row">
          <span className="info-stat-label">Universe Age</span>
          <span className="info-stat-value">13.8 Gyr</span>
        </div>
        <div className="info-stat-row">
          <span className="info-stat-label">Civilizations Confirmed</span>
          <span className="info-stat-value">1 (destroyed)</span>
        </div>
        <div className="info-stat-row">
          <span className="info-stat-label">Active Transmissions</span>
          <span className="info-stat-value">0 — maintain</span>
        </div>
        <div className="info-stat-row">
          <span className="info-stat-label">Known Hunters</span>
          <span className="info-stat-value">unknown</span>
        </div>
      </div>
    </>
  );
}

function StarTypesView() {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="info-section">
      <div className="info-section-title">Spectral Classification</div>
      {STAR_TYPES.map((s) => {
        const isOpen = expanded === s.key;
        return (
          <div key={s.key} className={`info-star-row${isOpen ? ' info-star-row--open' : ''}`} onClick={() => setExpanded(isOpen ? null : s.key)}>
            <div className="info-star-row-header">
              <div className="info-table-dot" style={{ background: s.color, boxShadow: `0 0 5px ${s.color}88` }} />
              <span className="info-table-key">{s.key}</span>
              <span className="info-table-desc">{s.desc}</span>
              <span className="info-table-temp">{s.temp}</span>
              <span className="info-star-chevron">{isOpen ? '▲' : '▼'}</span>
            </div>
            {isOpen && (
              <div className="info-star-detail">
                <p className="info-star-lore">{s.lore}</p>
                <div className="info-star-stats">
                  <div className="info-stat-row">
                    <span className="info-stat-label">Mass</span>
                    <span className="info-stat-value">{s.mass}</span>
                  </div>
                  <div className="info-stat-row">
                    <span className="info-stat-label">Lifetime</span>
                    <span className="info-stat-value">{s.lifetime}</span>
                  </div>
                  <div className="info-stat-row">
                    <span className="info-stat-label">Abundance</span>
                    <span className="info-stat-value">{s.abundance}</span>
                  </div>
                </div>
                {'notes' in s && s.notes && (
                  <div className="info-star-notes">
                    <div className="info-star-notes-title">Survey Notes</div>
                    {s.notes.map((n, i) => (
                      <div key={i} className="info-star-note">— {n}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PhenomenaView() {
  return (
    <>
      <div className="info-section">
        <div className="info-section-title">Anomaly Register</div>
        <div className="info-empty">No anomalies catalogued</div>
      </div>
      <div className="info-section">
        <div className="info-section-title">Notable Observations</div>
        <div className="info-stat-row">
          <span className="info-stat-label">Pulsars Detected</span>
          <span className="info-stat-value">0</span>
        </div>
        <div className="info-stat-row">
          <span className="info-stat-label">Black Holes Mapped</span>
          <span className="info-stat-value">0</span>
        </div>
        <div className="info-stat-row">
          <span className="info-stat-label">Nebulae Surveyed</span>
          <span className="info-stat-value">0</span>
        </div>
      </div>
    </>
  );
}

function SpeciesView() {
  return (
    <div className="info-section">
      <div className="info-section-title">Encountered Entities</div>
      <div className="info-empty">No life forms encountered</div>
    </div>
  );
}

function QuestsView() {
  const completed = useQuestStore((s) => s.completed);
  const active = QUESTS.filter((q) => !completed[q.id]);
  const done = QUESTS.filter((q) => completed[q.id]);

  return (
    <div className="info-section">
      <div className="info-section-title">Mission Objectives</div>
      {active.map((q) => (
        <div key={q.id} className="info-quest-entry">
          <div className="info-quest-title">{q.title}</div>
          <div className="info-quest-desc">{q.description}</div>
        </div>
      ))}
      {done.length > 0 && (
        <>
          <div className="info-section-title info-section-title--completed">Completed</div>
          {done.map((q) => (
            <div key={q.id} className="info-quest-entry info-quest-entry--done">
              <div className="info-quest-title"><span className="info-quest-check">✓</span> {q.title}</div>
              <div className="info-quest-desc">{q.description}</div>
            </div>
          ))}
        </>
      )}
      {active.length === 0 && done.length === 0 && (
        <div className="info-empty">No objectives assigned</div>
      )}
    </div>
  );
}

function ArtifactsView() {
  return (
    <div className="info-section">
      <div className="info-section-title">Recovered Artifacts</div>
      <div className="info-empty">No artifacts recovered</div>
    </div>
  );
}

function SubviewContent({ subview }: { subview: SubviewKey }) {
  switch (subview) {
    case 'origins':    return <OriginsView />;
    case 'star-types': return <StarTypesView />;
    case 'phenomena':  return <PhenomenaView />;
    case 'species':    return <SpeciesView />;
    case 'quests':     return <QuestsView />;
    case 'artifacts':  return <ArtifactsView />;
  }
}

export function InfoPanel({ onOpenChange, openRequest }: { onOpenChange: (open: boolean) => void; openRequest?: number }) {
  const [open, setOpen] = useState(false);
  const [activeSubview, setActiveSubview] = useState<SubviewKey>('origins');

  useEffect(() => {
    if (openRequest) {
      setOpen(true);
      setActiveSubview('origins');
      onOpenChange(true);
    }
  }, [openRequest, onOpenChange]);

  function toggle() {
    const next = !open;
    setOpen(next);
    onOpenChange(next);
  }

  return (
    <div className="info-panel-wrap">
      {open && (
        <div className="info-panel">
          <div className="info-panel-header">Galactic Archive</div>
          <div className="info-subview-btns">
            {SUBVIEWS.map((sv) => (
              <button
                key={sv.key}
                className={`info-subview-btn${activeSubview === sv.key ? ' info-subview-btn--active' : ''}`}
                onClick={() => setActiveSubview(sv.key)}
              >
                <span className="info-subview-icon">{sv.icon}</span>
                <span className="info-subview-label">{sv.label}</span>
              </button>
            ))}
          </div>
          <div className="info-panel-content">
            <SubviewContent subview={activeSubview} />
          </div>
        </div>
      )}
      <button className="info-tab" onClick={toggle} aria-label="Toggle archive panel">
        <svg className="info-tab-outline" viewBox="0 0 1 1" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
          <polygon
            vectorEffect="non-scaling-stroke"
            points="0,0 1,0.15 1,0.85 0,1"
            fill="transparent"
            stroke="rgba(0, 190, 230, 0.55)"
            strokeWidth="1"
          />
        </svg>
        <span className="info-tab-label">{open ? 'close' : 'log'}</span>
      </button>
    </div>
  );
}
