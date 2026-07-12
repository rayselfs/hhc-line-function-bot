# External Sheet Music Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authorized requester select a direct PDF/JPEG/PNG result from consent-gated sheet-music web search and import it into the helper shared pop or hymn catalog through the existing controlled `save_resource` binary publisher.

**Architecture:** Search keeps structured candidates in a requester-scoped session. A pinned-address HTTPS downloader enforces SSRF, redirect, timeout, and byte limits; the confirmed binary is handed to the shared publisher introduced by the attachment single-pass plan.

**Tech Stack:** TypeScript 5, Node.js 24 `https`/`dns`/`net`, SearXNG, Microsoft Graph, ClamAV, Redis/in-memory sessions, Vitest 4, pnpm.

## Global Constraints

- Implement only after `2026-07-12-attachment-single-pass.md` provides `ResourceBinaryPublisher`.
- General web browsing, HTML parsing, page crawling, and authenticated downloads remain prohibited.
- Accept only direct HTTPS PDF, JPEG, or PNG responses.
- Imported files become helper-profile shared catalog items.
- Effective `save_resource` permission is required at offer, target selection, and final confirmation.
- Scanner results other than `clean` fail closed.
- Do not push `main` without explicit deployment authorization.

---

### Task 1: Safe Direct-File Downloader

**Files:**

- Create: `src/clients/external-binary.ts`
- Create: `src/__tests__/external-binary.test.ts`
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `.env.example`

**Interfaces:**

```ts
export interface ExternalBinaryDownloadResult {
  data: Uint8Array;
  finalUrl: string;
  fileName?: string;
  contentType?: string;
}

export interface ExternalBinaryClient {
  download(input: {
    url: string;
    maxBytes: number;
    timeoutMs: number;
    maxRedirects: number;
  }): Promise<ExternalBinaryDownloadResult>;
}
```

- [ ] **Step 1: Add failing URL-policy unit tests**

Cover rejection of:

```text
http://example.org/file.pdf
https://user:pass@example.org/file.pdf
https://127.0.0.1/file.pdf
https://169.254.169.254/latest/meta-data
https://[::1]/file.pdf
https://[fc00::1]/file.pdf
```

Also reject any hostname whose resolved A or AAAA set contains a loopback, private, link-local, multicast, unspecified, documentation, benchmark, or reserved address.

- [ ] **Step 2: Add failing transport tests**

Using injected DNS and HTTPS request factories, test:

- the validated address is pinned into the request lookup while TLS `servername` and `Host` remain the original hostname;
- every redirect is re-resolved and revalidated;
- more than three redirects fail;
- missing/invalid `Location` fails;
- `Content-Length` above the limit fails before body buffering;
- chunked limit-plus-one fails while exact limit succeeds;
- timeout destroys the request;
- `text/html` fails with `external_binary_not_direct_file`;
- credentials/cookies are never forwarded.

- [ ] **Step 3: Run tests and verify missing-client failure**

Run: `pnpm vitest run src/__tests__/external-binary.test.ts`

Expected: FAIL because the downloader does not exist.

- [ ] **Step 4: Implement the downloader with Node HTTPS**

Use `dns.promises.lookup(hostname, { all: true, verbatim: true })`, validate every returned address, choose one validated address, and provide a custom `lookup` callback to `https.request` so the connection cannot perform a second uncontrolled DNS lookup. Use `redirect: manual` semantics implemented in the client, not global `fetch` automatic redirects.

Add config:

```text
EXTERNAL_RESOURCE_DOWNLOAD_TIMEOUT_MS=15000
EXTERNAL_RESOURCE_MAX_REDIRECTS=3
```

Use the existing `MAX_ATTACHMENT_BYTES` for the byte ceiling.

- [ ] **Step 5: Run downloader tests**

