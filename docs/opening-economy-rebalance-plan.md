# Opening Economy Rebalance Plan

## Status

Implemented in code September 7, 2026; clean-save manual playtesting remains pending. The deterministic simulation and its CI ceilings are the authority for future tuning.

## Problem

The production clock is correctly defined in real hours, but most construction and recipe costs still behave as though extraction were running at the old accelerated testing rate. The opening therefore runs out of decisions almost immediately.

At the Sol start:

- The ship begins with 400 alloys, 220 helium-3, 200 nutrients, and no metallic hydrogen.
- A mining station costs 200 alloys.
- The best local alloy deposit produces 3 alloys per hour.
- The first Logistics-A upgrade costs 200 alloys and is required to create even one route.
- A basic fabricator costs 2,000 alloys, 500 helium-3, 2,000 nutrients, and 500 metallic hydrogen.

A 3/hour alloy station takes 66.7 hours merely to repay its own construction cost. Even ignoring the cost of the required stations, the slowest basic-fabricator input is nutrients: Sol provides at most 1/hour while the starting shortfall is 1,800, making that gate 75 days by itself. The advanced fabricator and charter-assembly tree then add larger waits.

This is not an idle-game cadence; it is an absence of gameplay. The player can explore and manually inspect a station, but cannot build a network, configure production, or meaningfully engage with Humanity during the opening session.

## Goals

- Preserve real hourly accumulation and useful offline progress.
- Give the player several meaningful construction choices immediately.
- Make logistics a core starting verb rather than a purchased interface.
- Make Humanity visible and actionable before the advanced-fabricator milestone.
- Preserve advanced fabrication, rare assemblies, colonies, and megaprojects as long-term progression.
- Make every early purchase repay itself on a comprehensible timescale.
- Add timing assertions so a single rate or cost change cannot silently turn hours into weeks again.

## Non-goals

- Do not restore the `1 / 1000` testing accumulation rate.
- Do not make the complete fabrication tree finish in one sitting.
- Do not give the player a prebuilt colony or bypass charter assemblies.
- Do not remove offline accumulation, extractor holds, route fuel, detection, or fabrication dependencies.
- Do not flatten late-game costs until every upgrade is interchangeable.

## Target cadence

These targets assume a new save, ordinary Sol deposits, no debug resources, and a player who explores nearby systems when required.

| Milestone | Target elapsed time | Player activity |
| --- | ---: | --- |
| First extractor | 0-2 minutes | Inspect a body and choose a deposit |
| Three to five extractors | 0-10 minutes | Allocate the starting construction budget |
| First logistics route | 5-15 minutes | Connect at least two useful nodes and configure automation |
| Basic fabricator | 10-30 minutes | Select a habitable site and establish production |
| First tier-1 material batch | 30-120 minutes | Supply and configure a simple recipe |
| Colony charter staged in Humanity | First session | See requirements and begin filling them |
| Advanced fabricator | 8-24 hours | Complete the first multi-resource production goal |
| First founded colony | 1-3 active check-ins | Produce and deliver the charter assemblies |

The target is not continuous clicking. After the initial network is configured, progress should occur during normal play and while the game is closed.

## Proposed balance model

### 1. Keep hours, increase the value of a deposit rating

Introduce an explicit constant:

```ts
EXTRACTION_UNITS_PER_RATING_PER_HOUR = 10
```

`Extractor.rate` remains the persisted deposit rating, avoiding a save migration. Accumulation becomes:

```text
deposit rating x 10 units/hour x ship multiplier x equipped-module multiplier
```

Examples at Logistics-B tier 0:

| Deposit | Current output | Proposed output | Base 300-unit hold fills in |
| --- | ---: | ---: | ---: |
| Rating 1 | 1/hour | 10/hour | 30 hours |
| Rating 2 | 2/hour | 20/hour | 15 hours |
| Rating 3 | 3/hour | 30/hour | 10 hours |
| Rating 6 | 6/hour | 60/hour | 5 hours |

This retains an idle cadence while making a deposit materially useful. UI labels must display effective units per hour, not the raw rating.

The 10x multiplier is an initial tuning value. It should be adjusted only through the milestone simulations described below, not in isolation.

### 2. Turn starting cargo into an expedition kit

Reduce the mining-station cost from 200 to 50 alloys and its dismantle refund from 50 to 25 alloys.

Reduce the proposed basic-fabricator cost to:

```ts
{ alloys: 150, helium3: 50, nutrients: 100, metallicHydrogen: 0 }
```

The existing starting manifest can then fund one basic fabricator and all five baseline station slots if the player spends every alloy on infrastructure:

```text
1 basic fabricator x 150 alloys
5 mining stations x 50 alloys
= 400 starting alloys
```

