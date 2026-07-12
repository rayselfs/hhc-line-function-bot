# LINE Attachment Single-Pass Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the controlled LINE attachment save flow while downloading, validating, and scanning a confirmed attachment exactly once.

**Architecture:** The webhook performs a trusted-nothing metadata size precheck and stores a requester-scoped session. Purpose selection creates a provisional preview without fetching bytes; confirmation performs one bounded LINE download and invokes a shared binary publication service.

**Tech Stack:** TypeScript 5, Fastify 5, LINE Bot SDK 10, Microsoft Graph, ClamAV, Redis/in-memory sessions, Vitest 4, pnpm.

## Global Constraints

- `save_resource` remains a write function and existing effective authorization remains authoritative.
- The default maximum is exactly 25 MiB (`26_214_400` bytes).
- A scanner result other than `clean` fails closed.
- Do not change API gateway, Dapr, or Fastify webhook-body limits.
- Do not log raw filenames, LINE message IDs, hashes, user text, or sharing links.
- Do not push `main` without explicit deployment authorization.

---

### Task 1: Attachment Limits And Bounded LINE Download

**Files:**

- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `src/clients/line.ts`
- Modify: `.env.example`
- Test: `src/__tests__/config.test.ts`
- Test: `src/__tests__/line.test.ts`

**Interfaces:**

```ts
export interface AttachmentConfig {
  maxBytes: number;
  lineDownloadTimeoutMs: number;
}

export interface BinaryReadLimits {
  maxBytes: number;
  timeoutMs: number;
}

export interface LineContentClient {
  getMessageContent(
    messageId: string,
    profile: BotProfileConfig,
    limits: BinaryReadLimits
  ): Promise<LineContent>;
}
```

- [ ] **Step 1: Add failing config tests**

```ts
expect(loadConfigFromEnv(baseEnv()).attachments).toEqual({
  maxBytes: 25 * 1024 * 1024,
  lineDownloadTimeoutMs: 30_000
});

expect(
  loadConfigFromEnv({
    ...baseEnv(),
    MAX_ATTACHMENT_BYTES: "1048576",
    LINE_CONTENT_DOWNLOAD_TIMEOUT_MS: "5000"
  }).attachments
).toEqual({ maxBytes: 1_048_576, lineDownloadTimeoutMs: 5_000 });
```

- [ ] **Step 2: Add failing bounded-stream tests**

Use a fake readable stream to prove exact-limit success, limit-plus-one failure, empty stream handling, and timeout destruction. Require typed errors with codes `line_content_too_large`, `line_content_timeout`, and `line_content_empty`.

- [ ] **Step 3: Run tests and verify expected failures**

Run: `pnpm vitest run src/__tests__/config.test.ts src/__tests__/line.test.ts`

Expected: FAIL because attachment config and bounded reads are missing.

- [ ] **Step 4: Implement config and bounded buffering**

Read:

```text
MAX_ATTACHMENT_BYTES=26214400
LINE_CONTENT_DOWNLOAD_TIMEOUT_MS=30000
```

`readableToUint8Array` must accumulate the byte count before retaining each new chunk, destroy the stream on limit/timeout, clear its timer in `finally`, and never return partial bytes.

- [ ] **Step 5: Run targeted tests**

Run: `pnpm vitest run src/__tests__/config.test.ts src/__tests__/line.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit bounded download support**

```bash
git add src/types.ts src/config.ts src/clients/line.ts .env.example src/__tests__/config.test.ts src/__tests__/line.test.ts
git commit -m "feat: bound LINE attachment downloads"
```

### Task 2: Extract One Controlled Binary Publisher

**Files:**

- Create: `src/functions/resource-binary-publisher.ts`
- Modify: `src/functions/attachment-save.ts`
- Test: `src/__tests__/resource-binary-publisher.test.ts`

**Interfaces:**

```ts
export interface ResourcePublishTarget {
  profileName: string;
  sourceKey: string;
  itemKind:
    "ppt_slide" | "pop_sheet" | "hymn_sheet" | "church_document" | "church_image" | "church_other";
  domain: string;
  title: string;
}

export interface ResourceBinaryInput {
  data: Uint8Array;
  declaredFileName?: string;
  declaredContentType?: string;
  sourceKind: "line" | "external";
}

export interface ResourceBinaryPublisher {
  publish(input: {
    binary: ResourceBinaryInput;
    target: ResourcePublishTarget;
    now: Date;
  }): Promise<FunctionExecutionResult>;
}
```

- [ ] **Step 1: Move existing safety expectations into failing publisher tests**

Cover empty bytes, actual size, PDF/JPEG/PNG/Office magic detection, extension mismatch, filename sanitization, clean/infected/unavailable scanner results, missing write capability, duplicate hash, same title with different hash, Graph failure, and successful catalog upsert.

- [ ] **Step 2: Run tests and verify missing publisher failure**

Run: `pnpm vitest run src/__tests__/resource-binary-publisher.test.ts`

Expected: FAIL because the publisher does not exist.

- [ ] **Step 3: Extract validation and publication without changing behavior**

Move `detectContent`, target-specific extension policy, SHA-256, scanner handling, conflict checks, Graph upload, retention, and catalog upsert from `attachment-save.ts` into the publisher. The publisher receives already-bounded bytes and independently enforces `maxBytes` as defense in depth.

- [ ] **Step 4: Run publisher and existing attachment tests**

Run: `pnpm vitest run src/__tests__/resource-binary-publisher.test.ts src/__tests__/attachment-save.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the shared publisher**

