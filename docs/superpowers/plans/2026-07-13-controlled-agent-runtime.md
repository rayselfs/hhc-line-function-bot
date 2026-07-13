# Controlled Agent Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace function-specific route recovery with a DeepSeek-primary, deterministically validated agent flow that supports production-shaped schedules and arbitrary registered church knowledge.

**Architecture:** Preserve LINE entrance, profile/access policy, the function registry, Redis requester scope, catalog/knowledge stores, and grounded answer generation. Add typed result envelopes and active tasks, normalize source data at adapters, generate a bounded capability candidate set, let DeepSeek propose a plan with Ollama fallback, and validate every plan before executing a function. Ship behind a profile flag, shadow first, then remove schedule-specific top-level recovery after schedule and knowledge pass end-to-end acceptance.

**Tech Stack:** TypeScript 5.9, Node.js 24, Fastify 5, Zod 4, PostgreSQL/pgvector, Redis, Vitest 4, Ollama, DeepSeek OpenAI-compatible API, LINE SDK, Notion SDK.

## Global Constraints

- The bot remains a restricted church helper, not an open-ended autonomous chatbot.
- DeepSeek is primary and Ollama is fallback only for the semantic planner; deterministic code remains the execution authority.
- Never feed raw whole-group chat, full knowledge documents, secrets, tokens, sharing links, or raw files into planner context or traces.
- Profile, effective function grants, source policy, side-effect policy, required slots, and confirmation remain mandatory gates.
- New code must not add function-name branches to `src/agent/turn-runtime.ts`, `src/agent/function-intent-guard.ts`, or `src/agent/function-continuation.ts`.
- Source-specific parsing belongs in adapters; query, continuation, and presentation consume canonical records.
- Active task state remains scoped by `profileName/sourceKey/requesterUserId` and expires absolutely without small-talk refresh.
- A failed or not-found refinement preserves the last successful active task unless its capability contract opts out.
- New knowledge topics use `query_knowledge`; they do not add travel-, SOP-, or ministry-specific functions.
- All behavior changes use TDD and production-shaped fixtures.
- Use `pnpm` scripts and Node.js `>=24 <25`.
- Before deployment run `pnpm format:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm eval:router`, `pnpm build`, and live planner evaluations.
- Pushing app changes to `main` is a production deployment action; execute it only after the complete plan passes verification.

## File Structure

Create these focused runtime files:

- `src/agent/result-envelope.ts`: structured read-function result types and legacy compatibility.
- `src/agent/active-task.ts`: active-task schema, derivation from validated result envelopes, and invalidation rules.
- `src/agent/capability-candidates.ts`: deterministic bounded candidate generation.
- `src/agent/planner.ts`: strict planner schema, prompt, DeepSeek/Ollama provider fallback, and diagnostics.
- `src/agent/plan-validator.ts`: evidence, policy, candidate, and argument validation.
- `src/agent/controlled-agent-router.ts`: candidate → planner → validator orchestration behind the profile flag.
- `src/schedules/model.ts`: canonical schedule meeting and assignment types.
- `src/schedules/notion-adapter.ts`: Notion row normalization, multiline roster parsing, derived external keys, and sanitized diagnostics.
- `src/knowledge/routing-metadata.ts`: bounded aliases/topics/sample-query metadata.

Modify these existing boundaries:

- `src/types.ts`, `src/config.ts`, `config/profiles.json`: controlled-agent config and result/active-task integration.
- `src/functions/definitions.ts`: declarative capability contracts.
- `src/agent/context-manager.ts`: versioned active-task persistence with legacy read compatibility.
- `src/agent/turn-runtime.ts`: call the controlled router and record generic trace phases.
- `src/schedules/store.ts`, `src/schedules/postgres-store.ts`, `src/schedules/migrations.ts`, `src/schedules/notion-sync.ts`: derived assignment persistence and tombstoning.
- `src/functions/query-schedule.ts`, `src/functions/query-service-schedule.ts`, `src/functions/schedule-memory.ts`: canonical schedule execution and envelopes.
- `src/knowledge/store.ts`, `src/knowledge/postgres-store.ts`, `src/knowledge/migrations.ts`, `src/actions/admin-registry.ts`, `src/functions/query-knowledge.ts`: dynamic source routing metadata and knowledge envelopes.
- `src/agent/trace-store.ts`, `src/observability/*`: sanitized planner boundary diagnostics.
- `src/tools/eval-router.ts`, new `src/tools/eval-agent-planner.ts`, `package.json`: deterministic and live planner evals.

---

### Task 1: Add controlled-agent configuration and provider policy

**Files:**

- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `config/profiles.json`
- Modify: `src/__tests__/config.test.ts`
- Modify: `README.md`

**Interfaces:**

- Produces: `ControlledAgentConfig { enabled: boolean; shadow: boolean; maxCandidates: number; minPlannerConfidence: number }`
- Produces: helper `function_routing` policy `{ primary: "deepseek", fallback: "ollama" }`
- Consumes: existing profile provider allowlist and `normalizeProviderPolicy`

- [ ] **Step 1: Write failing configuration tests**

Add tests that assert the default is disabled and the production helper profile uses DeepSeek primary:

```ts
it("defaults the controlled agent off", () => {
  const config = loadConfigFromEnv(baseEnv());
  expect(config.profiles[0]!.controlledAgent).toEqual({
    enabled: false,
    shadow: false,
    maxCandidates: 3,
    minPlannerConfidence: 0.65
  });
});

it("allows a DeepSeek-primary controlled planner", async () => {
  await withProfileFile(
    [
      {
        name: "helper",
        webhookPath: "/api/line/webhook/helper",
        channelSecret: "secret",
        channelAccessToken: "token",
        allowedProviders: ["ollama", "deepseek"],
        providerPolicy: {
          function_routing: { primary: "deepseek", fallback: "ollama" }
        },
        controlledAgent: {
          enabled: true,
          shadow: false,
          maxCandidates: 3,
          minPlannerConfidence: 0.65
        }
      }
    ],
    async (path) => {
      const config = loadConfigFromEnv({ PROFILE_CONFIG_PATH: path });
      expect(config.profiles[0]!.providerPolicy!.function_routing).toEqual({
        primary: "deepseek",
        fallback: "ollama"
      });
    }
  );
});
```

