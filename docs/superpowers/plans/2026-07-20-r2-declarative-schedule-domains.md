# R2 Declarative Schedule Domains Implementation Plan

## Goal

Make `query_schedule` and `save_schedule` operate from profile-scoped domain
contracts so new schedule domains use existing schemas and adapters without
changing the controlled router or top-level handlers.

## Work

1. Add a validated schedule-domain registry to profile configuration. Each
   domain declares its stable key, display name, aliases, schema and revision,
   input schema, source binding, origins, write policy, priority, occurrence
   policy, and freshness policy.
2. Replace the hard-coded media/family resolver with a definition-driven
   resolver. Exact/current-message evidence selects one domain; multiple
   matches clarify; active-task evidence is accepted only as a scoped
   continuation.
3. Refactor `query_schedule` into a generic domain loop. Canonical-source and
   saved-schedule adapters return the same structured result envelope. Remove
   `includeMedia`, `includeFamily`, domain-specific request regexes, and live
   dual-query selection after canonical data is available.
4. Ground `save_schedule` previews in the resolved domain and registry
   revision. Confirmation must revalidate the revision and domain write policy.
   Existing function grants remain the outer authority gate; the domain
   contract narrows allowed operations.
5. Publish canonical schedule source updates atomically. Queries only read the
   active revision, so partial synchronization and failed publication preserve
   the prior snapshot.
6. Add migration and regression coverage for media, morning-prayer-family,
   street-service, children's Sunday, and prayer meeting domains. Prove the
   latter two require registry-only additions and no router changes.
7. Update product and architecture documentation, run the complete quality
   gate and agent evaluation, then publish through PR, merge, deployment, and
   production gateway smoke verification.

## Acceptance

- Explicit domain aliases select that domain regardless of adapter.
- A generic query with multiple matching domain results always clarifies.
- Follow-ups remain requester/source/domain scoped.
- A changed domain revision or write policy invalidates an old preview.
- Failed or partial source publication never becomes query-visible.
- Adding a domain that uses an existing input schema changes configuration and
  tests only, not the router or query/save handlers.
