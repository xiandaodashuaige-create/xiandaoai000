# WA888 isolated paired UAT, 2026-10-29

Owner explicitly approved the staging-v2 new WA888-only namespace in the original continuation thread. Total incremental operating cap USD2 unchanged. No customer messaging, Meta writes, paid model generation, C511/Lash row reuse, production/main/publisher changes or shared schema migration.

## Actual exact versions and deployments
- A3 11ed9ecd8045e3b1a015fdf9bc59b241060e3cbf, Vercel preview dpl_Pc5JjTRUfsPobA2yYyRJBNEY7q7r, READY.
- BE 9a47592a7043316e095a04eb00fcf8274c19f48c, Railway staging deployment 2b1e1380-6a53-4875-a433-aef48bc3fd29, observed SUCCESS/Online before tests. One CPU/500MB/one worker, hard one-hour process timeout, restart NEVER; no volume. Stopped after checks to bound cost; in-memory/container fixture mappings do not survive removal.
- Gateway f4dcea49d7b4fd53b642361052bafdba9547d45a, Vercel preview dpl_312kPcZ79GmeRWhfvQHQR4r6o3c8, READY.
- A3 dedicated test namespace in staging-v2 heontvhjsxfifcsvdbge: tenant60852e80-7f69-4d18-a17e-c5b26dc2ef9e, projectd744ba1d-8d62-4581-8d3c-78db9936e888; new normal Auth API identity8010e3c7-bfae-4a95-8c9d-752fab32bea9, normal password sign-in and exact one OWNER membership verified. RLS-visible projects exactly one, the dedicated project.
- V3 remains isolated ugqqaixpligbancucwdd. Post-check database count1 job, original0459dbbb-3347-428d-af4c-d18672d8ae81 still uploading.

## Results
A3 -> original HMAC -> hosted BE: 15/15 PASS plus4/4 negative/recovery checks. Includes denied anonymous/foreign scope; read409 while unmapped; explicit confirmation; idempotent provision; empty session/agent/automation/customer reads; missing receipt404; unconfirmed and foreign configuration writes denied.
Gateway -> hosted Edgev2 -> own database:10/10 PASS. Original job exact recovery, unknown operation literal null, tenant/project/session/correlation isolation, malformed key400, independent gateway auth denial and repeated same job. No init/upload/submit/revision/worker calls.

The initial raw HTTP gateway attempt was RED at Vercel Deployment Protection, not an application auth failure. Its v3-gateway-readonly.json remains unchanged and failed. The passing file has explicit authenticated vercel curl transport. CLI automatically created an automation access token while following the official protected-preview access path; only that exact newly created token was revoked afterward, with zero bypass tokens remaining. No disablement of Deployment Protection or production authentication.

## Honest remaining gates
- Browser reached the exact A3 preview sign-in page. Its mandatory agreement checkbox requires action-time confirmation. Not checked; no browser auth injection/terms bypass. Desktop/390 authenticated flow NOT_RUN.
- A3 preview VIDEO_AGENT_ENABLED=false with empty branch-specific VIDEO_AGENT_ACCESS/BASE_URL. Gateway verification used authenticated CLI, not an A3 browser-to-video end-to-end claim. Direct server-to-server protected preview access must be configured before enabling this provider.
- staging-v2 lacks get_project_whatsapp_destination_readiness(uuid,uuid). Actual sales-status correctly returns adDestination UNKNOWN/e164 null, separately from reception NONE and NO_NUMBERS. No existing shared migration renamed/applied or missing result fabricated.
- No real WhatsApp numbers/groups/provider credentials are present. Empty-state integration is TEST-ONLY, not real merchant delivery or full selected-target configuration UAT.
- Frozen C excludes this new sales scope. Original #1040/#409 publisher must accept it in the appropriate later batch; no release/merge acceptance is claimed here.
- Billing total is not available from the tools; bounded runtime and cleanup are recorded, not a fabricated exact spend.

Operational scripts rely only on locally encrypted dedicated test credentials and normal vendor CLIs; no credential files or values are committed. The new Auth and business fixture rows persist for continuation; the isolated BE mapping can be provisioned again after a bounded restart.
