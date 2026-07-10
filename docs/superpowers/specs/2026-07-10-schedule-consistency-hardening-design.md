# Schedule Consistency Hardening Design

## Status

Approved for implementation planning.

## Context

The helper profile stores structured service schedules in PostgreSQL and exposes them through one controlled `query_schedule` / `save_schedule` surface. Schedules are profile-shared, retained for one year, and canonical per `profile_name + schedule_type + period_key`.

The current implementation can parse and save schedules, but replacement consists of multiple independent PostgreSQL statements, confirmation re-runs natural-language target matching, and a pasted schedule spanning multiple months is keyed only by its first month. Those behaviors can produce partial writes, stale confirmations, or incorrect canonical replacement.

There is no existing schedule data to convert. This change requires schema evolution only; it must not include data migration or compatibility code for old schedule records.

## Goals

- Split a pasted schedule into independent monthly canonical schedules.
- Commit every month from one pasted message atomically.
- Detect stale confirmations with optimistic concurrency.
- Keep a canonical schedule row stable across full replacements.
- Bind confirmations to exact schedule and entry IDs instead of re-running natural-language search.
- Provide a safe selection step when a mutation matches multiple entries.
- Make in-memory and PostgreSQL stores follow the same observable semantics.
- Verify transaction and concurrency behavior against a real PostgreSQL instance in CI.

## Non-goals

- Migrating, repartitioning, or backfilling existing schedule data.
- LINE-to-church-account identity binding.
- Schedule edit history, event sourcing, or user-facing revision history.
- Redis or application-level distributed locks.
- Adding new schedule types or new end-user capabilities.

## Data Model

`agent_schedule_memories` remains the canonical schedule table. Add:

- `revision integer not null default 1`
- `updated_at timestamptz not null default now()`

Keep the active canonical uniqueness rule on:

```text
profile_name + schedule_type + period_key
```

The canonical row ID remains unchanged when a full schedule is replaced. A successful replacement updates the row, replaces its active entries, increments `revision`, and refreshes `updated_at` and the one-year expiry.

Entry add, update, and delete operations increment the parent schedule revision in the same transaction. Deleting a whole schedule soft-deletes the canonical row and increments its revision.

The schema migration only adds columns and constraints required by the new code. It contains no data transformation statements beyond PostgreSQL defaults needed to make the new columns valid.

## Parsing And Monthly Partitioning

Parsing continues to produce normalized entries with `serviceDate` in `YYYY-MM-DD` form. Before previewing or saving, entries are grouped by:

```text
scheduleType + serviceDate.slice(0, 7)
```

Each group becomes one replacement unit containing:

- `scheduleType`
- `periodKey`
- title
- original pasted text
- entries for that month only

One pasted message may therefore preview and replace multiple canonical schedules. The preview lists each month separately and states whether it will create a new canonical schedule or replace an existing named schedule.

Headers and explanatory lines continue to be ignored. A line is considered entry-shaped when it begins with a recognizable month/day token. If any entry-shaped line has an invalid calendar date or no usable assignee, the whole request is rejected before a confirmation session is created. The bot never saves only the valid subset of a malformed paste.

## Preview State

Preview resolves current database state and stores an immutable write snapshot in the existing requester-scoped pending session. Each monthly replacement snapshot contains:

- canonical key: `profileName`, `scheduleType`, `periodKey`
- `scheduleId` and `expectedRevision` when a canonical row exists
- an explicit absent marker when no canonical row exists
- normalized replacement data

Entry mutations store:

- `scheduleId`
- `entryId`
- `expectedRevision` of the parent schedule
- the exact normalized change or delete operation

The confirmation message only selects the stored pending operation. It must not re-run natural-language search or rebuild mutation arguments from the confirmation text.

## Multi-match Selection

An entry mutation that matches more than one active entry does not create a confirmation immediately. It creates a requester-scoped selection session and returns numbered LINE Quick Replies containing concise date, meeting, and assignee labels.

After the requester selects one entry, the runtime resolves its exact IDs and current parent revision, then produces the normal before/after preview. A selection made by another requester or after session expiry is rejected by the existing session-safety rules.

## PostgreSQL Transaction Flow

Full replacements use one store operation accepting all monthly replacement units. The implementation performs one PostgreSQL transaction:

