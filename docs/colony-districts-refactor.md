# Colony Districts, Jobs, and Research

A refactor of the colonization campaign from a supply sink into the game's second half.

Supersedes the colony portions of `colonization-and-kardashev-plan.md`. The probe fiction, exposure,
strikes, the vault, and the charter delivery mechanic in that document all survive unchanged; what
changes is what a colony *is* once it exists.

## Why

The current colony is a sink with five install slots. Every rare assembly buys one scalar
(`popCap`, `growth`, `defense`, `autonomy`, `ectogenesis`), the colony consumes nutrients and
ammunition forever, and the only thing it ever sends back is a gene line every six fed hours. The
deepest production chains in the game therefore terminate in five numbers, and the Kardashev ladder
sits on top of hidden predicates the player cannot watch.

The refactor makes the colony an economy whose shape the player designs, and whose output re-enters
the logistics network flowing the other direction.

```
extractors -> fabricators -> advanced materials
                                   |  (logistics, outbound)
                            DISTRICTS on a colony
                                   |
                            JOBS filled by pops
                                   |
                research . gene lines . materials . food
                     |                 |  (logistics, homebound)
          civilization ladder         Peregrine stockpile
```

Two consequences carry the design:

**Advanced materials become districts, not trinkets.** What the player can manufacture determines
what kind of society they can build. The tier-3 and tier-4 tree stops being a scoreboard.

**Colonies become sources in the DAG.** Today every route edge points at a colony. A mature colony
emits food surplus, tier-1 and tier-2 materials, and gene lines as real cargo that routes can carry
home. Research is the exception: it joins a civilization-wide pool immediately, so scientific
progress continues wherever humanity has staffed research districts.

## Districts

A district is built by delivering materials to the colony node, through the same staged, windowed
delivery path the charter already uses (`colonyDemand` / `deliverColony`). It occupies one slot,
provides a fixed number of job slots, and carries a per-hour upkeep drawn from colony stores.

District slots come from the planet. `generateSystemLayout(seed)` is deterministic, so a planet's
capacity is derived from its layout radius rather than stored: roughly six slots on a small
habitable world and twelve on a large one. This is the first time in the game that *which*
habitable planet the player settled matters beyond its zone type.

| District | Built with | Jobs | Job output | Upkeep |
| --- | --- | --- | --- | --- |
| Agri-Dome | `silica_aerogel`, `graphene_lattice` | 4 Farmers | nutrients | - |
| Habitat Block | `hea_billet`, `closed_ecology_column` | - (raises population cap) | - | nutrients |
| Foundry | `hea_billet`, `boron_ceramic` | 3 Metallurgists | alloys, tier-1 materials | helium-3 |
| Fabrication Yard | `metamaterial_film`, `ybco_tape` | 3 Technicians | tier-2 materials | alloys |
| Research Campus | `bec_cell`, `casimir_plate` | 3 Researchers | abstract research | helium-3, nutrients |
| Gene Clinic | `ectogenesis_bank`, `muon_cell` | 2 Geneticists | viable lines | nutrients |
| Sentinel Array | `frame_dragging_gyro`, `degenerate_core` | 2 Gunners | ammunition capacity, fire rate, local heat suppression | `sentinel_ammo` |
| Deep Survey Array | `positron_trap`, `momentum_tether` | 2 Astronomers | abstract research | exotic |
| Orbital Assembly | `statite_mirror`, `tpv_film` | 4 Engineers | project labor | alloys |

The five existing rare assemblies survive as **district anchors** rather than scalar installs. Their
ids and recipes are unchanged, so no stockpile migration is needed, and their existing descriptions
already read correctly at settlement scale. `RareResource.effect` stays in the data but is applied
as a district modifier rather than a colony-wide one.

District definitions live in `src/data/districts.json` with a typed re-export in `districts.ts`,
matching the existing `materials.json` / `upgrades.json` / `rareResources.json` pattern. District
behaviour must stay data-driven; a district that needs a switch statement is a district designed
wrong.

## Pops and jobs

Deliberately one step simpler than the genre reference: no strata, no happiness, no trade value.

- `population` keeps its existing logistic growth and its exact integrated food consumption. The
  cap now comes from Habitat Blocks, replacing the current stacked ceiling of `colonyPopCap` and
  `populationTier * ECTOGENESIS_TIER_SIZE`, which is two invisible limits where one will do.
- Pops fill job slots in a player-set priority order held on the colony (`jobPriority`). Filled
  jobs are `min(population, sum of slots)` distributed down that order.
- **Unemployed pops still eat.** This is the pressure curve of the whole feature: growth without
  districts is a food bill with no return, so the player builds deliberately instead of watching a
  number rise.
- Output per job is `filled * base * modifiers`, integrated over elapsed time inside `tickColony`,
  which stays a pure function over an injected clock.
- Unmet upkeep degrades that district's output proportionally rather than killing anyone.
  Starvation stays reserved for food, where it already reads well and is already reported in people.

## Research is shared knowledge

Research is an abstract, civilization-wide resource. Staffed Research Campuses and Deep Survey
Arrays add research directly to a persistent global total. It is never placed in colony stores,
carried by routes, or represented as an inventory item.

That boundary keeps the roles legible:

- logistics moves physical inputs, construction materials, food, ammunition, and manufactured goods;
- researchers create knowledge, so their output cannot be stranded in a warehouse;
- upkeep still ties science to the physical economy, because an unsupplied campus loses output;
- the running total makes progress toward the next civilization type visible at all times.

