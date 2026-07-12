# Catalog Production Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete every remaining catalog production capability except weekly report audio.

**Architecture:** Persist Graph delta state beside catalog sources, add additive profile-scoped role capabilities, use official workstation-hosted SearXNG and ClamAV through private relays, and activate existing controlled helper functions only after dependencies are healthy.

**Tech Stack:** TypeScript 5, Node.js 24, PostgreSQL, Microsoft Graph, Fastify, Docker Compose, SearXNG, ClamAV, Azure Container Apps, Tailscale.

## Global Constraints

- Weekly report audio stays unconfigured.
- No SearXNG or ClamAV endpoint is public.
- Attachment saving fails closed unless ClamAV reports clean.
- Existing grants remain additive and profile-scoped.
- No role records are seeded.
- Every behavior change follows red-green TDD.

---

### Task 1: Graph Delta Port and Catalog Cursor Persistence

**Files:**

- Modify: `src/types.ts`
- Modify: `src/clients/graph.ts`
- Modify: `src/catalog/store.ts`
- Modify: `src/catalog/migrations.ts`
- Modify: `src/catalog/postgres-store.ts`
- Test: `src/__tests__/graph.test.ts`
- Test: `src/__tests__/catalog.test.ts`

- [ ] Add failing tests for paged delta output, deleted facets, cursor CRUD, and profile/source isolation.
- [ ] Run the targeted tests and confirm failures are caused by missing delta interfaces.
- [ ] Implement `GraphDriveClient.listFolderDelta`, catalog cursor fields, and cursor update methods.
- [ ] Run targeted tests and confirm they pass.

### Task 2: Incremental Catalog Synchronization

**Files:**

- Modify: `src/catalog/onedrive-sync.ts`
- Modify: `src/catalog/sync-service.ts`
- Test: `src/__tests__/catalog.test.ts`
- Test: `src/__tests__/catalog-sync-service.test.ts`

- [ ] Add failing tests for initial enumeration, incremental replay, delete tombstone, cursor commit-after-success, 410 reset, and unsupported-delta full-crawl fallback.
- [ ] Run tests and verify the expected failures.
- [ ] Implement delta application and safe fallback.
- [ ] Run targeted tests and confirm they pass.

### Task 3: Profile-Scoped RBAC Persistence

**Files:**

- Create: `src/access/role-store.ts`
- Create: `src/access/postgres-role-store.ts`
- Modify: `src/access/migrations.ts`
- Modify: `src/access/store.ts`
- Modify: `src/index.ts`
- Test: `src/__tests__/access-store.test.ts`

- [ ] Add failing tests for role creation, capability binding, user/group role binding, profile isolation, and additive capability lookup.
- [ ] Run tests and verify failures.
- [ ] Implement the schema and stores without production seed data.
- [ ] Run targeted tests and confirm they pass.

### Task 4: Native ClamAV Scanner

**Files:**

- Create: `src/clients/clamav.ts`
- Modify: `src/config.ts`
- Modify: `src/index.ts`
- Modify: `src/types.ts`
- Test: `src/__tests__/virus-scan.test.ts`
- Test: `src/__tests__/config.test.ts`

- [ ] Add a local fake clamd test server and failing clean, infected, timeout, and malformed-response tests.
- [ ] Run tests and verify failures.
- [ ] Implement bounded `INSTREAM` scanning with `CLAMAV_HOST`, `CLAMAV_PORT`, and timeout configuration.
- [ ] Run targeted tests and confirm they pass.

### Task 5: Workstation Search and Scanner Services

**Files:**

- Create: `infra/local-services/docker-compose.yml`
- Create: `infra/local-services/searxng/settings.yml`
- Create: `scripts/start-local-services.ps1`
- Create: `scripts/install-local-services-autostart.ps1`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/runbooks/production-operations.md`

- [ ] Add deployment-contract tests for pinned images, restart policies, private ports, health checks, and startup scripts.
- [ ] Run tests and verify failures.
- [ ] Add Compose and PowerShell automation.
- [ ] Pull images, start services, confirm health, install the logon task, and verify recovery after container restart.

### Task 6: Private Bastion Relays and Production Activation

**Files:**

- Modify: `config/profiles.json`
- Modify: `aca.containerapp.yaml`
- Modify: `azure-pipelines.yml`
- Test: `src/__tests__/profile-config-deployment-contract.test.ts`
- Test: `src/__tests__/entrance.test.ts`

- [ ] Add failing tests requiring helper `find_resource`, controlled `save_resource`, image/file message admission, SearXNG, and ClamAV deployment settings.
- [ ] Run tests and verify failures.
- [ ] Enable the profile surface and add environment contracts while preserving write authorization gates.
- [ ] Install and test bastion relays for ports 8888 and 3310.
- [ ] Run the complete verification stack.
- [ ] Commit, push, monitor Azure DevOps, update ACA env, and verify App/Job health.
- [ ] Test SearXNG consent flow, ClamAV clean/infected behavior, catalog lookup, delta sync, and reboot/autostart state.
