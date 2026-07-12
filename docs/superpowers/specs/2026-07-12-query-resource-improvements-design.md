# Query And Resource Improvements Design

## Goal

Deliver three independent improvements without changing the bot's restricted-function model:

1. introduce a reusable query-refinement contract and use it to fix service-schedule filtering;
2. make LINE attachment publication download and scan the binary only once, after confirmation;
3. allow an authorized requester to import a selected direct sheet-music file from consent-gated web search into the shared helper catalog.

The dynamic Notion knowledge-source feature and cross-turn function continuation are separate follow-up projects.

## Delivery Order

The work is intentionally split into three implementation plans. Each plan produces independently testable software and may be reviewed or deferred without blocking the others.

1. `2026-07-12-query-refinement-schedule.md`
2. `2026-07-12-attachment-single-pass.md`
3. `2026-07-12-external-sheet-music-import.md`

The attachment single-pass plan precedes external import because both LINE attachments and external files must use one controlled binary validation, scanning, and publication pipeline.

## Original Request Disposition

1. **Schedule false negatives:** implemented by the query-refinement and schedule plan.
2. **Cross-function follow-ups:** separate next-batch continuation-state design; a complete question such as `下一場音控是誰` is fixed now, while an elliptical follow-up such as `音控呢？` is deferred.
3. **Attachment path and request limits:** implemented by the attachment single-pass plan; gateway and Dapr body limits remain unchanged because they receive metadata-only webhook JSON.
4. **Reusable virus scan endpoint:** no application change in this batch. The current private clamd endpoint is already usable by ACA services that implement `INSTREAM`; an HTTP facade is a separate optional project.
5. **Save a selected web sheet-music result:** implemented as authorized direct-file import, not link-only memory and not HTML crawling.
6. **Dynamic Notion travel plans:** separate next-batch `query_knowledge` and knowledge-source design, built on the query-refinement contract after the schedule adapter proves it.

## Query Refinement Boundary

The shared query layer does not become a universal natural-language parser. It provides a contract for separating:

- structured arguments already extracted by a function;
- terms consumed while extracting those arguments;
- the residual query that may safely be used for text or fuzzy search.

Each function owns its domain adapter. The first adapter is `query_schedule`, which recognizes date intent, meeting, role, and schedule category. Future PPT, sheet-music, resource, and knowledge functions may adopt the contract incrementally.

For example:

```text
input: 下一場服事表的音控是誰
structured: dateIntent=next_meeting, role=音控
consumed: 下一場, 服事表, 音控, 是誰
residual: (empty)
```

An empty residual query means that the store applies only structured filters. It must not add a full-text condition.

## Schedule Source Resolution

- `影視團隊`, `影音團隊`, and `媒體團隊` resolve to the media schedule read-model source.
- `晨更`, `仙履奇緣`, `舉牌`, and `為耶穌` resolve to existing structured schedule types.
- Remaining meaningful text is allowed to match a LINE-saved custom schedule title or entry.
- Generic requests without a category may search both saved schedules and configured read-model sources.
- Internal source keys and backing services remain hidden from ordinary replies.

## Binary Publication Boundary

There remains exactly one binary publication pipeline under the `save_resource` write policy. Both LINE attachments and external direct files provide bytes to the same pipeline, which performs:

1. bounded byte acquisition;
2. actual-size, magic-byte, extension, and filename validation;
3. SHA-256 calculation;
4. ClamAV scan with fail-closed behavior;
5. target-source write-capability check;
6. duplicate hash/title check;
7. OneDrive upload;
8. catalog upsert and write audit.

No binary is published before explicit confirmation. The profile's existing write-function authorization remains authoritative.

## LINE Attachment Flow

The webhook stores only LINE metadata and rejects a declared size above `MAX_ATTACHMENT_BYTES`. When the requester supplies a purpose, the bot validates the target source and creates a confirmation preview without downloading content. On `保存`, it downloads once with a byte and time bound, runs the shared publication pipeline, and deletes the session on every terminal result.

The API gateway, Dapr, and Fastify webhook-body limits remain unchanged because the binary travels from the bot to the LINE Content API as an outbound request/response.

## External Sheet-Music Import

After local catalog miss and requester consent, public search results remain structured in a requester-scoped session. The user selects a result, selects pop or hymn when the original request is ambiguous, and confirms that the file may be added to the helper shared library.

Only direct HTTPS PDF, JPEG, or PNG responses are accepted. The downloader:

- uses no cookies, credentials, or user-provided headers;
- permits at most three redirects;
- resolves and pins the destination address for every request;
- rejects loopback, private, link-local, multicast, reserved, and cloud-metadata addresses for IPv4 and IPv6;
- rejects HTML and never parses a page to discover another link;
- enforces `MAX_ATTACHMENT_BYTES` while streaming;
- validates actual content rather than trusting URL suffix or headers.

The selected flow is available only when the requester has effective `save_resource` permission. Successful imports are formal shared `pop_sheet` or `hymn_sheet` catalog items.

## Observability And Privacy

Attachment and import telemetry may record phase, result, duration, source kind, target kind, and size bucket. It must not record raw user text, original filenames, LINE message IDs, complete URLs, URL queries, hashes, sharing links, or secrets.

## Deferred Work

- General function continuation for elliptical follow-ups such as `音控呢？`.
- Dynamic Notion page/database registration, `query_knowledge`, and itinerary read models.
- Graph upload sessions, quarantine Blob storage, queues/workers, and high-volume byte quotas.
- A private HTTP virus-scan facade; current ACA services may use private clamd when appropriate.

## Deployment Constraint

All three plans change deploy-triggering paths. Implementation may be committed locally, but `git push origin main` requires explicit deployment authorization.
