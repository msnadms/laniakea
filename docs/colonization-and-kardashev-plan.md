# Colonization, Probes, and the Kardashev Ladder

## Goal

Give the crafting tree a terminus. Rare assemblies currently accumulate in `stockpileStore.rares`
and are never consumed by anything, so the deepest production chains in the game pay out into a
number that only goes up. This plan turns that terminus into the game's second half: the
Peregrine stops being a scavenger and becomes the seed of a civilization, and the detection meter
stops being an abstract penalty and becomes that civilization's opposition.

The intended arc is:

- turn rare assemblies into complete colony charters rather than another inventory counter;
- keep those colonies supplied and defended against a hostile automated census;
- reach the point where colonies sustain and spread humanity on their own;
- climb from planetary to stellar to galactic scale;
- decide what a Type III humanity does with the weapon that killed Earth.

The intended challenge is not accumulation. Every gate below is a logistics gate: something must
be delivered, repeatedly, to a place that dies without it.

## Fiction

Established in `BootSequence.tsx` and `InfoPanel.tsx` (OriginsView), and unchanged by this plan:
Alcubierre drives in 2077 CE, Earth atomized in 2087 CE, 23 billion dead, the Peregrine's manifest
of 873 names as the whole of the human race. The axiom the survivors infer is that any
civilization capable of interstellar travel is capable of destroying what it finds, so the
rational response to detecting one is annihilation.

This plan adds two facts.

**Civilizations are found by warp-equipped Von Neumann probes.** The object that flickered near
Venus was not a warship, it was a census. Probes self-replicate, they are drawn to warp
signatures, and they are how the axiom is enforced at galactic range. A probe that observes you
and leaves has already killed you; the Cannon only arrives later.

**The Peregrine was provisioned for colonization.** The biological seed stock is part of the
settlement hardware rather than a separate resource. An Ectogenesis Bank abstracts the material
and clinical systems needed to establish a population, keeping the game focused on logistics.

## Current state

Findings from the existing code that this plan builds on rather than replaces.

**The railgun is already a probe-killer.** `uiStore.tickRailgunSuppression` fires on a 30-second
cooldown (`FIRE_COOLDOWN_MS`), spends 5 ammo per shot (`FIRE_COST`), and removes one bar of heat
per shot (`DETENT_PER_SHOT`). `reloadRailgun` buys ammo at 3 helium-3 each
(`RELOAD_HELIUM_PER_AMMO`) up to `computeWeaponCap` — 20 base, 140 at full weapon tiers. The
mechanic exists and is unthemed. It needs a fiction, not a rewrite.

**Detection already prices traffic concentration, not distance.** `routeDetectionRisk` is
`Σ over superclusters m(m-1)/DETECTION_DENSITY_DIVISOR` plus `DETECTION_CROSSING_POINTS` per
crossing edge. Under a probe fiction that stops being an abstraction: repeated warp signatures in
one region attract replicating probes, and a single long jump to a fresh supercluster does not.
The math already tells the story; only the labels change.

**Heat already decays and is already lethal.** `detectionHeat` decays one bar per two minutes,
`detectionRatingFromHeat` clamps at 5, and `checkDetectionLethal` calls `beginDeathSequence` at 5.
`purgeDetection` is a six-hour-cooldown emergency scrub costing 300 exotic and 200 helium scaled
by drive tier.

**Rares are terminal.** `stockpileStore.rares` is written by `receiveFabricatorItems`, rendered in
`MaterialsPanel`, persisted by `firebase/stockpile.ts`, and read by nothing else.

**Fabricators already have the upgrade-in-place pattern.** `PlanetPanel.handleSettle` places a
tier-1 fabricator on a habitable planet; `handleUpgradeFabricator` pays `FABRICATOR_UPGRADE_COST`
plus `FABRICATOR_UPGRADE_MATERIALS` to reach tier 2. A third rung on that ladder is a known shape.

**The map already collapses entities into node types.** `logisticsProject.ts` has
`NodeType = 'extractor' | 'fabricator'` with one node per system per kind, and `resolveNodeGroups`
maps node ids back to entities. Colonies are a third kind.

## Design

### Two meters, not one

Split detection into a recoverable meter and a permanent one, because self-replicating probes give
you the distinction for free.

`detectionHeat` (existing) becomes **probe attention**: how many probes are converging on your
signatures right now. It decays, the railgun suppresses it, and at 5 bars a probe reaches weapons
range of the Peregrine and the existing death sequence fires. No mechanical change.

`exposure` (new) is **what got away**. When heat is at or above a threshold and no shot is
available — no ammo, or the cooldown has not come around — a probe completes its observation and
leaves, and exposure gains a point permanently.