- [ ] **Step 2: Run the tests and verify the expected failure**

Run: `pnpm test -- src/__tests__/config.test.ts`

Expected: FAIL because `controlledAgent` is absent and helper routing still uses Ollama.

- [ ] **Step 3: Add the profile type and Zod schema**

Add to `src/types.ts`:

```ts
export interface ControlledAgentConfig {
  enabled: boolean;
  shadow: boolean;
  maxCandidates: number;
  minPlannerConfidence: number;
}
```

Add `controlledAgent: ControlledAgentConfig` to `BotProfileConfig`. Add to `profileSchema` in `src/config.ts`:

```ts
controlledAgent: z
  .object({
    enabled: z.boolean().default(false),
    shadow: z.boolean().default(false),
    maxCandidates: z.number().int().min(1).max(5).default(3),
    minPlannerConfidence: z.number().min(0).max(1).default(0.65)
  })
  .default({
    enabled: false,
    shadow: false,
    maxCandidates: 3,
    minPlannerConfidence: 0.65
  }),
```

Update `config/profiles.json` with:

```json
"controlledAgent": {
  "enabled": false,
  "shadow": true,
  "maxCandidates": 3,
  "minPlannerConfidence": 0.65
},
"providerPolicy": {
  "function_routing": {
    "primary": "deepseek",
    "fallback": "ollama"
  }
}
```

Preserve every other existing provider lane exactly.

- [ ] **Step 4: Document the flag and provider authority boundary**

Add README text stating that shadow mode records sanitized planner outcomes without changing execution and that DeepSeek proposals never bypass deterministic policy.

- [ ] **Step 5: Run focused verification**

Run: `pnpm test -- src/__tests__/config.test.ts && pnpm config:validate && pnpm typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/config.ts config/profiles.json src/__tests__/config.test.ts README.md
git commit -m "feat: configure controlled agent planner"
```

### Task 2: Introduce structured result envelopes and versioned active tasks

**Files:**

- Create: `src/agent/result-envelope.ts`
- Create: `src/agent/active-task.ts`
- Modify: `src/types.ts`
- Modify: `src/agent/context-manager.ts`
- Test: `src/__tests__/active-task.test.ts`
- Test: `src/__tests__/function-continuation.test.ts`

**Interfaces:**

- Produces: `AgentResultEnvelope`, `AgentEntity`, `ActiveTaskContext`
- Produces: `activeTaskFromResult(functionName, result, now, ttlMs)`
- Produces: `ConversationWindowStore.recordActiveTask`, `activeTask`, `clearActiveTask`
- Preserves: legacy continuation methods until Task 9 removes schedule-specific callers

- [ ] **Step 1: Write failing envelope and active-task tests**

```ts
it("derives an active task only from a successful structured result", () => {
  const task = activeTaskFromResult(
    "query_schedule",
    {
      ok: true,
      replyText: "前攝影：姵穎、佳美",
      agentResult: {
        status: "success",
        replyText: "前攝影：姵穎、佳美",
        anchors: { date: "2026-07-14", meeting: "晨更" },
        entities: [
          {
            type: "role",
            key: "front-camera",
            label: "前攝影",
            aliases: ["攝影"]
          }
        ],
        supportedOperations: ["continue", "refine", "advance"]
      }
    },
    new Date("2026-07-13T00:00:00.000Z"),
    60_000
  );
  expect(task).toEqual({
    version: 1,
    capability: "query_schedule",
    anchors: { date: "2026-07-14", meeting: "晨更" },
    entities: [{ type: "role", key: "front-camera", label: "前攝影", aliases: ["攝影"] }],
    supportedOperations: ["continue", "refine", "advance"],
    createdAt: "2026-07-13T00:00:00.000Z",
    expiresAt: "2026-07-13T00:01:00.000Z"
  });
});

it("preserves the previous active task after a not-found refinement", async () => {
  await store.recordActiveTask({ scope, task: previousTask, ttlMs: 60_000 });
  await expect(store.activeTask(scope)).resolves.toEqual(previousTask);
});
```

- [ ] **Step 2: Run tests and verify missing interfaces**

Run: `pnpm test -- src/__tests__/active-task.test.ts src/__tests__/function-continuation.test.ts`

Expected: FAIL with missing `activeTaskFromResult` and store methods.

- [ ] **Step 3: Implement the result envelope types**

Create `src/agent/result-envelope.ts`:

```ts
import type { JsonRecord, QuickReplyItem } from "../types.js";

export type AgentResultStatus = "success" | "not_found" | "ambiguous" | "unavailable";

export interface AgentEntity {
  type: string;
  key: string;
  label: string;
  aliases?: string[];
}

export interface AgentResultEnvelope {
  status: AgentResultStatus;
  anchors?: JsonRecord;
  entities?: AgentEntity[];
  evidence?: Array<{ kind: string; reference: JsonRecord }>;
  supportedOperations?: string[];
  clarification?: { prompt: string; choices?: string[] };
  replyText: string;
  quickReplies?: QuickReplyItem[];
}
```

Add `agentResult?: AgentResultEnvelope` to `FunctionExecutionResult` in `src/types.ts`.

- [ ] **Step 4: Implement active-task derivation**

