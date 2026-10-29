# WA888 isolated UAT bootstrap and Edge portability
This child continues V3#56 at exact 78c1992. It does not edit the original branch/WIP, main, current C, or production.
The user approved wa888-uat/restored preview ugqqaixpligbancucwdd and capped test runtime at USD 2.

The old Edge source hardcoded a different project's publishable key, database fallback, and production worker URL. The runtime now resolves the current deployment's SUPABASE_URL and built-in SUPABASE_ANON_KEY (optional SUPABASE_PUBLISHABLE_KEY fallback). Missing/invalid configuration fails with 503 after authentication. VIDEO_AGENT_CLOUD_WORKER_URL is explicit and optional: empty means no worker HTTP call at any of the five dispatch sites. A later production release must explicitly configure its existing worker URL before adopting this child. Existing access-digest authentication is retained.

bootstrap-video-agent-baseline.sql is a **test-only structural recovery**, not a historical source migration and not an approved production change. Original repository history starts after foundation tables/functions already existed.
Source: read-only pg_catalog snapshot of the existing V3 baseline on 2026-10-29 (4 tables, 29 functions, constraints, indexes and one trigger). No customer/config rows, access digest, storage HMAC secret, provider credential or API token was selected/copied.
The script aborts if any owned table exists, recreates only video_agent_* objects, revokes direct table access, and leaves private configuration empty (authentication fails closed).
After an independent exact-source review, apply this only to ugqqaixpligbancucwdd, followed by unchanged candidate migrations:
- 20261027080544_a3_accepted_image_library.sql
- 20261028003712_video_prepare_operation_lookup.sql
It does not replay the historical access-code rotation or historical SMP customer seed.

Local validation uses a new loopback-only disposable PostgreSQL cluster, existing synthetic roles, this full structural bootstrap and the two exact migrations. baseline-acceptance.sql validates real RPC-created draft data, original-key recovery, missing and foreign scopes, bad credentials/keys, replay cardinality, STABLE/definer metadata and anon table denial; synthetic changes roll back. The reduced prior test fixture is not used.

Rollback before any hosted apply is simply no-op. For this fresh test-only installation, preserve evidence and drop only newly created video_agent_* test objects if explicitly cleaning it; never drop any existing application data or production object. Runtime secrets are configured with normal authenticated CLI on the exact test project and never checked into git.
