# Planner V2 review — not deployed

Working branch: `work/planner-preserve-history-2026-11-09`.
Backup baseline: `backup/pre-recurring-fixes-2026-11-09` at `9fec942c72813500629dfa7a0d28ec31e5e667f6`.

## Behavior

- Person and Preset precede Title/student. Default new events to the saved device preference (Tod/Meeting initially; Donna/Lesson when selected). Editing retains event ownership. This is not authentication. Frank remains a possible event subject.
- No-show checkbox and long-press use the same occurrence-only status write. Title, notes and moved dates remain unchanged. A NO-SHOW badge and outline distinguish absence from cancellation.
- Recurring Cancel offers this event, next N, or all in this series. Next N counts visible appointments not already cancelled, includes the clicked appointment, and previews dates before confirmation. All includes past dates only after explicit confirmation and retains No-show history. Cancelled appointments keep existing weekly visibility; month density continues excluding them. Print output now labels cancellation.
- Remove uses reversible event cutoffs or an occurrence hidden flag. The underlying events, exceptions and notes remain. History restores removed items and completed tasks. Undo last change is session-only and uses exact-row conflict checks. Legacy sentinel deletions remain hidden; restoring them can only recover notes still stored in the parent, since the old app already overwrote the original exception notes.
- Student Save preserves IDs, deactivates removals and commits the entire batch transactionally. Tasks use the same conflict-checked persistence; completion updates only completion fields, and removal archives.
- Shared loads preserve device-local storage instead of deleting it. Empty calendars are no longer automatically reseeded. Imported source metadata survives ordinary edits. Required event fields are validated before save.
- The old `revised-scheduler` page is retired: it previously shared the live database. No destructive future-series split/edit path is offered. Main app recurring editing stays occurrence-only, as it was under the old patch. Reintroducing series-wide editing requires a separately reviewed exception-preserving implementation.
- Content hashes version the assets; launch/resume checks `version.json` with no-store and offers Update. It never reloads an open editor. No service worker is introduced. Asset checks do not claim to control hosting cache headers.

## Database and deployment

`db/planner-safe-writes.sql` is additive: new archive/status fields and a SECURITY INVOKER transactional RPC. It rewrites no existing rows and preserves existing RLS. No changes have been applied to hosted Supabase. The function checks exact original rows, plus parent/exception snapshots for bulk cancellation. A failed record rejects the entire batch. Undoing creation is blocked if a new series has acquired exceptions.

The existing public write policies are retained, not expanded into a new login system. Direct legacy clients still have their prior permissions. Deploying this code requires the SQL first; without it writes fail rather than falling back to unsafe writes.

Before production approval:
1. Take a fresh database snapshot during a quiet editing window. Preserve the existing backup as well.
2. Verify the SQL and API against an isolated Supabase project in addition to the completed local PostgreSQL rehearsal. Production RLS/grants were recreated for local checks, but this does not exercise hosted PostgREST/schema-cache behavior.
3. Review desktop/mobile screenshots and browser test results. The full real-browser interaction suite passed in GitHub Actions; the mobile screenshot was inspected. No browser/Supabase credentials or real backup data enter CI.
4. Agree that Cancel all includes historical scheduled appointments while retaining No-show history (dialog explicitly confirms). Cancelled visibility remains as currently implemented.
5. Apply additive SQL only after explicit deployment approval, then deploy main assets together. Ask both devices to close and reopen/refresh once: already-open old code cannot discover a newly added update checker.
6. Verify the exact release hash on both devices before editing. A code-only rollback would not undo data changes and old code ignores new archive/status fields; avoid silently serving old code after use of V2. Database restore is a separately reviewed action.

## Tests

`npm ci && npm test` runs synthetic PostgreSQL mutation tests, frontend/RPC integration tests, functional DOM tests and content-hash verification. `npm run test:browser` uses Playwright (install Chromium first); `CHROMIUM_PATH` can select an installed browser. CI runs these without deployment.

`node tests/database.mjs /absolute/path/scheduler-backup-2026-11-09.json` restores the private snapshot into local embedded PostgreSQL only, validates every row by canonical JSON/hash, creates constraints/indexes/policies/triggers/functions, applies additive SQL twice and tests write/rollback/conflict behavior. Do not commit the snapshot. All 676 saved rows across eight tables restored identically in the initial rehearsal. The backup is app-scoped, not Auth/Storage/unrelated projects.

Run `npm run version:assets` after asset edits; `npm test` rejects a stale release hash. No production data, secrets or backup contents belong in this public repository.

## Safe browser preview (working branch only)

Open https://raw.githack.com/tpoirier1969/Scheduler/work/planner-preserve-history-2026-11-09/preview.html to test the interface without merging into main. The branch's `preview.html` deliberately removes the hosted Supabase client and `config.js`, injects synthetic appointments and one fictional student into browser-local storage, and displays a visible sample-data warning. Never enter real appointment information on the third-party preview service. The Reset sample data button clears and reinitializes only the preview's sample records.

The preview page is not a hosted database integration test. The `supabase-http` CI job separately tests a disposable local Supabase PostgREST instance and anonymous browser role. Production schema and data are unchanged.