The rule that carries the tension: a probe you kill is free, a probe that escapes is forever. The
railgun is not reducing risk, it is racing a transmission. That turns ammo from housekeeping into
the only thing between 873 people and the end, and it puts helium-3 in direct competition with
itself, since the same tank fuels dispatches.

Exposure drives the mid-game threat. See **Strikes**.

### Colony charters

A charter's settlement assemblies include its biological seed stock. The game does not count that
stock separately: acquiring and delivering an Ectogenesis Bank is the visible representation of
the capability. The Peregrine must still be present to charter a colony, keeping the ship meaningful
in a game whose second half is a network.

### Colonies

A fourth rung on the planet ladder:

```
habitable planet → fabricator (t1) → advanced fabricator (t2) → colony
```

Chartering is offered in `PlanetPanel` on a habitable world hosting a tier-2 fabricator. It costs
a set of rare assemblies delivered to that node or carried there by the Peregrine. A charter is a
standing demand on the logistics network satisfied over several dispatches, which is a better
problem than affording a price.

A colony has `population` growing logistically toward a cap, an `installed` set of rare assemblies
each buying a specific stat, standing consumption of nutrients and railgun ammo, and the usual
node coordinates copied from its fabricator.

Population grows only while fed. A cut-off colony stops growing, then starves, and losses are
permanent and reported in people. Population also produces **labor**, the capacity that star-scale
works consume.

A colony runs its own extractors and fabricators in its system without the Peregrine present. That
autonomy is the mechanical meaning of Type I, and it is the first time the network does anything
while the player is elsewhere.

### Rares retargeted

The four existing assemblies already map onto a colony's subsystems. Keep the ids and the recipes;
give each one a stat it buys, and re-desc from station scale to settlement scale.

| Role | Assembly | Governs |
| --- | --- | --- |
| `life` | Closed Ecology Column | Population cap |
| `power` | Zero-Point Capacitor | Growth rate |
| `field` | Frame-Dragging Gyroscope → **Sentinel Battery** | Point defense: ammo capacity and fire rate |
| `fuel` | Antihydrogen Reservoir | Autonomy: colony-funded dispatches |

Add one assembly and one role:

**`population` / Ectogenesis Bank** — the machinery that turns frozen stock, nutrients, and years
into people. Consumed at founding and again at each population tier. Costs nutrients and alloys
heavily plus tier-2/3 intermediates (`bec_cell`, `muon_cell`, `silica_aerogel`), matching the
existing rare cost shapes.

`RARE_ROLE_LABELS` in `types.ts` gains `population: 'Ectogenesis'`. `RareResource` gains an
optional `effect`, mirroring `ExtractorUpgrade.effect`, so colony stats stay data-driven rather
than becoming switch statements.

The gyroscope is renamed and re-descd rather than replaced. Its recipe — YBCO tape plus a
degenerate core — is already a plausible fire-control mount, and keeping the id avoids a stockpile
migration.

### Sentinel batteries

The `field` assembly gives a colony its own point defense, running the same suppression logic the
ship runs. A colony accumulates local heat from its extractors, its fabricators, and route traffic
terminating there; its battery fires on a cooldown and spends ammo the network delivers.

This is the replacement for any passive-masking idea, and it is better because it creates a
**defense demand line in the logistics DAG**: colonies need ammo the way fabricators need
materials, and a colony you cannot supply does not merely stagnate, it gets found. It also gives
helium-3 a third claimant and makes `computeMaterialBandwidth` pressure bite in the late game.

The existing Signal Dampener module stays exactly as implemented — it excludes an extractor from
`routeDetectionRisk` — and is re-descd as a signature baffle: it does not hide the station, it
keeps the station from advertising to passing probes.

### Wreckage

A destroyed probe leaves **alien matter**: the one raw resource that cannot be mined, extracted,
or crafted. It comes only from kills.

This does three things. It makes engaging probes a decision rather than pure avoidance — farm a
contested region for tech and accept that one may escape. It gives the player a reason to hold
ground instead of always fleeing outward, which the current design lacks. And it is the only
credible answer to how a refugee cruiser reaches Type III: you do not out-research a civilization
that atomized Earth, you reverse-engineer its hardware.

Alien matter gates a recipe tier above the current exotic tier, culminating in the two objects
that end the game.

### The Kardashev ladder

Rungs are pegged to output, not territory. The player already crosses superclusters in the first
hour (`new_supercluster`, `NavRegen`), so presence gates nothing.

| Tier | Scale | Gate |
| --- | --- | --- |
| **0** | Fleet | One ship, 873 names. Starting state. |
| **I** | Planetary | One colony self-sufficient: population above threshold and food positive with no shipments. |
| **II** | Stellar | A Dyson swarm — statite mirrors, thermophotovoltaic film, momentum tether — assembled at a colony's star over many dispatches as a partially-complete megastructure on a node. |
| **III** | Galactic | Self-replicating probes of your own saturating one galaxy, with swarms at multiple stars. |