Create `src/agent/active-task.ts` with strict bounded copying:

```ts
import type { FunctionExecutionResult, FunctionName, JsonRecord } from "../types.js";
import type { AgentEntity } from "./result-envelope.js";

export interface ActiveTaskContext {
  version: 1;
  capability: FunctionName;
  anchors: JsonRecord;
  entities: AgentEntity[];
  references?: JsonRecord;
  supportedOperations: string[];
  createdAt: string;
  expiresAt: string;
}

export function activeTaskFromResult(
  capability: FunctionName,
  result: FunctionExecutionResult,
  now: Date,
  ttlMs: number
): ActiveTaskContext | undefined {
  if (!result.ok || result.agentResult?.status !== "success") return undefined;
  return {
    version: 1,
    capability,
    anchors: result.agentResult.anchors ?? {},
    entities: (result.agentResult.entities ?? []).slice(0, 20),
    references: result.agentResult.evidence?.[0]?.reference,
    supportedOperations: (result.agentResult.supportedOperations ?? []).slice(0, 8),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString()
  };
}
```

- [ ] **Step 5: Add active-task persistence while retaining legacy methods**

Extend `ConversationWindowStore` with `recordActiveTask`, `activeTask`, and `clearActiveTask`. Use a new Redis key suffix `active-task-v1`. Do not reuse the legacy continuation key. Sanitize anchors, labels, aliases, references, and operation names with the existing size limits.

- [ ] **Step 6: Run focused verification**

Run: `pnpm test -- src/__tests__/active-task.test.ts src/__tests__/function-continuation.test.ts && pnpm typecheck`

Expected: PASS, including requester isolation and absolute expiry.

- [ ] **Step 7: Commit**

```bash
git add src/agent/result-envelope.ts src/agent/active-task.ts src/types.ts src/agent/context-manager.ts src/__tests__/active-task.test.ts src/__tests__/function-continuation.test.ts
git commit -m "feat: add structured agent task state"
```

### Task 3: Normalize production-shaped Notion schedules

**Files:**

- Create: `src/schedules/model.ts`
- Create: `src/schedules/notion-adapter.ts`
- Modify: `src/schedules/store.ts`
- Modify: `src/schedules/migrations.ts`
- Modify: `src/schedules/postgres-store.ts`
- Modify: `src/schedules/notion-sync.ts`
- Test: `src/__tests__/schedule-notion-adapter.test.ts`
- Test: `src/__tests__/schedule-sync-service.test.ts`
- Test: `src/__tests__/stores.test.ts`

**Interfaces:**

- Produces: `ScheduleMeeting`, `ScheduleAssignment`
- Produces: `normalizeNotionSchedulePage(input): NormalizedSchedulePage`
- Adds: `ScheduleItemInput.externalKey?: string`
- Replaces Notion tombstoning with `tombstoneMissingExternalKeys`

- [ ] **Step 1: Write production-shaped failing tests**

Use the exact production shape:

```ts
it("splits a multiline roster into canonical assignments", () => {
  expect(
    normalizeNotionSchedulePage({
      pageId: "page-1",
      serviceDate: "2026-07-14",
      meeting: "7月14日(二) 晨更",
      role: "",
      person: [
        "音控: 資恆",
        "導播: 莘凌",
        "投影電腦: 家怡",
        "前攝影: 姵穎,佳美",
        "手機拍照: 阿達,銹姐"
      ].join("\n")
    })
  ).toMatchObject({
    malformedLines: 0,
    meeting: {
      serviceDate: "2026-07-14",
      meeting: "7月14日(二) 晨更",
      assignments: [
        { role: "音控", assignees: ["資恆"] },
        { role: "導播", assignees: ["莘凌"] },
        { role: "投影電腦", assignees: ["家怡"] },
        { role: "前攝影", assignees: ["姵穎", "佳美"] },
        { role: "手機拍照", assignees: ["阿達", "銹姐"] }
      ]
    }
  });
});

it("keeps a one-row role assignment canonical", () => {
  const result = normalizeNotionSchedulePage({
    pageId: "page-2",
    serviceDate: "2026-07-19",
    meeting: "主日",
    role: "音控",
    person: "Ray"
  });
  expect(result.meeting.assignments).toEqual([{ role: "音控", assignees: ["Ray"] }]);
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm test -- src/__tests__/schedule-notion-adapter.test.ts src/__tests__/schedule-sync-service.test.ts`

Expected: FAIL because the adapter and derived assignment keys do not exist.

- [ ] **Step 3: Implement canonical schedule types and parser**

Create `src/schedules/model.ts`:

```ts
export interface ScheduleAssignment {
  role: string;
  assignees: string[];
  notes?: string;
  aliases?: string[];
}

export interface ScheduleMeeting {
  sourceKey?: string;
  externalId?: string;
  serviceDate: string;
  meeting: string;
  scheduleType?: string;
  assignments: ScheduleAssignment[];
}
```

Create `src/schedules/notion-adapter.ts`. Split assignees with `/[,，、]/u`, split roster lines once at `/^(.+?)\s*[:：]\s*(.+)$/u`, normalize whitespace, and return malformed lines as `{ role: "服事", assignees: [line] }`. Generate an external key with `${pageId}:${index}:${normalizedRole}`.

- [ ] **Step 4: Add `external_key` storage migration**

Add idempotent SQL:

```sql
alter table schedule_items add column if not exists external_key text;
update schedule_items set external_key=external_id
where external_key is null and external_id is not null;
create index if not exists schedule_items_external_key_idx
on schedule_items (profile_name, source_key, origin, external_key)
where deleted_at is null;
```

Use `externalKey ?? externalId` in `scheduleItemIdentity`. Add `tombstoneMissingExternalKeys` to both in-memory and PostgreSQL stores; it tombstones active Notion rows whose non-null `external_key` is absent from the current derived key list.

