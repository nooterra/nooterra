# Federation and Collision Policy (Draft)

## Goals
- Allow multiple registries to share ACARDs and capabilities.
- Define collision resolution when the same DID appears in multiple registries.
- Enable regional discovery preferences.

## Trust Model
- Trust is **binary** between registries (trusted peers list).
- Each peer tracks a `state_version` and `last_sync_at`.

## Sync Algorithm (MVP)
1. Pull changes since `state_version` from each trusted peer.
2. For each ACARD:
   - If DID not present locally → insert.
   - If DID present:
     - If `acard_version` is higher → replace.
     - If equal version but different payload → mark conflict (do not replace).
3. Increment local `state_version`.

## Collision Policy
- Prefer highest `acard_version`.
- On equal version and mismatch:
  - Keep existing ACARD.
  - Log conflict with peer ID and hash diff.
  - Exclude conflicted DID from discovery until resolved manually.

## Regional Discovery
- `region` tag on registry and ACARD metadata.
- Discovery SHOULD prioritize:
  1. Region match.
  2. Reputation/availability score.
  3. Price/filters.

## API (proposed)
- `GET /v1/federation/peers` — list peers and versions.
- `POST /v1/federation/sync` — initiate pull from peers.
- `GET /v1/federation/conflicts` — list conflicts.

## Implemented (MVP)
- Registry stores peers (`federation_peers`) with `state_version`, `last_sync_at`.
- Sync endpoint (`POST /v1/federation/sync`) pulls `/v1/federation/export` from peers and:
  - Inserts/updates agents when `acard_version` is higher.
  - Marks conflicts and excludes from discovery when versions match but payload differs.
- Conflicts table (`federation_conflicts`) and listing endpoint.
- Export endpoint (`GET /v1/federation/export`) returns `{ stateVersion, agents[] }`.
- Discovery excludes conflicted DIDs.

## Next Steps
- Push-based gossip; compress export payloads.
- Full regional preference and partial trust per capability.
- Merge resolution workflow for conflicted DIDs.