```bash
git add src/functions/resource-binary-publisher.ts src/functions/attachment-save.ts src/__tests__/resource-binary-publisher.test.ts
git commit -m "refactor: centralize binary resource publication"
```

### Task 3: Defer Download Until Confirmation

**Files:**

- Modify: `src/state/session-store.ts`
- Modify: `src/functions/pending-attachment.ts`
- Modify: `src/functions/attachment-save.ts`
- Modify: `src/server.ts`
- Modify: `src/functions/modules.ts`
- Test: `src/__tests__/attachment-save.test.ts`
- Test: `src/__tests__/entrance.test.ts`

**Interfaces:**

Change the confirmation target to provisional metadata:

```ts
target?: {
  sourceKey: string;
  itemKind: string;
  domain: string;
  title: string;
  declaredFileName?: string;
};
```

Remove the persisted scan preview (`sha256`, verified MIME, verified extension). Those values exist only inside the confirmed publication call.

- [ ] **Step 1: Add failing entrance size-precheck tests**

Assert that declared `fileSize > config.attachments.maxBytes` replies `檔案太大，無法保存。`, creates no session, and does not call LINE content. Missing `fileSize` remains eligible because actual size is checked later.

- [ ] **Step 2: Add failing single-pass flow tests**

```ts
await handler.handle({ text: "存成投影片 SundayDeck" }, context("purpose"));
expect(lineContent.getMessageContent).not.toHaveBeenCalled();
expect(scanner.scan).not.toHaveBeenCalled();

await handler.handle({ text: "保存" }, context("confirm"));
expect(lineContent.getMessageContent).toHaveBeenCalledTimes(1);
expect(scanner.scan).toHaveBeenCalledTimes(1);
expect(graph.uploadFile).toHaveBeenCalledTimes(1);
```

Also assert cancellation calls none of the three clients.

- [ ] **Step 3: Run tests and verify current duplicate-processing failure**

Run: `pnpm vitest run src/__tests__/attachment-save.test.ts src/__tests__/entrance.test.ts`

Expected: FAIL because purpose currently downloads/scans and confirmation repeats it.

- [ ] **Step 4: Implement provisional preview and confirmed publication**

At purpose:

1. parse target/title;
2. verify target source exists and has write capability;
3. persist provisional target;
4. reply with declared filename/size and `確認後會下載、驗證並掃毒。`.

At confirmation:

1. re-check effective `save_resource` permission;
2. re-check source write capability;
3. download once with configured limits;
4. call the shared publisher;
5. delete the session for success and every terminal failure.

- [ ] **Step 5: Run targeted tests**

Run: `pnpm vitest run src/__tests__/attachment-save.test.ts src/__tests__/entrance.test.ts src/__tests__/registry.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the single-pass flow**

```bash
git add src/state/session-store.ts src/functions/pending-attachment.ts src/functions/attachment-save.ts src/server.ts src/functions/modules.ts src/__tests__/attachment-save.test.ts src/__tests__/entrance.test.ts
git commit -m "fix: process confirmed attachments once"
```

### Task 4: Deployment Contract, Documentation, And Verification

**Files:**

- Modify: `aca.containerapp.yaml`
- Modify: `azure-pipelines.yml`
- Modify: `src/__tests__/profile-config-deployment-contract.test.ts`
- Modify: `README.md`
- Modify: `docs/architecture-context.md`
- Modify: `docs/runbooks/production-operations.md`

- [ ] **Step 1: Add failing deployment-contract assertions**

Require both manifests to supply:

```text
MAX_ATTACHMENT_BYTES=26214400
LINE_CONTENT_DOWNLOAD_TIMEOUT_MS=30000
```

Continue asserting that Dapr app id/port/protocol remain enabled and no gateway upload-size setting is added.

- [ ] **Step 2: Run deployment-contract tests and verify failure**

Run: `pnpm vitest run src/__tests__/profile-config-deployment-contract.test.ts`

Expected: FAIL because the new env contract is absent.

- [ ] **Step 3: Update manifests and documentation**

Document the metadata-only webhook, single confirmed download, 25 MiB default, fail-closed scanner, and why API gateway/Dapr request limits are unrelated.

- [ ] **Step 4: Run full verification**

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 5: Commit deployment contract and docs**

```bash
git add aca.containerapp.yaml azure-pipelines.yml src/__tests__/profile-config-deployment-contract.test.ts README.md docs/architecture-context.md docs/runbooks/production-operations.md
git commit -m "docs: define attachment processing limits"
```

## Acceptance Criteria

- Purpose selection and cancellation download zero bytes.
- Confirmed publication downloads and scans exactly once.
- Declared and actual oversize files are rejected.
- Scanner failure never publishes.
- Existing requester scope, write permissions, target policy, retention, and catalog behavior remain intact.
