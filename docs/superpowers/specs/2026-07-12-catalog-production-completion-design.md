# Catalog Production Completion Design

## Goal

Complete the remaining helper catalog work except weekly report audio: incremental OneDrive sync, role-capability persistence, generic catalog lookup, consent-gated external sheet-music search, and controlled LINE attachment saving.

## Runtime Boundaries

- The ACA app and catalog job remain the only Azure deployables in this repository.
- The office Windows workstation runs official SearXNG and ClamAV containers through Docker Compose. Both use `restart: unless-stopped`, persistent volumes, and health checks.
- A Windows logon task starts Docker Desktop, waits for the engine, and reconciles the Compose project after a reboot.
- The existing bastion VM only relays private VNet traffic to the workstation Tailscale address. SearXNG and ClamAV are not public services.
- SearXNG is only used after sheet-music catalog miss and requester consent. It returns title, snippet, and URL only.
- ClamAV scans attachment bytes through the native `INSTREAM` protocol before preview or publication. Timeout, disconnect, malformed response, and non-clean results fail closed.

## Delta Sync

- `catalog_sources` stores an optional Graph delta cursor and cursor update timestamp.
- The first delta request enumerates the registered source hierarchy. The job follows every `nextLink`, applies the final state, then stores the returned `deltaLink`.
- Later runs request only changes, upsert changed files, and tombstone items returned with the deleted facet.
- Replayed changes are safe because catalog identity is Graph drive plus item ID.
- Graph `410 Gone` clears the cursor and performs a new full delta enumeration.
- A source that cannot use delta falls back to the existing full crawl without deleting valid catalog state on an API failure.

## RBAC

- Add profile-scoped roles, role bindings, and capability bindings.
- Effective capabilities are additive with existing user/group function grants.
- No production roles or bindings are seeded in this release. Existing behavior remains unchanged until an administrator creates bindings in a later management surface.
- Role data never crosses profile boundaries.

## Production Function Policy

- Enable `find_resource` for the helper profile.
- Enable `save_resource` in the helper function surface and accept LINE `image` and `file` messages.
- Existing write policy remains authoritative: profile enablement does not grant ordinary users write access. The bootstrap admin or explicitly granted principals may use it.
- The main profile is absent and receives no helper capability or source access.
- Weekly report audio remains unconfigured and disabled.

## Failure Handling

- Catalog sync never advances a cursor until all pages and PG writes succeed.
- A failed scanner never uploads a binary.
- A failed OneDrive upload or catalog upsert follows the existing orphan recovery and audit path.
- If the office workstation or relay is unavailable, external search is unavailable and attachment save fails closed; internal catalog reads continue.

## Verification

- Unit tests cover delta pagination, replay, deletion, 410 reset, cursor persistence, role isolation and additive capability resolution, ClamAV clean/infected/error responses, and production profile gates.
- Docker services are tested locally, from the bastion, and from the ACA network path.
- Before deployment run format, typecheck, lint, tests, build, router eval, admin eval, and a signed webhook smoke test when practical.
