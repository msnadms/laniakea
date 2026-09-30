# Exodus: finding a world

A new player's survivors are aboard the ship, and the ship is everything they have. The goal is a habitable world within reach of the tank.

## Rules

- **Uniform starts.** A new player starts anywhere in the universe, as `randomStartLocation` already does, but over the whole ball rather than within `START_RADIUS_FRACTION`.
- **Silent while unsettled.** An unsettled ship is not a signal source, so a new player cannot be raided before they have anything to defend.
- **Population drains** slowly while unsettled, which gives the exodus urgency without a hard timer.
- **Nobody is stranded.** Every start is placed so at least one habitable world, however poor, is within a starting tank's reach.

## Phase 1: Start placement

- Widen `randomStartLocation` to the whole universe.
- A check at placement that a habitable world lies within reach, re-rolling the start if not. Tests over many seeds that it always finds one.

## Phase 2: Settling

- New players start with a starting population and tank, and no base.
- Habitable worlds are marked in the system view, with their quality.
- Founding a base calls `POST /api/base/found` (see [Bases](02-bases.md)); the survivors land and the ship becomes remotely piloted.

## Phase 3: Population drain

- The server settles population lazily, as it settles harvest: on sign-in and on each action.
- The HUD shows population beside the fuel gauge.