- [ ] **Step 5: Change Notion sync to upsert one row per assignment**

For each normalized assignment, call:

```ts
await options.schedules.upsertItem({
  profileName: options.source.profileName,
  sourceKey: options.source.sourceKey,
  origin: "notion",
  externalId: page.id,
  externalKey: assignment.externalKey,
  serviceDate: normalized.meeting.serviceDate,
  meeting: normalized.meeting.meeting,
  role: assignment.role,
  assignee: assignment.assignees.join(",")
});
```

Count `upserted` as derived assignments and add `malformed` to the internal sync diagnostic result without exposing source content.

- [ ] **Step 6: Verify sync replacement and tombstoning**

Run: `pnpm test -- src/__tests__/schedule-notion-adapter.test.ts src/__tests__/schedule-sync-service.test.ts src/__tests__/stores.test.ts`

Expected: PASS; a multiline page produces five searchable rows, and a later sync that removes one roster line tombstones only that derived assignment.

- [ ] **Step 7: Commit**

```bash
git add src/schedules src/__tests__/schedule-notion-adapter.test.ts src/__tests__/schedule-sync-service.test.ts src/__tests__/stores.test.ts
git commit -m "fix: normalize notion schedule assignments"
```

### Task 4: Return schedule result envelopes and resolve roles from result entities

**Files:**

- Modify: `src/functions/query-schedule.ts`
- Modify: `src/functions/query-service-schedule.ts`
- Modify: `src/functions/schedule-memory.ts`
- Create: `src/functions/schedule-result.ts`
- Test: `src/__tests__/query-schedule.test.ts`
- Test: `src/__tests__/agent-turn-runtime.test.ts`

**Interfaces:**

- Produces: `scheduleResultEnvelope(rows, filters)`
- Produces entities: `{ type: "role", key, label, aliases }`
- Consumes normalized one-assignment-per-row schedule records from Task 3

- [ ] **Step 1: Add failing schedule envelope tests**

```ts
expect(result.agentResult).toEqual({
  status: "success",
  replyText: result.replyText,
  anchors: {
    date: "2026-07-14",
    meeting: "7月14日(二) 晨更",
    sourceKeys: ["media_team_service_schedule"]
  },
  entities: expect.arrayContaining([
    expect.objectContaining({ type: "role", label: "前攝影" }),
    expect.objectContaining({ type: "role", label: "導播" })
  ]),
  supportedOperations: ["continue", "refine", "advance"]
});
```

Add a test where `攝影是誰` has one entity alias match and another where both `前攝影` and `後攝影` exist and the result is `ambiguous` with choices.

- [ ] **Step 2: Verify failure**

Run: `pnpm test -- src/__tests__/query-schedule.test.ts`

Expected: FAIL because schedule handlers do not return `agentResult`.

- [ ] **Step 3: Implement schedule result construction**

Create `src/functions/schedule-result.ts` with one role entity per unique role. Entity keys use normalized role text, labels preserve display text, and aliases include only unambiguous suffixes such as `攝影` when exactly one current role contains it.

Return `not_found` instead of omitting the envelope when no rows match. Return `ambiguous` with a clarification prompt and role choices when partial role matching has multiple current-result candidates.

- [ ] **Step 4: Migrate all schedule read paths**

Make read-model, live Notion fallback, and saved schedule handlers return the same envelope schema. Preserve current `replyText`, quick replies, and legacy continuation during the compatibility period.

- [ ] **Step 5: Verify focused behavior**

Run: `pnpm test -- src/__tests__/query-schedule.test.ts src/__tests__/agent-turn-runtime.test.ts`

Expected: PASS for full roster, bare role, explicit role, partial unique role, ambiguity, next-meeting advance, saved schedules, and unrelated small talk.

- [ ] **Step 6: Commit**

```bash
git add src/functions/schedule-result.ts src/functions/query-schedule.ts src/functions/query-service-schedule.ts src/functions/schedule-memory.ts src/__tests__/query-schedule.test.ts src/__tests__/agent-turn-runtime.test.ts
git commit -m "feat: expose structured schedule results"
```

### Task 5: Add declarative capability contracts and deterministic candidates

**Files:**

- Modify: `src/functions/definitions.ts`
- Create: `src/agent/capability-candidates.ts`
- Test: `src/__tests__/capability-candidates.test.ts`
- Modify: `src/functions/modules.ts`

**Interfaces:**

- Produces: `AgentCapabilityContract`
- Produces: `buildCapabilityCandidates(input): CapabilityCandidate[]`
- Consumes: enabled functions, current text, active task, and bounded knowledge source metadata

- [ ] **Step 1: Write failing candidate tests**

Cover these exact outcomes:

```ts
expect(
  buildCapabilityCandidates({
    text: "前攝影",
    enabledFunctions: ["query_schedule", "query_knowledge"],
    activeTask: scheduleTask,
    knowledgeSources: [],
    maxCandidates: 3
  })
).toEqual([
  expect.objectContaining({ capability: "query_schedule", reason: "active_task_entity" })
]);

expect(
  buildCapabilityCandidates({
    text: "第一天去哪裡",
    enabledFunctions: ["query_schedule", "query_knowledge"],
    knowledgeSources: [
      { sourceKey: "retreat", displayName: "2026 青年出隊", aliases: ["出隊"], topics: ["第一天"] }
    ],
    maxCandidates: 3
  })
).toEqual([
  expect.objectContaining({ capability: "query_knowledge", reason: "knowledge_metadata" })
]);
```

Also test explicit schedule evidence outranks an active knowledge task, write intent cannot select a read function by continuation alone, and candidates never contain disabled functions.

- [ ] **Step 2: Verify failure**

