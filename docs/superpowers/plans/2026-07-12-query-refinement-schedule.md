# Query Refinement And Schedule Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable query-refinement contract and use it to answer schedule questions with structured filters without accidentally requiring the full natural-language sentence to appear in stored rows.

**Architecture:** A small generic helper represents structured arguments, consumed terms, and residual text. A schedule-specific adapter extracts date intent, meeting, role, and schedule category; `query_schedule` uses the residual only for text search and the structured values for store filters.

**Tech Stack:** TypeScript 5, Zod 4, Vitest 4, PostgreSQL, in-memory stores, pnpm.

## Global Constraints

- Do not expose Notion, PostgreSQL, memory-store names, or catalog source keys in user replies.
- Preserve existing clarification, access, requester-scope, and function-toggle behavior.
- Do not migrate PPT, sheet-music, Wikipedia, or generic resource search in this plan.
- Use red-green TDD and commit only this plan's files together.
- Do not push `main` without explicit deployment authorization.

---

### Task 1: Query Refinement Contract

**Files:**

- Create: `src/functions/query-refinement.ts`
- Create: `src/__tests__/query-refinement.test.ts`

**Interfaces:**

- Produces: `QueryRefinement<TArguments>` and `buildResidualQuery`.

```ts
import type { JsonRecord } from "../types.js";

export interface QueryRefinement<TArguments extends JsonRecord = JsonRecord> {
  originalQuery: string;
  structuredArguments: TArguments;
  consumedTerms: string[];
  residualQuery: string;
}

export function buildResidualQuery(input: {
  query: string;
  consumedTerms: string[];
  genericTerms?: string[];
}): string;
```

- [ ] **Step 1: Write failing generic refinement tests**

```ts
it("removes consumed phrases while preserving unknown search text", () => {
  expect(
    buildResidualQuery({
      query: "小哈 給我下一場青年影視團隊服事表",
      consumedTerms: ["下一場", "影視團隊"],
      genericTerms: ["小哈", "給我", "服事表"]
    })
  ).toBe("青年");
});

it("returns an empty residual instead of a generic capability phrase", () => {
  expect(
    buildResidualQuery({
      query: "下一場服事表的音控是誰",
      consumedTerms: ["下一場", "音控"],
      genericTerms: ["服事表", "的", "是誰"]
    })
  ).toBe("");
});
```

- [ ] **Step 2: Run the tests and verify the expected missing-module failure**

Run: `pnpm vitest run src/__tests__/query-refinement.test.ts`

Expected: FAIL because `query-refinement.ts` does not exist.

- [ ] **Step 3: Implement deterministic residual cleanup**

Implement `buildResidualQuery` so it NFKC-normalizes input, removes escaped terms longest-first, removes punctuation and repeated whitespace, trims leading/trailing `的`, and returns remaining text. It must not contain schedule-specific terms internally.

- [ ] **Step 4: Run the targeted tests**

Run: `pnpm vitest run src/__tests__/query-refinement.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the generic contract**

```bash
git add src/functions/query-refinement.ts src/__tests__/query-refinement.test.ts
git commit -m "feat: add query refinement contract"
```

### Task 2: Schedule Refinement Adapter

**Files:**

- Create: `src/functions/schedule-query-refinement.ts`
- Modify: `src/function-arguments.ts`
- Modify: `src/functions/query-service-schedule.ts`
- Test: `src/__tests__/query-refinement.test.ts`
- Test: `src/__tests__/function-argument-normalization.test.ts`

**Interfaces:**

- Consumes: `QueryRefinement<QueryScheduleStructuredArguments>`.
- Produces: `refineScheduleQuery`.

```ts
export type ScheduleCategory = "media_team" | "saved_schedule";

export interface QueryScheduleStructuredArguments extends JsonRecord {
  date?: string;
  dateIntent?: QueryScheduleArguments["dateIntent"];
  specificDate?: string;
  meeting?: string;
  role?: string;
  scheduleType?: QueryScheduleArguments["scheduleType"];
  scheduleCategory?: ScheduleCategory;
}

