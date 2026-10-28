# Confirmed images for future ad optimization

Owner request is tracked in Ads #397 (2026-10-27): confirmation stores an image
for a later optimization; confirmation and selection must never launch ads.

The existing V3 checksum-verified accepted_at/output_sha256 record is the durable
save authority. No duplicate asset ledger or advertising approval is created.
Images stay private to the authenticated current OWNER's project. The A3
library route derives tenant scope from its own project, rechecks the owner after
the provider read, and ignores caller tenant IDs. The gateway returns only the
minimum image fields; no customer brief, contact, input asset or other tenant's
data appears in the response.

Each list page contains up to 30 accepted images and an acceptedAt/jobId seek
cursor for older images. It does not depend on the old most-recent-30-jobs RPC.
Selecting an image checks its original job/session/version/checksum and obtains
a fresh signed URL. Only explicit "选用这张图片" calls the existing onAdopt preview
callback. Existing advertising confirmation/approval/execution remains required.

UI: completion asks the customer to confirm and save; saved-image receipt names
the next-optimization library and states that saving does not launch ads. The
ad image step has "从下次优化库选图", preview and "加载更早保存的图片".
Video confirmation remains a saved video, without falsely advertising it as an
image in the image-only picker.

Dependency: xiandaodashuaige-create/xiandaoai000 branch
feat/accepted-optimization-library-20261027. Its forward-only migration
20261027080544_a3_accepted_image_library.sql must be reviewed/applied by the
existing V3 publisher before the matching Edge Function and gateway, then A3.
No production migration, deployment, Meta mutation, OTP or spend was performed
by this source task. Source tests are TEST-ONLY, not production acceptance.

Validation: focused A3 route/provider/client/acceptance unit tests; native
Desktop1440/390px component browser scenarios including reload, failure,
duplicate click, late project response and selecting an older page. Existing
image generation entry/panel regression also runs in the scoped browser config.
The provider has a real gateway test, scope/pagination tests and disposable
PostgreSQL SQL tests (75 saved images, denied secret/null access, role permissions,
cross-tenant/project, disabled project, unchanged row count, repeated migration).

Run A3 focused browser: node node_modules/@playwright/test/cli.js test --config
tests/browser/accepted-image-library.playwright.config.mts

Final release: retain source changes from the current chat-history owner; this
task only changes video review business handlers/copy, not history/sync/nav.
The original sole C publisher must reconcile exact sources, run full combined
CI (browser job total 30 minutes), obtain independent exact-source review and
perform real signed-in save -> re-entry -> older-image selection -> preview UAT.
Old gateway/RPC absence must show unavailable, never a successful empty library.
Rollback is code reversion; saved provider acceptance records are retained.

Disposable SQL verification (never against production):
create an empty disposable PostgreSQL database and roles; apply in this order:
tests/accepted-image-library-db-setup.sql
supabase/migrations/20261027080544_a3_accepted_image_library.sql
supabase/migrations/20261027080544_a3_accepted_image_library.sql
tests/accepted-image-library-db.sql

Author actually executed these through PGlite 0.5.12 in an isolated temporary
database. This is real PostgreSQL function/permission/seek behavior with synthetic
fixtures, not a full replay of the existing Supabase stack or production RPC.
The definer function is needed by the existing shared-access-secret provider
architecture: public EXECUTE is revoked, only anon/authenticated can call it,
each call rechecks video_agent_check_access (including NULL), search_path is empty
and every table/function reference is schema qualified. It grants no table reads.
The service access secret remains server-only and is never part of client data.

Coordinate ordinary merging with existing V3 PR48/PR49; do not overwrite their
gateway/revision work. This change adds a read capability only, not poster
generation or revision behavior.