1. Sort canonical keys deterministically to reduce deadlock risk.
2. Load existing canonical rows for those keys with `SELECT ... FOR UPDATE`.
3. Compare every row with the preview snapshot:
   - existing snapshots require the same active row ID and revision;
   - absent snapshots require no active row.
4. If any snapshot is stale, roll back the entire transaction and return a conflict result.
5. Update existing canonical rows in place or insert new canonical rows.
6. Delete the previous entries for each affected canonical row and insert the complete replacement set. Entry history is not retained.
7. Increment revisions for updated rows and commit.

The existing unique active canonical index is the final guard for concurrent creation of a previously absent month. A unique conflict is translated to the same stale-preview domain result and rolls back all months.

Entry mutations use one transaction:

1. Lock the parent canonical schedule row.
2. Verify `expectedRevision` and active state.
3. Verify the exact entry belongs to that schedule and is active.
4. Apply the entry mutation.
5. Increment the parent revision and commit.

No Redis lock is added. PostgreSQL transactions, row locks, revision checks, and the unique constraint are the only consistency mechanisms.

## Store Contract

The store returns explicit outcomes instead of relying on generic exceptions for expected races:

- `applied`
- `conflict`
- `not_found`

Unexpected PostgreSQL failures still throw and follow the existing sanitized error path.

The in-memory store implements the same input snapshots and outcomes. It does not need to emulate SQL locks, but it must reject stale revisions and apply a multi-month replacement as an all-or-nothing state change.

## User-facing Error Behavior

- Stale revision or concurrent canonical creation: `服事表已被更新，請重新操作。`
- Target schedule or entry no longer active: `這筆服事已不存在，請重新查詢。`
- Invalid or partially unparseable pasted content: retain the existing clarification response and save nothing.
- Unexpected database failure: retain the generic sanitized request-failed response and record only safe diagnostics.

Conflict responses do not reveal user IDs, database IDs, revisions, SQL errors, or internal storage names.

## Authorization And Audit Boundaries

Function grants and write authorization remain unchanged. The change does not make `save_schedule` available to additional users or groups.

Pending confirmations and selection sessions remain scoped by profile, LINE source, and requester. Exact schedule and entry IDs are server-side session state and are never trusted from arbitrary LINE message text.

## Verification

### Unit And Runtime Tests

- Parser groups a cross-month paste into the correct monthly units.
- Preview labels each month as create or replace.
- Pending confirmation stores exact IDs and expected revisions.
- Confirmation does not re-run target matching.
- Multi-match mutation requires requester-scoped selection before preview.
- In-memory stale confirmation rejects without changing state.
- Any invalid entry prevents all monthly units from being saved.
- Existing routing, access, entrance, and query behavior remains covered.

### PostgreSQL Integration Tests

Add a focused Vitest integration suite using the existing `pg` dependency and a `TEST_DATABASE_URL`. Azure Pipelines starts a disposable `postgres:17-alpine` service and runs the suite explicitly; CI must not silently skip it.

The suite verifies:

- atomic cross-month replacement;
- stable canonical row IDs across replacement;
- revision increments for full and entry-level mutations;
- stale confirmation rejection;
- concurrent creation leaves one canonical row and returns one conflict;
- a failure in one month rolls back every month;
- delete/update against an inactive entry returns `not_found`.

No ORM, testcontainers dependency, or production database access is introduced.

## Rollout

1. Apply the schema migration during normal application startup.
2. Deploy the code and run readiness checks through the existing Azure pipeline.
3. Verify the PostgreSQL integration suite, normal test suite, router eval, and build before deployment.
4. Smoke-test one cross-month preview and cancellation without persisting data.
5. Save a controlled cross-month schedule, query both months, and verify conflict behavior with a deliberately stale preview.

Because there is no existing schedule data, rollout requires no backfill, repair job, or compatibility window.

## Acceptance Criteria

- A July/August paste creates or replaces separate July and August canonical schedules.
- Both months commit together or neither month changes.
- A confirmation created before another successful edit cannot overwrite the newer edit.
- Confirmations modify the exact previewed IDs without another natural-language lookup.
- Concurrent creation cannot leave duplicate active canonical schedules.
- Multi-match edits require an explicit requester-scoped selection.
- All expected conflicts produce controlled Traditional Chinese replies.
- CI validates the concurrency behavior using real PostgreSQL.