Each tier raises a permanent **detection floor**: a civilization that eats a star cannot be quiet.
The floor is the cost of the tier and the reason the ladder is a choice rather than a checklist.

**Type IV is what they are.** The player ceiling is III. The civilization that killed Earth
operates at supercluster scale, which is why a warp flicker near Venus was noticed at all and why
probes are everywhere. Keeping IV out of reach explains the setting, protects pacing — II to III
is already an enormous arc — and keeps the ending honest: you climb high enough to answer them and
still cannot know whether it was high enough.

If IV is ever added, the gate should be inter-supercluster *coordination* — a standing network
that operates without the Peregrine at all — never presence, because presence is free.

### Strikes

Exposure thresholds telegraph a Cannon strike against a named supercluster with a warning window.
During the window the player can evacuate a colony there, losing everything installed but keeping
the population in a flotilla. Doing nothing loses the colony and its people permanently,
reported by name count in the same register as the boot sequence.

This gives the mid-game a beat that is not accumulation, makes the Sentinel Battery worth its
cost, and makes growing fast in the bright a real gamble rather than the obviously correct play.

### Endgame

Reaching Type III requires building self-replicating probes — the exact instrument that found
Earth. The player becomes the axiom by construction, before any choice is offered. The choice is
only what the probes are *for*:

- **Fire.** Use the network to find a young civilization and strike first. You survive. The game
  should say plainly what you have become and not punish you mechanically for it.
- **Beacon.** Spend the same infrastructure announcing humanity deliberately, betting the axiom is
  wrong. The only ending where the silence ends.
- **Go dark.** Disperse, stay small, never be seen. Humanity survives as something that never gets
  to be looked at.

Three endings, one build tree, no additional systems. Not implemented yet — the campaign currently
has no ending.

## Data model

### `game/types.ts`

```ts
export type ColonyKey = string;

export interface Colony {
  key: ColonyKey;
  fabricatorKey: FabricatorKey;
  galaxySeed: number;
  systemId: number;
  systemName: string;
  planetName: string;
  foundedAt: number;
  population: number;
  installed: Record<string, number>;
  lastTickAt: number;
  lastFireAt: number;
  ammo: number;
  localHeat: number;
  systemX: number; systemY: number;
  galaxyX: number; galaxyY: number;
  superclusSeed: number;
}
```

`makeColonyKey` mirrors `makeFabricatorKey` (`galaxySeed|systemId|planetName`), and `colonyNodeId`
joins `extractorNodeId`/`fabricatorNodeId` with a `colony:` prefix.

`RareResource` gains
`effect?: { stat: 'popCap' | 'growth' | 'defense' | 'autonomy' | 'ectogenesis'; value: number }`.
`RARE_ROLE_LABELS` gains `population`.

### `store/colonyStore.ts`

New store shaped after `fabricatorStore`: `colonies: Record<ColonyKey, Colony>` with
`charterColony`, `installAssembly`, `tickColonies(now)`, `evacuate`, `removeColony`, and derived
selectors `colonyPopCap`, `colonyGrowthRate`, `colonyDefense`. `tickColonies` is a
pure function over elapsed time, in the same spirit as `peekAccumulated`, so it tests without a
clock.

### `store/uiStore.ts`

Add `exposure` and `lastProbeEscapeAt`. Extend `tickRailgunSuppression` to record an
escape when heat is at threshold and no shot was available. `resetUpgrades` and `resetGame` clear the new fields.

### Persistence

Firestore gains a `colonies` collection alongside `fabricators`, written through a new
`firebase/colonies.ts` with the same shape as `firebase/fabricators.ts`. `exposure`
joins `UserSettings` in `firebase/userDoc.ts` with a default of zero so old
saves load unchanged. `store/persistRun.ts` grows a `colonyKeys` field so the post-run fan-out
cannot forget colony writes — that file exists precisely so a new feed path cannot drop a write,
and colonies must go through it.

No migration is needed for existing rares: ids are unchanged, so a stockpile full of gyroscopes
becomes a stockpile full of sentinel batteries.

## Implementation phases

Each phase is shippable on its own and leaves the game playable.

### Phase 1 — Probe fiction and exposure

`store/uiStore.ts`, `ui/strings.ts`, `ui/ShipHUD.tsx`, `ui/InfoPanel.tsx`, `ui/DeathOverlay.tsx`,
`firebase/userDoc.ts`, `hooks/useSettingsPersist.ts`.

