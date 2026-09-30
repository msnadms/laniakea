# Multiplayer: search, settle, raid

Multiplayer is the core of the game. It plays like Clash of Clans, asynchronously, with one change: nobody hands you a target. Every base is hidden somewhere in a universe 93 billion light years across, and finding one is the skill.

## Premise

Each player is one of many survivors whose civilisation was destroyed by an Alcubierre cannon somewhere in the universe. They start aboard a ship carrying what remains of their species, and they have to find a habitable world to settle before their negative-energy condensate runs out. Once settled, the ship becomes a remotely piloted scout and raider, flown from home, and the base is where the species lives.

## Decisions so far

- **Asynchronous.** Players never need to be online together. Raids are played by the attacker against the defender's layout while the defender is away.
- **Raids take resources.** Never population, and never the world itself.
- **Bases are separate from civilisations.** A player base is not a civilisation stage and does not reuse the anomaly placement. NPC civilisations stay as they are.
- **Bases are founded on habitable worlds** the player has to find.
- **Starts are uniform over the whole universe.** Players are never clustered to make them easier to find, so long-range search has to be both possible and skill-based.
- **The ship is remotely piloted** once a base exists.

## The core loop

1. **Build.** Collectors on the base fill with negative-energy condensate and advanced technology, spent on defences and upgrades.
2. **Search.** Listen to the sky, triangulate with the ship, then close in with sweeps.
3. **Raid.** Fly the ship there and play the raid against the defender's layout.
4. **Defend.** Lay out the base so it holds while you are away.

## Plans

1. [Scanning](01-scanning.md): long-range search by listening, bearings and triangulation.
2. [Bases](02-bases.md): habitable worlds, founding a base, and bases as server state.
3. [Exodus](03-exodus.md): a new player's search for a world.
4. [Base economy](04-base-economy.md): resources, collectors, buildings and loudness.
5. [Raids](05-raids.md): the deterministic raid, loot, shields and trails.
6. [Hide and seek](06-hide-and-seek.md): jammers, decoy beacons, listener warnings and relocation.
7. [Clans](07-clans.md): shared findings, reinforcements and refuelling.

Scanning comes first because it answers whether uniform starts are playable at all, and it ships on its own against the NPC civilisations that already exist. Bases and the exodus give every player something to search for, and raids come only once there is something worth raiding.

When the work lands, rewrite CLAUDE.md's branch description: colonies are back, as player bases on habitable worlds, and multiplayer is the core.

## Open decisions, with defaults

- **More than one base per player?** Default: one to start, with extra colonies as a late upgrade.
- **Losing the ship?** Default: rebuilt at the base for negative-energy condensate.
- **What a raid looks like on screen?** Default: the attacker's ships against orbital defences in the system view. This decides most of the raid plan and should be settled before it.
- **The long-term thread.** The ruined Alcubierre cannons that "fired once" could be the ones that destroyed the players' civilisations; finding yours could be a goal.