Research is cumulative rather than spent. Thresholds are 120 for Type I theory, 420 for Type II,
and 1120 for Type III. Ship workshop upgrades keep their physical resource costs and do not drain
civilization progress.

## The Kardashev ladder, rebuilt

`evaluateKardashev` combines the shared research total with one visible proof at each scale. Neither
knowledge nor infrastructure is sufficient alone.

| Tier | Research threshold | Physical milestone |
| --- | --- | --- |
| I Planetary | 120 | One colony with every job slot filled and food-positive for an hour, shown as a live meter |
| II Stellar | 420 | A Dyson swarm built by Engineer jobs over time |
| III Galactic | 1120 | Replication networks at three stars in one galaxy |

Each rung renders as a card showing cumulative research, the physical milestone, and what the type
unlocks. Reaching the rung still raises its permanent detection floor.

## The SYS panel

`SYS` in `ShipHUD.tsx` is currently a dead placeholder (`PlaceholderButton`, empty `onClick`). It
becomes the civilization screen, and colony detail lives there and nowhere else.

Four tabs:

- **WORLDS** - roster on the left; the selected colony fills the frame with a district grid of built
  and empty slots, a jobs table (job, slots, filled, output per hour, upkeep), a food-runway strip,
  and a delivery strip generated from `colonyDemand` that says plainly what routes must bring.
- **CIVILIZATION** - the shared research total, progress toward the next theory threshold, and the
  three Kardashev rungs with separate research and infrastructure status.
- **THREAT** - exposure against the next strike threshold, per-colony local heat, Sentinel coverage,
  evacuation.
- **VAULT** - gene lines spent and returned, evacuated population, the running count against the 873.

`PlanetPanel` and the logistics node sidebar keep a three-line summary - population, food runway,
one "needs X" line - plus a link into SYS. `CivilizationButton` is removed from the HUD status
flyout entirely.

Every colony row answers one question at a glance: what to do next. `needs 2 more Ectogenesis Banks`,
`starving, 12m of food left`, `3 idle pops, no jobs`, `ready to charter, bring the ship`. All of it
is derivable from state the stores already compute.

## Data model

```ts
interface Colony {
  // kept: key, fabricatorKey, coordinates, foundedAt, population, supplies,
  //       assemblies, requested, ammo, localHeat, starvationMs, lostPeople,
  //       project, projectDelivered, swarmComplete, probeCoverage
  districts: Record<DistrictId, number>;
  districtProgress: Record<DistrictId, MaterialCost>;
  jobPriority: JobType[];
  produced: MaterialCost;
}
```

Removed: `installed` (becomes `districts`), `populationTier`, `selfSufficientMs`, `lastShipmentAt`,
`exportedLines`, `labor` (becomes Engineer job-hours held per project).

`colonyExport` already exists and simply begins reading `produced`. `restoreColonies` migrates an
old save by converting each `installed` assembly into its anchor district and seeding `jobPriority`
with the default order.

New files: `src/data/districts.json`, `src/data/districts.ts`, `src/data/research.json`,
`src/data/research.ts`, `src/store/researchStore.ts`, `src/ui/SysPanel.tsx`. Firestore gains a
`research` document alongside the existing per-user settings; colony writes continue to go through
`store/persistRun.ts` so no feed path can drop one.

## Phases

Each phase is shippable and leaves the game playable.

**1. Districts and jobs.** `districts.json`, the new `Colony` fields, district delivery through the
existing charter-demand path, job output integrated in `tickColony`. Colonies produce food and
materials only. No panel work yet; districts are built from the existing colony detail view.

**2. The SYS panel.** The four-tab view. Colony detail is stripped out of `PlanetPanel` and the
logistics sidebar and replaced with summary cards.

**3. Abstract research.** Research Campus, Deep Survey Array, `researchStore`, persistence, and the
cumulative civilization thresholds.

**4. Ladder rebuild.** Capstones replace `evaluateKardashev`; the Dyson swarm becomes an
Engineer-job project rather than a labor threshold.

**5. Threat integration.** District count drives local heat, which `COLONY_HEAT_PER_INDUSTRY_HOUR`
already has the right shape for; the Sentinel Array scales colony defense.

## Testing

`store/productionLogistics.test.ts` remains the model: pure functions over injected state and clocks.

- Job filling against priority order, including more pops than slots and more slots than pops.
- Output integration over elapsed time, including the clamped unattended catch-up.
- Upkeep shortfall degrading output proportionally without population loss.
- District delivery competing with a fabricator on the same route for the same materials.
- Abstract research integrated over elapsed time without entering `produced` or route cargo.
- Research and physical-milestone boundary conditions, and old-save migration from `installed` to
  `districts` and from data cores to the shared research total.

## Open questions

- Should Habitat Blocks occupy district slots? If they do, every colony is a real tradeoff between
  size and function, which is the more interesting game. Current lean: yes.
- Should unemployed pops merely waste food, or also raise local heat? Unrest as a detection signal is
  thematically strong but adds a fourth pressure to a colony that already balances food, upkeep and
  ammunition.
- Do colony-run districts count toward `routeDetectionRisk`, or only toward local heat? The probe
  fiction can justify treating a quiet local economy differently from warp traffic.
- Does a Gene Clinic make the vault renewable enough to remove the campaign's scarcity, and if so
  should its yield be capped per colony rather than per pop?
