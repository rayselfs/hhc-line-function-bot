# Task 8 Implementer Report

## Status

Implemented controlled agent orchestration behind disabled, shadow, and enabled profile modes. The final corrective review reports READY with no remaining Task 8 blockers.

## Changes

- Added `ControlledAgentRouter.resolve()` as the orchestration boundary: capability metadata, a capped dynamic-knowledge metadata snapshot, candidate generation, planner proposal, and plan validation.
- Preserved the legacy router as authoritative when controlled routing is disabled or shadow-only.
- Made shadow planning fault-isolated and concurrent with the legacy route. Shadow outcomes are sanitized trace metadata only and cannot execute controlled side effects.
- In enabled mode, translated validated `execute`, `chat`, `clarify`, and `deny` dispositions into the existing turn-runtime result path. Missing/unavailable planners fail closed to controlled clarification.
- Rechecked effective enablement and source policy before execution and retained existing access, wake-word, pending-session, handler, audit, in-flight, and reply machinery.
- Isolated enabled controlled execution from legacy continuation state: it neither reads continuation before routing nor merges or passes continuation to handlers.
- Read and wrote requester-scoped active tasks only for enabled controlled routing. New task state is derived only from successful structured results; `not_found`, `ambiguous`, and failed results preserve prior state.
- Added sanitized `controlled_route` trace phases without raw user text, arguments, evidence, or secrets.
- Wired the router through `index.ts` and `server.ts`. The route result uses provider `router` and lane `function_routing` to reuse existing observability contracts.
- Kept Task 9 persistence out of scope. Task 8 defines and consumes a narrow dynamic metadata provider with a 20-item planner snapshot cap; it does not change the knowledge store schema or persistence interface.

## TDD Evidence

- Initial RED tests failed because controlled orchestration and runtime mode wiring did not exist.
- Additional RED regressions covered shadow side effects, shadow store failure isolation, stale legacy argument merging, handler continuation leakage, planner failure behavior, active-task requester isolation/lifecycle, unsupported sources, disabled functions, and controlled clarification/chat/deny paths.
- The metadata-provider test verifies the router requests a 20-item snapshot. Persistence-level limits were deliberately left for Task 9.
- Final GREEN: `pnpm test` passed 74 files / 770 tests.

## Corrective Review

- Fixed shadow active-task/store failures so the legacy route remains authoritative and available.
- Prevented validated controlled arguments from being changed by legacy continuation merging.
- Prevented handlers from consuming stale legacy continuation context in enabled mode.
- Capped metadata passed to the planner while reverting knowledge-store/Postgres changes at the Task 8/Task 9 boundary.
- Final reviewer assessment: READY; no remaining Task 8 blockers.

## Verification

- Targeted Prettier check for all changed TypeScript source/test files: passed.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm build`: passed.
- `pnpm eval:router`: passed, 66 cases.
- `pnpm test`: passed, 74 files / 770 tests.
- `git diff --check`: passed.
- Whole-repo `pnpm format:check` remains blocked only by pre-existing `.superpowers/sdd/*.md` task-control files. Changed product source and tests pass Prettier.

## Scope / Safety Review

- No function-name branches were added to `turn-runtime`, `function-intent-guard`, or `function-continuation`.
- No public health/readiness, OAuth, access-control, attachment, or deployment behavior was changed.
- No secrets, raw group history, raw messages, generated sharing links, or provider credentials are added to traces or planner inputs.
- No push or deployment was performed.

## Lifecycle and Shadow Fault-Isolation Correction

### Status

Addressed the four independent-review blockers in a separate corrective change.

### RED Evidence

- Shadow-focused RED: 3 failures proved the observer was absent and both never-resolving and late-rejecting shadow work delayed the legacy reply.
- Combined runtime/entrance RED: 8 failures proved missing-envelope results cleared prior tasks, pending completions did not transition tasks, and postback selections did not transition requester-scoped tasks.
- Continuation-write RED: temporarily removing the enabled-mode gate produced exactly 1 failure, showing `recordFunctionContext` was called once with controlled result data.

### Corrective Design

- Launches shadow resolution as a detached observed promise. It never mutates the authoritative turn's step array or delays legacy routing, execution, trace completion, or reply.
- Reports sanitized shadow success/failure through `ControlledShadowObserver`; both planner and observer rejection paths terminate with an attached catch, preventing late unhandled rejections.
- Adds generic `applyActiveTaskTransition()` with explicit structured-success authority. Missing envelopes, failed results, and `not_found`, `ambiguous`, or `unavailable` envelopes preserve state. A contract/result operation intersection is required to record a continuable task; explicit non-continuable success clears state.
- Reuses the transition for enabled routed execution, pending-function text completion, and requester-scoped postback selection completion. Group/room postbacks without a requester cannot create state.
- Enabled controlled execution neither reads, merges, passes, nor writes legacy function continuation state. Disabled/shadow legacy execution retains the existing continuation behavior.
- Task 9 persistence remains untouched.

### Verification

- Focused runtime/entrance suites: 2 files / 120 tests passed.
- Targeted Prettier check for all five corrective source/test files: passed.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm build`: passed.
- `pnpm eval:router`: passed, 66 cases.
- `pnpm test`: passed, 74 files / 776 tests.
- `git diff --check`: passed.
- Whole-repo `pnpm format:check` reports only the same 12 pre-existing `.superpowers/sdd` control files; corrective product source/tests pass Prettier.

## Enabled Runtime-Context Isolation Correction

- RED: the focused runtime suite failed exactly 1 new regression because enabled controlled routing read legacy `recentTurns` before reaching the planner; the other 41 tests passed.
- Computes controlled mode before context construction and skips `buildRuntimeContext()` entirely when enabled. Disabled and shadow legacy-authoritative modes retain their existing context behavior.
- Regression makes legacy recent-turn, continuation, and prompt-building dependencies throw if called, verifies controlled execution still succeeds, and checks the planner input contains only the scoped controlled fields with no legacy prompt/history.
- GREEN: focused runtime suite passed 42 tests; full suite passed 74 files / 777 tests.
- Targeted Prettier, typecheck, lint, build, 66 router evals, and `git diff --check` passed.
