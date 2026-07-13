# Task 9 Re-review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dynamic knowledge retrieval source-agnostic when evidence can resolve the source, publish successful source snapshots atomically, and preserve requester-safe ambiguity and audit behavior.

**Architecture:** `syncKnowledgeSource` prepares a complete immutable snapshot before asking the knowledge store to publish it. The memory store swaps a prepared snapshot in one synchronous mutation and the PostgreSQL store publishes through one checked transaction. `query_knowledge` searches only the capped eligible source IDs when routing metadata does not uniquely select a source, then either grounds on the unique highest-evidence source or persists an opaque requester-scoped source selection.

**Tech Stack:** TypeScript, Vitest, Fastify function modules, in-memory/Redis sessions, PostgreSQL with pgvector.

## Global Constraints

- Use TDD and observe every new regression test fail before production edits.
- Keep planner and active-task envelopes free of source names, URLs, headings, and raw choice values.
- Preserve profile/source/requester scoping for group and room sessions.
- Run targeted Prettier, typecheck, lint, all tests, build, router/admin evals, and `git diff --check` before commit.
- Commit locally and do not push.

---

### Task 1: Evidence-led multi-source retrieval and safe source selection

**Files:**

- Modify: `src/functions/query-knowledge.ts`
- Modify: `src/functions/modules.ts`
- Modify: `src/state/session-store.ts`
- Modify: `src/knowledge/store.ts`
- Modify: `src/knowledge/postgres-store.ts`
- Test: `src/__tests__/query-knowledge.test.ts`
- Test: `src/__tests__/agent-turn-runtime.test.ts`
- Test: `src/__tests__/knowledge-postgres-store.test.ts`

**Interfaces:**

- Consumes: `listKnowledgeRoutingMetadata(store, profileName, 20)` and generic `SelectionSession` storage.
- Produces: `KnowledgeStore.search({ sourceIds?: string[] })`, `createQueryKnowledgePostbackHandler`, and `createQueryKnowledgeTextMessageHandler`.

- [x] **Step 1: Write failing tests**

Add tests proving a body-only query searches the capped eligible IDs, unique top-source evidence answers, equal top-score cross-source evidence creates a requester-scoped selection, and postback/numeric selection replays the original query with only the opaque source ID.

- [x] **Step 2: Run the focused tests and verify RED**

Run: `pnpm test -- src/__tests__/query-knowledge.test.ts src/__tests__/agent-turn-runtime.test.ts src/__tests__/knowledge-postgres-store.test.ts`

Expected: FAIL because multi-source search and knowledge selection handlers do not exist.

- [x] **Step 3: Implement the minimal retrieval and selection flow**

Use this store filter contract:

```ts
search(input: {
  profileName: string;
  query: string;
  sourceIds?: string[];
  // existing optional scope fields
}): Promise<KnowledgeSearchResult[]>;
```

Persist ambiguity through `SelectionSession` with `action: "query_knowledge"`, generic `arguments`, and `items[index].id` equal to the opaque source UUID. Keep display names only in reply/session presentation state.

- [x] **Step 4: Re-run focused tests and verify GREEN**

Run the same focused command and require zero failures.

### Task 2: Atomic source snapshot publication

**Files:**

- Modify: `src/knowledge/store.ts`
- Modify: `src/knowledge/postgres-store.ts`
- Modify: `src/knowledge/migrations.ts`
- Modify: `src/knowledge/sync-service.ts`
- Test: `src/__tests__/knowledge-store.test.ts`
- Test: `src/__tests__/knowledge-postgres-store.test.ts`
- Test: `src/__tests__/knowledge-migrations.test.ts`

**Interfaces:**

- Consumes: staged source configuration and fully prepared Notion documents/chunks/vectors.
- Produces: `KnowledgeStore.publishSourceSnapshot(input): Promise<KnowledgeSourceRecord>`.

- [x] **Step 1: Write failing atomicity tests**

Cover fetch failure, document preparation failure, PostgreSQL statement failure/rollback, re-add of disabled or expired sources, and the absence of partially searchable documents.

- [x] **Step 2: Run store/sync tests and verify RED**

Run: `pnpm test -- src/__tests__/knowledge-store.test.ts src/__tests__/knowledge-postgres-store.test.ts src/__tests__/knowledge-migrations.test.ts src/__tests__/knowledge-admin-actions.test.ts`

Expected: FAIL because source staging mutates live core fields and sync publishes documents incrementally.

- [x] **Step 3: Implement staged core fields and one-shot publication**

The publish input carries the expected staging revision, complete document inputs, optional prepared embeddings, promoted routing fields, status, and sync time. PostgreSQL publication must acquire a client and execute `BEGIN`, all replacement writes, the checked source promotion, then `COMMIT`; any error executes `ROLLBACK` and rethrows.

- [x] **Step 4: Re-run store/sync tests and verify GREEN**

Run the same focused command and require zero failures.

### Task 3: Conservative multiword Latin metadata matching

**Files:**

- Modify: `src/knowledge/routing-metadata.ts`
- Test: `src/__tests__/knowledge-routing-metadata.test.ts`

**Interfaces:**

- Consumes: normalized Latin token arrays from query and metadata terms.
- Produces: exact contiguous token-sequence matching for multiword and hyphenated terms.

- [x] **Step 1: Write tests and verify RED**

Add `Alpha Course` / `alpha-course` positive cases and non-contiguous/short-term/source-key negative cases, then run `pnpm test -- src/__tests__/knowledge-routing-metadata.test.ts`.

- [x] **Step 2: Implement and verify GREEN**

Split Latin text on punctuation/hyphens, require the normalized metadata token sequence to occur contiguously, retain the existing single-token length rule, and keep source-key matching exact.

### Task 4: Separate sync health from audit persistence

**Files:**

- Modify: `src/actions/admin-registry.ts`
- Test: `src/__tests__/knowledge-admin-actions.test.ts`

**Interfaces:**

- Consumes: successful `syncKnowledgeSource` result and existing `AccessStore.recordAudit` fail-closed behavior.
- Produces: success auditing outside the sync failure catch boundary.

- [x] **Step 1: Write tests and verify RED**

Make `recordAudit` reject after successful add/sync and assert the action rejects while the promoted source remains `ready` with its successful `lastSyncedAt`.

- [x] **Step 2: Move only audit persistence outside the sync catch and verify GREEN**

Keep sanitized failed-sync auditing inside the failure branch; do not catch a successful promotion's audit exception as a remote sync failure.

### Task 5: Full verification, documentation, and commit

**Files:**

- Modify: `README.md`
- Modify: `docs/architecture-context.md`
- Modify: `.superpowers/sdd/task-9-implementer-report.md`

**Interfaces:**

- Consumes: completed Tasks 1-4.
- Produces: checked local commit and exact report SHA.

- [x] **Step 1: Run the complete gate**

Run targeted Prettier plus `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm eval:router`, `pnpm eval:admin`, and `git diff --check`.

- [x] **Step 2: Update the Task 9 report**

Record the five fixes, RED/GREEN evidence, exact test counts, intentional design decisions, and no-push status.

- [x] **Step 3: Stage, inspect, and commit**

Run `git diff --cached --check`, inspect the staged file list, commit with `fix: make knowledge snapshots atomic`, and report the exact hash without pushing.