Run: `pnpm vitest run src/__tests__/external-binary.test.ts src/__tests__/config.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the safe downloader**

```bash
git add src/clients/external-binary.ts src/__tests__/external-binary.test.ts src/types.ts src/config.ts .env.example
git commit -m "feat: add safe external binary downloader"
```

### Task 2: Persist Structured External Search Candidates

**Files:**

- Modify: `src/state/session-store.ts`
- Modify: `src/state/redis-session-store.ts`
- Modify: `src/functions/find-pop-sheet-music.ts`
- Test: `src/__tests__/sheet-music.test.ts`
- Test: `src/__tests__/stores.test.ts`

**Interfaces:**

```ts
export interface ExternalSheetMusicImportSession {
  id: string;
  type: "external_sheet_music_import";
  stage: "selecting" | "awaiting_target" | "awaiting_confirmation";
  profileName: string;
  requesterUserId?: string;
  source: LineSource;
  query: string;
  requestedKind?: "pop_sheet" | "hymn_sheet";
  items: Array<{ title: string; url: string; snippet?: string }>;
  selectedIndex?: number;
  targetKind?: "pop_sheet" | "hymn_sheet";
  expiresAt: string;
}
```

- [ ] **Step 1: Add failing session-store tests**

Verify in-memory and Redis lookup select only the latest live session matching profile, source, and requester. Another group member and a missing requester ID cannot continue it.

- [ ] **Step 2: Add failing search-result tests**

After explicit `上網找`, assert the handler stores the raw five-result maximum and replies with numbered candidates plus sanitized hosts. It may include the existing summary but must not discard candidate URLs from server-side state.

- [ ] **Step 3: Run tests and verify failure**

Run: `pnpm vitest run src/__tests__/sheet-music.test.ts src/__tests__/stores.test.ts`

Expected: FAIL because structured external-import sessions are missing.

- [ ] **Step 4: Implement session persistence and selection rendering**

Infer `requestedKind` only from explicit original wording (`流行` → `pop_sheet`; `詩歌`/`敬拜` → `hymn_sheet`). Generic `歌譜` stays undefined. Never infer a target library from a result site's hostname.

- [ ] **Step 5: Run targeted tests**

Run: `pnpm vitest run src/__tests__/sheet-music.test.ts src/__tests__/stores.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit structured candidate state**

```bash
git add src/state/session-store.ts src/state/redis-session-store.ts src/functions/find-pop-sheet-music.ts src/__tests__/sheet-music.test.ts src/__tests__/stores.test.ts
git commit -m "feat: keep selectable external sheet results"
```

### Task 3: Controlled Import Conversation

**Files:**

- Modify: `src/functions/find-pop-sheet-music.ts`
- Modify: `src/functions/modules.ts`
- Modify: `src/functions/registry.ts`
- Modify: `src/index.ts`
- Test: `src/__tests__/sheet-music.test.ts`
- Test: `src/__tests__/registry.test.ts`

**Interfaces:**

- Consumes: `ExternalBinaryClient`, `ResourceBinaryPublisher`, and `ExternalSheetMusicImportSession`.
- Produces: a text-handler flow that reports `executedAction: "save_resource"` only after successful publication.

- [ ] **Step 1: Add failing authorization and conversation tests**

Cover:

1. requester without effective `save_resource` can select and view the public result but receives no import action;
2. authorized explicit pop/hymn requests proceed directly to confirmation;
3. an authorized generic request asks `要存到流行歌譜還是詩歌歌譜？`;
4. confirmation text includes title, source host, shared target, and a statement that the requester confirms the church may store/use it;
5. permission revoked before confirmation prevents download;
6. cancellation performs no download;
7. invalid numeric selection leaves the live session intact and asks for a valid number.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm vitest run src/__tests__/sheet-music.test.ts src/__tests__/registry.test.ts`

Expected: FAIL because import routing and dependencies are absent.

- [ ] **Step 3: Wire dependencies and implement state transitions**

Register the import text handler only when catalog, Graph, scanner, external downloader, and shared publisher are configured. Recheck effective `save_resource` at every write-stage message. Keep `find_sheet_music` read-only; successful import is audited as `save_resource`.

- [ ] **Step 4: Run conversation tests**

Run: `pnpm vitest run src/__tests__/sheet-music.test.ts src/__tests__/registry.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the controlled conversation**

```bash
git add src/functions/find-pop-sheet-music.ts src/functions/modules.ts src/functions/registry.ts src/index.ts src/__tests__/sheet-music.test.ts src/__tests__/registry.test.ts
git commit -m "feat: add controlled sheet music import flow"
```