Add `exposure` and the escape rule to `tickRailgunSuppression`. Retheme HUD labels from detection
to probe attention, add an exposure readout, and write the probe lore into `InfoPanel` OriginsView
in the established register — brief, flowing, understated. Re-desc the Signal Dampener in
`data/upgrades.json`.

No new economy. This phase alone makes the existing meter legible.

### Phase 2 — Colonies

`game/types.ts`, `store/colonyStore.ts` (new), `store/uiStore.ts`, `ui/PlanetPanel.tsx`,
`firebase/colonies.ts` (new), `store/persistRun.ts`, `store/resetGame.ts`, `game/quests.ts`.

Charter action in `PlanetPanel` gated on a tier-2 fabricator, the complete assembly set, and the
ship being present. Population growth and starvation in `tickColonies`, driven
by the automation tick that already exists in `useLogisticsAutomation`. A new colony quest id —
note that `firebase/fabricators.ts` already carries one-time compatibility for an older
`first_colony` id, so check for a collision before reusing that string.

### Phase 3 — Rares as colony subsystems

`data/rareResources.json`, `data/rareResources.ts`, `game/types.ts`, `ui/LogisticsModal.tsx`.

Add `effect` to each assembly, add the Ectogenesis Bank, rename the gyroscope to Sentinel Battery,
re-desc all five for settlement scale. Charter cost becomes a delivered demand: colonies appear as
sink nodes in the route editor with a standing requirement, reusing the existing fabricator-demand
rendering.

Self-contained data work, and the right place to look hard at numbers.

### Phase 4 — Colony nodes and defense

`ui/logisticsProject.ts`, `ui/LogisticsMap.tsx`, `ui/LogisticsModal.tsx`, `store/logisticsStore.ts`,
`store/colonyStore.ts`.

`NodeType` gains `'colony'`. Colony nodes render distinctly — a filled hexagon reads differently
from the extractor circle and the fabricator diamond — with a population ring and a supply-status
color. `dispatchRoute` learns to deliver nutrients and ammo to a colony sink. Sentinel batteries
run suppression against local heat on the automation tick.

### Phase 5 — Wreckage and the alien tier

`store/uiStore.ts`, `data/materials.json`, `data/upgrades.json`, `game/types.ts`.

Alien matter as a resource from kills, a recipe tier gated on it, and the Dyson swarm as a
partially-complete megastructure on a node — mechanically a fabricator target with a very deep
buffer and no output until complete.

### Phase 6 — Ladder and strikes

`store/civStore.ts` or an extension of `colonyStore`, `ui/InfoPanel.tsx`, `ui/DeathOverlay.tsx`.

Kardashev tier evaluation, per-tier detection floors, and telegraphed strikes with evacuation. The
three endings below stay unbuilt for now; Type III is the ceiling and play continues past it.

## Balance notes

Starting points, not conclusions.

- **Ammo economy.** At `FIRE_COST` 5 and `RELOAD_HELIUM_PER_AMMO` 3, a shot costs 15 helium-3
  against a 25-helium jump. Colony batteries should draw at the same rate so that defending a wide
  network genuinely competes with expanding it.
- **Colony nutrient draw** should be set so one mature colony consumes roughly what one good
  habitable extractor produces. Self-sufficiency at Type I then means a colony feeding itself from
  its own build slots, which is exactly the lesson the tier should teach.
- **Detection floors** per tier should be small — one bar at Type II, two at Type III — but
  permanent, so late play runs at a heat level that would have been lethal early.
- **Exposure thresholds** want to be far enough apart that a strike is an event, not weather.
  Three or four strikes across a full campaign is the target density.

## Testing

`store/productionLogistics.test.ts` is the model: pure functions over injected state and clocks.

- `tickColonies` growth, starvation, and cap arithmetic over injected elapsed time.
- The escape rule: heat at threshold with zero ammo raises exposure exactly once per cooldown.
- Charter accounting: assemblies consumed, colony created, and the whole thing
  refused when the ship is not present.
- Colony sink demand in `dispatchRoute`, including a colony competing with a fabricator on the same
  route for the same nutrients.
- Kardashev tier evaluation across its boundary conditions.

## Open questions

- Should a starving colony lose population continuously or in visible increments? Increments read
  better and report by name count more naturally; continuous loss is truer to the system.
- Does exposure ever decay? The design argues no, but a campaign that can be permanently soft-locked
  by an early mistake is a real risk. A slow decay measured in hours may be the compromise.
- Should the Peregrine stay destructible once colonies exist, or does losing the ship become a
  setback rather than an ending? Once humanity is distributed, the current death sequence is
  arguably wrong.
- Do colony-built extractors count toward `routeDetectionRisk`, or does the probe fiction treat a
  quiet local economy differently from warp traffic?