Run: `pnpm test -- src/__tests__/capability-candidates.test.ts`

Expected: FAIL with missing contract and generator.

- [ ] **Step 3: Extend function definitions**

Add:

```ts
export interface AgentCapabilityContract {
  intents: string[];
  candidateHints: string[];
  entityTypes?: string[];
  refinableFields?: string[];
  operations?: Array<"continue" | "refine" | "advance" | "select">;
  ambiguity?: "clarify";
}
```

Declare contracts for every user-facing read function. Schedule declares date/meeting/role/scheduleType; knowledge declares source/document/section/ordinal; file finders declare query/type/selection; Wikipedia declares topic.

- [ ] **Step 4: Implement bounded candidate generation**

Return at most `maxCandidates`, ordered by explicit current-message evidence, active-task entity evidence, dynamic knowledge metadata, then capability hints. Include a sanitized reason enum and numeric score, but never raw matched text.

- [ ] **Step 5: Run tests and router evals**

Run: `pnpm test -- src/__tests__/capability-candidates.test.ts src/__tests__/router-evals.test.ts && pnpm eval:router`

Expected: PASS; existing router behavior remains unchanged because controlled execution is not enabled yet.

- [ ] **Step 6: Commit**

```bash
git add src/functions/definitions.ts src/functions/modules.ts src/agent/capability-candidates.ts src/__tests__/capability-candidates.test.ts
git commit -m "feat: declare agent capability candidates"
```

### Task 6: Implement the DeepSeek-primary semantic planner

**Files:**

- Create: `src/agent/planner.ts`
- Test: `src/__tests__/agent-planner.test.ts`
- Modify: `src/index.ts`
- Modify: `src/types.ts`

**Interfaces:**

- Produces: `AgentPlanProposal`
- Produces: `createAgentPlanner({ primary, fallback }): AgentPlanner`
- Consumes: existing profile-aware `ChatProvider` instances for `function_routing`

- [ ] **Step 1: Write failing planner tests**

Test strict schema parsing, unknown capability rejection, primary/fallback diagnostics, invalid JSON fallback, and absence of unrestricted retries.

```ts
const proposal = await planner.propose({
  profileName: "helper",
  text: "前攝影",
  candidates: [{ capability: "query_schedule", reason: "active_task_entity", score: 1 }],
  activeTask: scheduleTask
});
expect(proposal).toMatchObject({
  disposition: "continue",
  capability: "query_schedule",
  arguments: { role: "前攝影" },
  confidence: 0.95,
  provider: "deepseek"
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm test -- src/__tests__/agent-planner.test.ts`

Expected: FAIL because planner interfaces do not exist.

- [ ] **Step 3: Implement strict proposal parsing**

Use a strict Zod object whose disposition enum is `execute|continue|refine|advance|select|switch|clarify|chat|deny`, capability is optional but must be one of supplied candidates, arguments is a bounded flat record, references are bounded typed values, and confidence is required from 0 to 1.

The prompt must state that candidate actions are the only permitted functions, current-message evidence overrides active-task context, ambiguity means `clarify`, and write actions are not available unless included by deterministic candidates.

- [ ] **Step 4: Wire profile-aware DeepSeek then Ollama**

Reuse `functionRoutingPrimary` and `functionRoutingFallback` from `src/index.ts`. The helper profile config from Task 1 makes their resolved providers DeepSeek then Ollama. Do not create a new secret or provider client.

- [ ] **Step 5: Verify provider fallback**

Run: `pnpm test -- src/__tests__/agent-planner.test.ts && pnpm typecheck`

Expected: PASS; invalid DeepSeek JSON uses Ollama once, and dual failure returns a controlled planner failure result.

- [ ] **Step 6: Commit**

```bash
git add src/agent/planner.ts src/__tests__/agent-planner.test.ts src/index.ts src/types.ts
git commit -m "feat: add constrained semantic planner"
```

### Task 7: Validate planner proposals deterministically

**Files:**

- Create: `src/agent/plan-validator.ts`
- Test: `src/__tests__/plan-validator.test.ts`
- Modify: `src/functions/argument-normalization.ts`

**Interfaces:**

- Produces: `ValidatedAgentPlan`
- Produces: `validateAgentPlan(input): ValidatedAgentPlan`
- Consumes: candidate set, function definition, current text, active task, proposal, source type, and confidence threshold

- [ ] **Step 1: Write failing validator tests**

Cover function disabled, candidate absent, confidence below threshold, model-invented date/source/document/role, unique entity alias, ambiguous entity alias, explicit function switch, unrelated chat, and write evidence.

```ts
expect(
  validateAgentPlan({
    text: "前攝影",
    enabledFunctions: ["query_schedule"],
    candidates: [{ capability: "query_schedule", reason: "active_task_entity", score: 1 }],
    proposal: {
      disposition: "continue",
      capability: "query_schedule",
      arguments: { role: "前攝影", date: "2027-01-01" },
      confidence: 0.95
    },
    activeTask: scheduleTask,
    minConfidence: 0.65,
    sourceType: "user"
  })
).toMatchObject({
  disposition: "execute",
  capability: "query_schedule",
  arguments: { role: "前攝影" },
  reasonCode: "active_task_refinement"
});
```

- [ ] **Step 2: Verify failure**

Run: `pnpm test -- src/__tests__/plan-validator.test.ts`

Expected: FAIL with missing validator.

- [ ] **Step 3: Implement evidence and entity validation**

Accept a proposed scalar only when normalized current text contains it, the active task exposes an exact/unique alias entity, or the capability declares a deterministic normalization such as a relative date explicitly present in current text. Strip every unsupported field before function argument parsing.

Return `clarify` for multiple entity matches, low confidence with more than one candidate, or a planner `clarify`. Return `chat` only when no capability has explicit or active-task evidence.