This is intentionally a choice rather than a prescribed build order. A player may reserve cargo for travel or workshop upgrades, build fewer stations, or delay the fabricator.

Metallic hydrogen should enter the first recipe and advanced-fabricator goals, not prevent the player from opening the production interface at all.

### 3. Make logistics baseline functionality

Tier-0 logistics receives one route slot. Logistics-A expands an existing network instead of unlocking it.

Proposed route capacity:

| Logistics-A tier | Route slots | Station cap |
| ---: | ---: | ---: |
| 0 | 1 | 5 |
| 1 | 2 | 8 |
| 2 | 3 | 11 |
| 3 | 4 | 14 |
| 4 | 5 | 17 |

Implementation requirements:

- Add a shared `computeRouteCap(logisticsA)` helper rather than calculating route slots inside the modal.
- Remove the tier-0 locked state from `LogisticsModal`.
- Permit creating, saving, dispatching, and activating the baseline route at tier 0.
- Keep bandwidth, station-cap, detection-decay, and extraction-rate improvements on the two logistics upgrade paths.
- Rewrite Logistics-A names and descriptions so tier 1 promises expansion, not initial access.
- Change tutorial and README language from "unlock logistics" to "expand logistics."

### 4. Expose Humanity during colony planning

A basic fabricator should be allowed to stage a colony charter. Staging creates the not-yet-founded colony record and exposes its assembly demand in Humanity and Logistics.

The advanced fabricator remains required to craft rare charter assemblies, and a colony still cannot be founded until all assemblies are present. This separates interface access from progression:

```text
basic fabricator -> stage and inspect charter -> build supply chain
advanced fabricator -> produce rare assemblies -> found colony
```

Implementation requirements:

- Allow `planCharter` for fabricator tiers 1 and 2.
- Show the "Stage colony charter" action on a basic or advanced fabricator.
- Keep the tier-2 check for actually chartering the colony unless testing shows that it creates a confusing final gate.
- Replace Humanity's empty-state instruction with an opening roadmap that names the basic-fabricator step, the advanced-fabricator step, and charter assembly progress.
- Ensure a staged charter appears as a logistics sink before it has population.

### 5. Reprice the early workshop

The first workshop tiers should compete with infrastructure without consuming the player's entire opening budget. Use the following as the first tuning pass:

| Track | Tier 1 cost | Intent |
| --- | ---: | --- |
| Storage-A | 75 alloys | Optional larger ship buffer |
| Storage-B | 50 alloys | One station's cost for longer check-ins |
| Drive-A | 50 exotic matter | Reach nearby resource diversity sooner |
| Drive-B | 75 helium-3 | Compete with fabricator and route fuel |
| Weapon-A/B | 75 alloys | Affordable response to early attention |
| Logistics-A/B | 100 alloys | Expand or accelerate a working network |

Later costs should rise geometrically and be validated against the production available at that stage. Do not apply one blanket percentage to every tier: storage and logistics create compounding economic returns, while weapons and drives solve different pressures.

### 6. Reprice production by hours of input, not raw magnitude

Every recipe should be evaluated using `cost / expected hourly input`, including all prerequisites. The initial targets are:

- Tier-1 material recipe: 1-3 hours of a small early network.
- Tier-2 material recipe: 3-8 hours after tier-1 inputs exist.
- Extractor module: 4-12 hours depending on strength.
- Advanced fabricator: 8-24 hours from a functioning basic network.
- Individual rare assembly: 4-12 hours after advanced fabrication.
- Complete first charter package: reachable over 1-3 deliberate check-ins.

For the first pass, divide tier-1 raw recipe costs by approximately four to six and advanced/rare raw costs by approximately five to ten, then run the dependency simulation. Outputs and material requirements should remain intact initially so the production graph keeps its current shape.

The committed recipe values were selected with a dependency simulation that shares intermediate inventory and byproducts across competing recipes. Future changes must keep that competition in the simulation; evaluating a recipe alone can still hide a multi-day charter bottleneck.

### 7. Match automation polling to the new cadence

Keep route automation coarse enough to avoid needless persistence traffic. With rating-6 extractors producing 60/hour, a 60-second poll adds only one unit, so the existing poll interval remains acceptable.

The catch-up loop and minimum-dispatch threshold must be tested with the new yields. If early routes appear inert, prefer a lower early dispatch threshold or a recipe-ready exception over polling more often.

## Implementation phases

### Phase 1: Restore opening agency

- Centralize station cost and refund constants outside `PlanetPanel`.
- Apply the 10-units-per-rating-per-hour extraction scale.
- Display effective hourly output in planet and logistics panels.
- Reduce station and basic-fabricator costs.
- Give tier-0 logistics one route slot and remove the lock screen.
- Update onboarding copy.

This phase should be playable independently and is the minimum fix for the dead opening.