### Task 4: Publish Selected Direct Files

**Files:**

- Modify: `src/functions/find-pop-sheet-music.ts`
- Modify: `src/functions/resource-binary-publisher.ts`
- Test: `src/__tests__/sheet-music.test.ts`
- Test: `src/__tests__/resource-binary-publisher.test.ts`

- [ ] **Step 1: Add failing publication tests**

Assert that final confirmation:

- downloads the selected URL exactly once;
- rejects HTML even when the URL ends in `.pdf`;
- rejects PDF/JPEG/PNG header/magic mismatches;
- rejects actual bytes above `MAX_ATTACHMENT_BYTES`;
- fails closed on infected/unavailable scan;
- targets only `pop_sheet_music/pop_sheet` or `hymn_sheet_music/hymn_sheet`;
- refuses a disabled/read-only target source;
- prevents same-hash and same-title duplicates;
- uploads and upserts exactly once on success;
- deletes the session on every terminal result.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm vitest run src/__tests__/sheet-music.test.ts src/__tests__/resource-binary-publisher.test.ts`

Expected: FAIL because the selected result is not passed to the publisher.

- [ ] **Step 3: Implement confirmed download and publication**

Derive a safe title from the selected result, strip any existing extension, and let actual content detection choose `.pdf`, `.jpg`, or `.png`. Call the downloader only after confirmation, then pass `sourceKind: "external"` and the selected target to `ResourceBinaryPublisher`.

Audit metadata may contain only:

```ts
{
  sourceType: context.event.source.type,
  sourceKind: "external",
  originHost: new URL(selected.url).hostname,
  targetSourceKey
}
```

Do not store the complete origin URL in catalog or audit metadata.

- [ ] **Step 4: Run publication tests**

Run: `pnpm vitest run src/__tests__/sheet-music.test.ts src/__tests__/resource-binary-publisher.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit external publication**

```bash
git add src/functions/find-pop-sheet-music.ts src/functions/resource-binary-publisher.ts src/__tests__/sheet-music.test.ts src/__tests__/resource-binary-publisher.test.ts
git commit -m "feat: import direct sheet music files"
```

### Task 5: Documentation, Deployment Contract, And Verification

**Files:**

- Modify: `aca.containerapp.yaml`
- Modify: `azure-pipelines.yml`
- Modify: `src/__tests__/profile-config-deployment-contract.test.ts`
- Modify: `README.md`
- Modify: `docs/architecture-context.md`
- Modify: `docs/runbooks/production-operations.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Add failing deployment-contract assertions**

Require:

```text
EXTERNAL_RESOURCE_DOWNLOAD_TIMEOUT_MS=15000
EXTERNAL_RESOURCE_MAX_REDIRECTS=3
```

Keep the existing SearXNG and ClamAV private endpoints and Dapr configuration unchanged.

- [ ] **Step 2: Run deployment-contract tests and verify failure**

Run: `pnpm vitest run src/__tests__/profile-config-deployment-contract.test.ts`

Expected: FAIL because the new settings are absent.

- [ ] **Step 3: Update user/operator/agent documentation**

Document direct-file-only behavior, explicit consent, shared-library visibility, write authorization, format/size limits, SSRF controls, fail-closed scanning, and that HTML/page crawling remains unsupported.

- [ ] **Step 4: Run full verification**

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

- [ ] **Step 5: Commit deployment contract and docs**

```bash
git add aca.containerapp.yaml azure-pipelines.yml src/__tests__/profile-config-deployment-contract.test.ts README.md docs/architecture-context.md docs/runbooks/production-operations.md AGENTS.md
git commit -m "docs: define external sheet import policy"
```

## Acceptance Criteria

- An authorized requester can select, categorize, confirm, and import a direct clean PDF/JPEG/PNG result.
- Unauthorized users can view public results but cannot cause a download or write.
- HTML, unsafe destinations, redirect violations, oversize content, and scan failures never reach OneDrive.
- Imported items are immediately searchable by `find_sheet_music` as shared helper catalog resources.
- External import does not create a new binary publication path outside `save_resource` policy.