- [ ] **Step 4: Reuse existing write-evidence policy**

Move generic write-evidence helpers from `src/router.ts` into an exported policy utility so the old router and new validator use the same rule. Do not duplicate regexes.

- [ ] **Step 5: Verify**

Run: `pnpm test -- src/__tests__/plan-validator.test.ts src/__tests__/router.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent/plan-validator.ts src/__tests__/plan-validator.test.ts src/functions/argument-normalization.ts src/router.ts
git commit -m "feat: validate controlled agent plans"
```

### Task 8: Orchestrate controlled routing behind shadow and enabled modes

**Files:**

- Create: `src/agent/controlled-agent-router.ts`
- Modify: `src/agent/turn-runtime.ts`
- Modify: `src/server.ts`
- Modify: `src/index.ts`
- Test: `src/__tests__/controlled-agent-router.test.ts`
- Test: `src/__tests__/agent-turn-runtime.test.ts`
- Test: `src/__tests__/entrance.test.ts`

**Interfaces:**

- Produces: `ControlledAgentRouter.resolve(input): Promise<ValidatedAgentPlan>`
- Consumes: candidate generator, planner, validator, active-task store, dynamic knowledge metadata provider
- Preserves: legacy `FunctionRouterPort` while the profile flag is disabled or shadow-only

- [ ] **Step 1: Write failing orchestration tests**

Test three modes:

- disabled: legacy router controls execution;
- shadow: legacy reply is unchanged while sanitized controlled outcome is traced;
- enabled: validated controlled plan is converted to the existing `RouteResult` execution contract.

Also test a small-talk model proposal cannot override an exact active-task role entity and an explicit schedule request switches from knowledge context.

- [ ] **Step 2: Verify failure**

Run: `pnpm test -- src/__tests__/controlled-agent-router.test.ts src/__tests__/agent-turn-runtime.test.ts`

Expected: FAIL because controlled orchestration is absent.

- [ ] **Step 3: Implement `ControlledAgentRouter`**

The orchestrator performs exactly: read bounded inputs → build candidates → planner proposal → validate → return plan. It contains no function-name branches and no tool execution.

- [ ] **Step 4: Integrate with the turn runtime**

Read the active task before routing. In shadow mode, run both paths but use the legacy route. In enabled mode, translate validated `execute/chat/clarify/deny` into the existing runtime result path. A clarification returns a controlled reply without invoking a function.

Do not remove `guardSystemRouteWithFunctionIntent` yet; it remains active only on the legacy path.

- [ ] **Step 5: Record active tasks after successful function results**

After function execution, derive and persist a new active task from `agentResult`. Preserve the prior task for `not_found` and `ambiguous`. Clear it when a different successful capability without continuation replaces the task or access/source validation invalidates it.

- [ ] **Step 6: Verify entrance and runtime behavior**

Run: `pnpm test -- src/__tests__/controlled-agent-router.test.ts src/__tests__/agent-turn-runtime.test.ts src/__tests__/entrance.test.ts`

Expected: PASS with requester isolation, wake rules, access gates, and replies unchanged in shadow mode.

- [ ] **Step 7: Commit**

```bash
git add src/agent/controlled-agent-router.ts src/agent/turn-runtime.ts src/server.ts src/index.ts src/__tests__/controlled-agent-router.test.ts src/__tests__/agent-turn-runtime.test.ts src/__tests__/entrance.test.ts
git commit -m "feat: orchestrate controlled agent routing"
```

### Task 9: Add dynamic knowledge routing metadata and structured knowledge results

**Files:**

- Create: `src/knowledge/routing-metadata.ts`
- Modify: `src/knowledge/store.ts`
- Modify: `src/knowledge/migrations.ts`
- Modify: `src/knowledge/postgres-store.ts`
- Modify: `src/actions/admin-registry.ts`
- Modify: `src/functions/query-knowledge.ts`
- Test: `src/__tests__/knowledge-routing-metadata.test.ts`
- Test: `src/__tests__/knowledge-admin-actions.test.ts`
- Test: `src/__tests__/query-knowledge.test.ts`
- Test: `src/__tests__/agent-turn-runtime.test.ts`

**Interfaces:**

- Produces: `KnowledgeRoutingMetadata { sourceKey; displayName; aliases; topics; sampleQueries }`
- Produces: `deriveKnowledgeRoutingMetadata(displayName, documents)`
- Produces knowledge `AgentResultEnvelope` anchors and section entities
- Consumes candidate generator from Task 5 and active tasks from Task 2

- [ ] **Step 1: Write failing metadata and follow-up tests**

Use a source named `2026 青年出隊`, with no `SOP`, `計畫`, or `知識` words. Assert `第一天去哪裡` creates a knowledge candidate and `那幾點集合` remains anchored to the same document. Assert `那主日音控呢` switches to schedule.

- [ ] **Step 2: Verify failure**

Run: `pnpm test -- src/__tests__/knowledge-routing-metadata.test.ts src/__tests__/query-knowledge.test.ts src/__tests__/agent-turn-runtime.test.ts`

Expected: FAIL because source metadata and knowledge envelopes are absent.

- [ ] **Step 3: Add bounded metadata storage**

Add `aliases text[] not null default '{}'`, `topics text[] not null default '{}'`, and `sample_queries text[] not null default '{}'` to `knowledge_sources`. Limit each list to 20 entries and each entry to 100 characters in both stores.

Derive aliases from normalized display name and title variants. Derive topics from document titles and heading paths only; do not send chunk bodies to the planner. Accept optional administrator-provided aliases/sample queries through the existing admin action schema.

- [ ] **Step 4: Update knowledge source add/sync**

After a successful source sync, derive and persist metadata. Preserve administrator-provided aliases on later syncs. Admin source listing may show counts but must not echo full routing metadata.

