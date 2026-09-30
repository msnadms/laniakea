# Base economy: resources and loudness

## Resources

- **Negative-energy condensate:** flight, listening, bearings, sweeps and raid launches. The ship still harvests it in voids; a base's collectors add to it.
- **Advanced technology:** buildings and ship upgrades.
- **Population:** starts at a fixed number aboard the ship, grows on the world up to its cap, and limits what the base can build and run.

## Loudness is loot

A base's signal strength is the resources it holds. Collectors that have not been emptied count for more than storage.

- A rich base is loud and easy to find. A player who spends everything is quiet.
- The loudest signal on your sky is the most valuable target, and the decoys keep that from being certain.
- A shielded base is silent.

## Phase 1: Collectors and storage

- Collectors fill at the world's rates up to their capacity; the server settles them lazily, like harvest.
- Collecting moves resources into storage, which is quieter.
- `baseLoudness(base)` in `src/game/`, shared by the server's survey and the client's own readout.

## Phase 2: Buildings

- Buildings bought with advanced technology and limited by population: more collectors, more storage, defences.
- Nodes bought strictly in order, as the ship's upgrade tree does.

## Phase 3: Rendering

- Settlement lights brighten with population, and buildings show as orbital structures in the system view.