### Phase 2: Open the Humanity planning loop

- Allow basic fabricators to stage charters.
- Improve the pre-colony Humanity view.
- Confirm staged charter demand is available to route previews.
- Preserve advanced fabrication as the assembly-production gate.

### Phase 3: Reprice the production tree

- Add the milestone simulator first.
- Reprice workshop tiers, tier-1 materials, the advanced fabricator, modules, and rare assemblies.
- Simulate both Sol-only accumulation and a reasonable nearby-system network.
- Playtest scarcity choices, especially nutrients, exotic matter, and metallic hydrogen.

### Phase 4: Polish and telemetry

- Add projected completion times to unaffordable construction and recipe UI where practical.
- Show station payback and hold-fill time in the extractor detail view.
- Log or expose milestone timestamps in development builds for balance sessions.
- Update README, `CLAUDE.md`, tutorials, and any design documents that describe a daily-only opening cadence.

## Tests and validation

### Unit tests

- A rating-1 extractor produces 10 units after one hour at base multipliers.
- Partial collection preserves the correct fractional accumulation time.
- Holds cap correctly at every Storage-B tier.
- Logistics-B and extractor modules multiply the new hourly base exactly once.
- Tier-0 logistics permits one route but rejects a second.
- Each Logistics-A tier increases the route cap according to the table.
- A tier-1 fabricator can stage a charter.
- A tier-1 fabricator cannot craft rare assemblies or found the colony prematurely.
- A tier-2 fabricator can complete the existing charter flow.

### Balance simulation

Add a deterministic test or script that starts from `defaultSettings`, uses the fixed Sol deposits, and reports:

- time to repay each station;
- time to afford a representative workshop tier;
- time to afford a basic fabricator;
- time to craft each material tier;
- critical path to an advanced fabricator;
- critical path to one complete charter package;
- extractor hold overflow under 1-hour, 8-hour, 24-hour, and 72-hour absences.

The simulator should fail CI when key opening targets exceed a generous ceiling. Suggested hard ceilings:

- baseline route available immediately;
- basic fabricator affordable within 30 minutes of intended active play;
- first tier-1 batch within 2 hours;
- advanced fabricator within 24 hours of accumulated production;
- no required first-colony input has an isolated wait longer than 24 hours once its source station exists.

### Manual playtest checklist

- Start with a clean save and no debug refill.
- Confirm at least three viable opening build orders exist.
- Confirm a mistaken first station does not force an hours-long recovery.
- Build and activate a tier-0 route.
- Leave for one hour and verify offline output is useful but does not overflow every station.
- Build a basic fabricator and stage a charter without purchasing an upgrade.
- Inspect the staged charter in Humanity and in route demand.
- Verify the next objective is obvious without reading external documentation.
- Continue until the first colony is founded and record real and simulated elapsed time.

## Save compatibility

- Keep `Extractor.rate` as the deposit rating. Existing extractors automatically receive the new global hourly scale.
- Do not rewrite `lastCollectedAt`; existing offline accrual remains capped by the extractor hold.
- Existing tier-0 saves gain one route slot immediately.
- Existing routes above a newly computed cap must remain loaded and editable; caps should prevent only creation of additional routes.
- A staged charter continues using the current colony record and persistence format.
- Cost reductions require no migration and should never remove resources from an existing save.

## Risks and mitigations

### Existing saves receive a windfall

Old extractors may fill immediately after the output increase. The hold cap bounds this gain, and the windfall is preferable to leaving existing players trapped in the old economy.

### Starting choices become solved

If one resource or build order is always optimal, adjust starting cargo or site costs rather than reintroducing a feature lock. The opening should present tradeoffs between coverage, fabrication, upgrades, and fuel reserve.

### Logistics generates excessive probe attention

Earlier access means earlier exposure to route risk. The starter route should be small enough to remain below the attention threshold, and the tutorial must explain route risk before activation.

### Colony staging implies immediate colonization

The Humanity panel must clearly distinguish "staged" from "founded" and show which steps require advanced fabrication. Early visibility is intended; an immediate free colony is not.

### Global scaling distorts colony-local extraction

Colony food and local-extractor calculations reuse the extractor accumulation constant. Tests must confirm the 10x scale is applied consistently and that local production does not accidentally multiply twice.

## Acceptance criteria

The rebalance is complete when:

- a clean save never requires waiting at an extractor to access another core interface;
- Logistics supports one fully functional route at tier 0;
- Humanity exposes a staged charter from a basic fabricator;
- all extractor UI reports true effective units per hour;
- the deterministic balance simulation meets the milestone ceilings;
- the full test suite and production build pass;
- a clean-save manual playthrough reaches a configured production network in the first session and a colony through deliberate multi-session progression rather than passive multi-week waiting.