- [ ] **Step 5: Return structured knowledge results**

On success, expose source/document anchors, heading/ordinal entities, safe evidence references, and operations `continue|refine|select`. On no evidence, return `agentResult.status="not_found"`. Keep evidence-bounded answer generation and source links unchanged.

- [ ] **Step 6: Verify dynamic routing and grounding**

Run: `pnpm test -- src/__tests__/knowledge-routing-metadata.test.ts src/__tests__/knowledge-admin-actions.test.ts src/__tests__/query-knowledge.test.ts src/__tests__/agent-turn-runtime.test.ts`

Expected: PASS for arbitrary source names, document-first follow-up, global fallback, expired/disabled source rejection, and schedule switching.

- [ ] **Step 7: Commit**

```bash
git add src/knowledge src/actions/admin-registry.ts src/functions/query-knowledge.ts src/__tests__/knowledge-routing-metadata.test.ts src/__tests__/knowledge-admin-actions.test.ts src/__tests__/query-knowledge.test.ts src/__tests__/agent-turn-runtime.test.ts
git commit -m "feat: route dynamic church knowledge"
```

### Task 10: Migrate remaining read capabilities and remove top-level function patches

**Files:**

- Modify: `src/functions/find-ppt-slides.ts`
- Modify: `src/functions/find-pop-sheet-music.ts`
- Modify: `src/functions/find-resource.ts`
- Modify: `src/wikipedia/lookup.ts`
- Modify: `src/functions/definitions.ts`
- Modify: `src/agent/function-intent-guard.ts`
- Modify: `src/agent/function-continuation.ts`
- Modify: `src/agent/turn-runtime.ts`
- Test: `src/__tests__/agent-capability-contracts.test.ts`
- Test: existing PPT, sheet music, resource, Wikipedia, continuation, and runtime tests

**Interfaces:**

- Every user-facing read function participates in candidate → planner → validator.
- Only functions declaring continuation operations create active tasks.
- Selection-session functions keep existing postback/numeric state.

- [ ] **Step 1: Write a shared capability contract test**

Iterate every enabled read definition and assert it has candidate hints, a valid argument schema, and an explicit continuation declaration or explicit `operations: []`. Add cross-function cases for PPT, sheet music, general resources, Wikipedia, schedule, and knowledge.

- [ ] **Step 2: Verify failure**

Run: `pnpm test -- src/__tests__/agent-capability-contracts.test.ts`

Expected: FAIL for definitions not yet migrated.

- [ ] **Step 3: Add envelopes to eligible read handlers**

File finders expose resource entities and references without sharing links. Wikipedia exposes the topic and page reference. `find_resource` exposes catalog item identifiers. Preserve current selection sessions, temporary links, memory rules, and reply formatting.

- [ ] **Step 4: Remove schedule-specific top-level recovery**

Delete schedule imports and schedule branches from `function-intent-guard.ts` and `function-continuation.ts`. If the files become empty compatibility wrappers, remove them and update imports. `turn-runtime.ts` must call only generic controlled-agent interfaces.

- [ ] **Step 5: Verify all read functions**

Run:

```bash
pnpm test -- \
  src/__tests__/agent-capability-contracts.test.ts \
  src/__tests__/agent-turn-runtime.test.ts \
  src/__tests__/function-continuation.test.ts \
  src/__tests__/functions.test.ts \
  src/__tests__/sheet-music.test.ts \
  src/__tests__/query-knowledge.test.ts \
  src/__tests__/query-schedule.test.ts \
  src/__tests__/router.test.ts
```

Expected: PASS and no top-level continuation code names a read function.

- [ ] **Step 6: Commit**

```bash
git add src/functions src/wikipedia/lookup.ts src/agent src/__tests__
git commit -m "refactor: unify read capability routing"
```

### Task 11: Add sanitized observability and planner evaluations

**Files:**

- Modify: `src/agent/trace-store.ts`
- Modify: `src/observability/action-telemetry.ts`
- Create: `src/tools/eval-agent-planner.ts`
- Create: `src/tools/eval-agent-planner-live.ts`
- Modify: `package.json`
- Modify: `README.md`
- Test: `src/__tests__/agent-trace-store.test.ts`
- Test: `src/__tests__/observability.test.ts`

**Interfaces:**

- Adds trace phases: `active_task`, `capability_candidates`, `planner`, `plan_validation`, `result_envelope`
- Adds scripts: `eval:agent`, `eval:agent:live`

- [ ] **Step 1: Write failing trace redaction tests**

Assert traces contain only candidate names/count, provider, disposition, confidence bucket, validator reason, result status, anchor count, entity types, and task lifecycle outcome. Assert raw messages, people, source URLs, filenames, tokens, prompts, evidence, and sharing links are absent.

- [ ] **Step 2: Verify failure**

Run: `pnpm test -- src/__tests__/agent-trace-store.test.ts src/__tests__/observability.test.ts`

Expected: FAIL because new phases are unsupported.

- [ ] **Step 3: Implement sanitized trace fields**

Use enum-like bounded strings and numeric counts only. Confidence is `low|medium|high`, never a raw prompt excerpt. Keep `/last-agent-turns` human-readable without including text.

- [ ] **Step 4: Add deterministic eval corpus**

`eval:agent` uses stub planner proposals to validate candidates and validator results offline. Include all required acceptance scenarios from the design plus negative, disabled, ambiguous, and cross-function cases.

- [ ] **Step 5: Add live planner eval**

`eval:agent:live` calls the configured DeepSeek-primary function-routing provider and reports proposal accuracy separately from final validated-plan accuracy. It exits non-zero when final validated behavior fails; do not add it to CI until live credentials are intentionally available.

- [ ] **Step 6: Verify**