export function refineScheduleQuery(
  args: QueryScheduleArguments,
  now: Date,
  timeZone: string
): QueryRefinement<QueryScheduleStructuredArguments>;
```

- [ ] **Step 1: Add failing schedule refinement cases**

```ts
it.each([
  [
    { query: "給我下一場影視團隊的服事表" },
    { dateIntent: "next_meeting", scheduleCategory: "media_team", residualQuery: "" }
  ],
  [
    { query: "下一場服事表的音控是誰" },
    { dateIntent: "next_meeting", role: "音控", residualQuery: "" }
  ],
  [{ query: "下一場青年服事表" }, { dateIntent: "next_meeting", residualQuery: "青年" }]
])("refines schedule query %#", (args, expected) => {
  expect(refineScheduleQuery(args, now, "Asia/Taipei")).toMatchObject(expected);
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `pnpm vitest run src/__tests__/query-refinement.test.ts src/__tests__/function-argument-normalization.test.ts`

Expected: FAIL because the schedule adapter and category type are missing.

- [ ] **Step 3: Implement the schedule adapter**

The adapter must:

- preserve already-valid model arguments;
- infer today/tomorrow/day-after-tomorrow/this-week/next-meeting/specific date from the original query when missing;
- reuse the existing known-role vocabulary from `query-service-schedule.ts` through an exported helper, not a duplicated list;
- map `影視團隊`, `影音團隊`, `媒體團隊`, and `影視` to `media_team`;
- map `晨更`/`仙履奇緣` and `舉牌`/`為耶穌` to the existing schedule types;
- mark every recognized phrase as consumed;
- pass the consumed terms plus generic request/question terms to `buildResidualQuery`.

- [ ] **Step 4: Keep router argument normalization compatible**

`normalizeFunctionArguments` must continue adding deterministic `dateIntent` evidence for route observability, but handler-level refinement remains authoritative. Do not place internal source keys in router arguments.

- [ ] **Step 5: Run targeted tests**

Run: `pnpm vitest run src/__tests__/query-refinement.test.ts src/__tests__/function-argument-normalization.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the schedule adapter**

```bash
git add src/functions/schedule-query-refinement.ts src/function-arguments.ts src/functions/query-service-schedule.ts src/__tests__/query-refinement.test.ts src/__tests__/function-argument-normalization.test.ts
git commit -m "feat: refine structured schedule queries"
```

### Task 3: Apply Refinement To Both Schedule Stores

**Files:**

- Modify: `src/functions/query-schedule.ts`
- Modify: `src/functions/schedule-memory.ts`
- Modify: `src/schedules/store.ts`
- Modify: `src/schedules/postgres-store.ts`
- Test: `src/__tests__/query-schedule.test.ts`
- Test: `src/__tests__/schedule-memory.test.ts`

**Interfaces:**

- Consumes: `refineScheduleQuery`.
- Produces: structured store calls where `query` is residual text only.

- [ ] **Step 1: Add failing end-to-end handler tests**

Seed a future media row with `meeting="主日"`, `role="音控"`, and `assignee="Ray"`, then assert:

```ts
await expect(
  query({ query: "給我下一場影視團隊的服事表" }, context("給我下一場影視團隊的服事表"))
).resolves.toMatchObject({ replyText: expect.stringContaining("音控：Ray") });

await expect(
  query({ query: "下一場服事表的音控是誰" }, context("下一場服事表的音控是誰"))
).resolves.toMatchObject({ replyText: expect.stringContaining("音控：Ray") });
```

Also seed a LINE-saved custom schedule titled `青年出隊服事表` and verify `下一場青年出隊服事表` finds only that schedule.

- [ ] **Step 2: Run tests and confirm the current false-negative behavior**

Run: `pnpm vitest run src/__tests__/query-schedule.test.ts src/__tests__/schedule-memory.test.ts`

Expected: FAIL with `查不到符合的服事表。` for the new cases.

- [ ] **Step 3: Pass residual text and structured filters separately**

In `createQueryScheduleHandler`, compute refinement once per request. Pass `residualQuery || undefined` to text search, merge structured arguments into `deriveFilters`, and restrict `sourceKeys` only when `scheduleCategory === "media_team"`. Pass residual text plus structured schedule type/date/meeting to the memory handler.

Do not change store matching semantics except that a missing/empty query creates no `normalized_search_text` condition.

- [ ] **Step 4: Run targeted schedule tests**

Run: `pnpm vitest run src/__tests__/query-schedule.test.ts src/__tests__/schedule-memory.test.ts src/__tests__/schedule-sync-service.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit schedule integration**

```bash
git add src/functions/query-schedule.ts src/functions/schedule-memory.ts src/schedules/store.ts src/schedules/postgres-store.ts src/__tests__/query-schedule.test.ts src/__tests__/schedule-memory.test.ts
git commit -m "fix: use structured filters for schedule lookup"
```

### Task 4: Router Evals, Documentation, And Full Verification

**Files:**

- Modify: `src/functions/modules.ts`
- Modify: `src/__tests__/router.test.ts`
- Modify: `README.md`
- Modify: `docs/architecture-context.md`

- [ ] **Step 1: Add deterministic router/eval cases**

Add positive cases for the media-team and role questions, a custom-title case, a missing-slot case, and cross-function negatives proving PPT/sheet-music intent is unchanged.

- [ ] **Step 2: Run router tests and offline eval**

Run: `pnpm vitest run src/__tests__/router.test.ts src/__tests__/router-evals.test.ts`

Run: `pnpm eval:router`

Expected: all cases pass with no live Ollama dependency.

- [ ] **Step 3: Document the reusable contract**

Document that structured terms are consumed before residual text search, the schedule adapter is the first adopter, and future functions need their own adapter rather than adding router special cases.

- [ ] **Step 4: Run the complete repository verification stack**

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm eval:router
pnpm build
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 5: Commit docs and eval coverage**

```bash
git add src/functions/modules.ts src/__tests__/router.test.ts README.md docs/architecture-context.md
git commit -m "test: cover refined schedule queries"
```

## Acceptance Criteria

- Both reported production phrases return the matching schedule.
- Custom LINE-saved schedule titles remain searchable.
- Empty residual text never becomes a full-text condition.
- Other function families are behaviorally unchanged.
- No raw query or internal source identifier is added to diagnostics.
