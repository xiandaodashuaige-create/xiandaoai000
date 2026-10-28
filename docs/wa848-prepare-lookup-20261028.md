# Scoped video prepare operation lookup for #848 / #964

A lost prepare response must be reconciled by the original operation identity. This source adds a read-only lookup through the existing authenticated video provider and Edge function. It returns only the safe existing job projection or null; a missing result never creates a second job.

The SQL RPC requires the existing provider access secret and exact tenant, project, conversation, correlation and vpr1 operation key. It is STABLE with an empty search_path, revokes PUBLIC execution, and does not modify jobs. The existing provider Bearer authentication remains ahead of the new action. No migration has been applied to any hosted database.

## Source provenance

- Original untouched WIP base: `cef9b8cccc09c30a35ffb590b22080e40aa5df55`.
- Preserved seven-file source checkpoint: `9522de3ff3879cb0529eeb06d4621d9180635351`.
- User explicitly authorized this window to take over the remaining original #848 code. The original worktree and all seven source bytes are preserved. This branch adds only review evidence after that checkpoint.
- Paired A3 preserved source: `310cd856975b18e9cfc958cbcc7b259512e3439f`; its provider adapter, operation contract, scope resolver and recovery route consume this lookup. The final chat integration branch retains those files.
- The comparison to current main also includes previously composed creative sources in the parent. These inherited paths are not new changes authored by this takeover; consume the full source ancestry once through the original integration queue.

## Verification

The 31 affected Node tests pass: the existing provider suite and new lookup suite. A new disposable local PostgreSQL 18.6 cluster passed setup, migration, migration replay and SQL acceptance covering exact/null/scope/role/access/read-only behavior. The cluster was stopped afterward. All identities, secrets and data in these checks are synthetic.

The complete Node suite on the Windows host fails in the unchanged cloud-video concat path. Both that module and its test have the same Git blobs as the source parent. The original failure is retained; this is not a full-suite PASS. The existing Ubuntu pull-request workflow must supply full-suite evidence. Deno is unavailable locally, so Edge typecheck is NOT_RUN. Hosted migration, real provider, production UAT and deployment are NOT_RUN.

Raw local logs are retained as deterministic gzip files and their original byte hashes are in `docs/evidence/wa848-prepare-lookup-20261028/manifest.json`. No test assertions or quality gates were relaxed. Rollback is removal of this additive lookup action/RPC through the existing release process; this branch has performed no release action.