Run: `pnpm test -- src/__tests__/agent-trace-store.test.ts src/__tests__/observability.test.ts && pnpm eval:agent`

Expected: PASS with zero sensitive-value matches.

- [ ] **Step 7: Commit**

```bash
git add src/agent/trace-store.ts src/observability src/tools/eval-agent-planner.ts src/tools/eval-agent-planner-live.ts package.json README.md src/__tests__/agent-trace-store.test.ts src/__tests__/observability.test.ts
git commit -m "test: add controlled agent diagnostics"
```

### Task 12: Enable, verify, deploy, resync, and run LINE acceptance

**Files:**

- Modify: `config/profiles.json`
- Modify: `README.md`
- Modify: `docs/architecture-context.md`
- Modify: `AGENTS.md` only if the function-development workflow or runtime contract changed materially

**Interfaces:**

- Switches helper from shadow mode to enabled controlled routing.
- Completes production migration and removes the legacy fallback flag only after acceptance.

- [ ] **Step 1: Run the complete local verification suite with shadow enabled**

Run:

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm config:validate
pnpm eval:router
pnpm eval:agent
pnpm build
```

Expected: every command exits 0.

- [ ] **Step 2: Run live model evaluation**

Run: `pnpm eval:agent:live`

Expected: DeepSeek is reported as primary, Ollama fallback cases pass, and every final validated acceptance case passes.

- [ ] **Step 3: Review shadow diagnostics locally**

Run the local server against seeded schedule and knowledge fixtures. Confirm legacy and controlled outcomes agree for supported cases; differences must be either intentional clarification improvements or fixed before enabling.

- [ ] **Step 4: Enable controlled execution for helper**

Change only:

```json
"controlledAgent": {
  "enabled": true,
  "shadow": false,
  "maxCandidates": 3,
  "minPlannerConfidence": 0.65
}
```

Keep `function_routing` as DeepSeek primary and Ollama fallback.

- [ ] **Step 5: Re-run the complete verification suite**

Run the same commands from Step 1 plus `pnpm eval:agent:live`.

Expected: every command exits 0.

- [ ] **Step 6: Update architecture documentation**

Document candidate generation, planner authority boundary, active tasks, result envelopes, adapter normalization, dynamic knowledge metadata, trace phases, and rollback flag. Update AGENTS.md rules so future functions must declare agent contracts and return structured read results.

- [ ] **Step 7: Commit the enablement**

```bash
git add config/profiles.json README.md docs/architecture-context.md AGENTS.md
git commit -m "feat: enable controlled agent runtime"
```

- [ ] **Step 8: Perform final pre-push verification and push `main`**

Run:

```bash
git status --short
git log -12 --oneline
git push origin main
git rev-parse HEAD
git rev-parse origin/main
```

Expected: worktree clean and `HEAD` equals `origin/main`.

- [ ] **Step 9: Monitor Azure DevOps and ACA deployment**

Use explicit Azure DevOps organization/project arguments. Wait for the run whose `sourceVersion` equals `HEAD`, confirm all stages succeed, then confirm the newest `hhc-line-function-bot` revision is Healthy and receives 100% traffic.

- [ ] **Step 10: Resync schedules and knowledge**

Start `hhc-line-bot-catalog-sync`, verify the execution succeeds, and confirm the media schedule now stores distinct roles for the next meeting. Sync active knowledge sources and confirm their routing metadata counts and search health without printing source contents.

- [ ] **Step 11: Verify API Gateway and Dapr**

POST unsigned JSON to `/api/line/webhook/helper` through the public API Gateway.

Expected: `400 {"ok":false,"error":"missing_line_signature"}` from the bot.

- [ ] **Step 12: Run signed LINE acceptance scenarios**

Verify in direct chat:

```text
幫我查下一場聚會服事的導播
前攝影
攝影是誰
下一場服事表的前攝影是誰
第一天去哪裡
那幾點集合
那主日音控呢
最近好累
```

Expected: focused schedule answers, controlled ambiguity when needed, anchored knowledge follow-up, explicit function switching, and genuine small talk only for the final message.

- [ ] **Step 13: Verify requester isolation in a managed group**

Have one member establish an active task and another member send the same short follow-up.

Expected: the second member does not inherit the first member's task.

- [ ] **Step 14: Remove the rollback-only legacy routing path after acceptance**

After direct and group acceptance passes, remove the legacy controlled-agent feature branch from runtime while retaining a config kill switch that disables semantic planning and falls back to deterministic clarification. Run the full suite and commit:

```bash
git add src config README.md docs/architecture-context.md AGENTS.md
git commit -m "refactor: retire legacy function routing"
git push origin main
```

Monitor the second deployment and repeat API Gateway smoke plus the four critical schedule/knowledge follow-ups.

## Final Verification Checklist

- [ ] No top-level runtime continuation branch names `query_schedule`, `query_knowledge`, or another read function.
- [ ] Every enabled read function has a declarative agent capability contract.
- [ ] Every eligible continuation function returns a structured result envelope.
- [ ] Notion multiline rosters are split at ingestion and stored as searchable role assignments.
- [ ] Dynamic knowledge source names and headings can create knowledge candidates without fixed domain words.
- [ ] DeepSeek proposes plans; deterministic validation strips unsupported fields and enforces access/policy.
- [ ] Ollama fallback and dual-provider failure paths are tested.
- [ ] Shadow mode does not alter replies.
- [ ] Traces contain no raw text, names, URLs, secrets, prompt content, evidence, or sharing links.
- [ ] Schedule, knowledge, small-talk, ambiguity, switch, expiry, disabled-function, and requester-isolation acceptance cases pass.
- [ ] Azure DevOps, ACA revision health, catalog sync, knowledge sync, and API Gateway/Dapr smoke pass.
