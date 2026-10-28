# V3 precise poster revisions — 2026-10-26

Task: V3-POSTER-EXACT-20261026. Owner: the V3 revision window. Canonical coordination: A3 #839, #409; A3 creative/advertising ownership: #1015. Capability remains **PARTIAL** until coordinated deployment and genuine production acceptance. Local RPC/storage and image-provider fixtures are **TEST-ONLY**.

## Baseline and ownership

Current observed V3 main: `f0069ed5bd088bd6d1fb8f9904e574487844dce3`. Parent PR #48 is OPEN, head `7e2a7b592e8055a0788df9ae7ea8d609840e5bab`; this branch is stacked on that exact head, retaining its exclusion/style fixes. No stale PR23 renderer or old website is merged. Only its bounded reference-byte edit adapter was extracted while preserving the current model, provider choice and size controls.

Remote writer preflight DC118432: READY (Node24.19/pnpm11.19, authenticated remote); independent worktree/push dry-run DC27872: exit0. Remote worktree `D:/LULIAN-AUTO/ads-continuity-worktrees/poster-exact-revisions-20261026`; branch `fix/poster-exact-revisions-20261026`. Local source/review tree is a separate checkout of the same parent. Exact delivery head, CI and review receipts are recorded in the PR and canonical issue; do not substitute this baseline for the delivered head.

Scope: V3 worker, revision helper, exact typography, scoped provider revision response check and tests. No A3 source, shared approval truth, DB/RLS/schema, Edge deployment, billing or advertising changes. No second material system, scheduler or publisher. Independent non-author verifier: `v3_revision_verifier` (read-only). Original #409 Controller owns cross-repository integration/publication.

## Actual production evidence (read-only)

The three supplied jobs and current production function definitions were read directly, not inferred from the report or main source alone.

| Job | Persisted evidence | Conclusion |
| --- | --- | --- |
| `28e0b0b8-8fe9-4c84-93d6-50e7df1f9026` | completed V1; inputs empty; original title/RM98; background SHA `e3f8db57592f2e4d88a4bfd577b85a8f48927feae386417dd11df7913b480f09` | Only flattened final JPEG and source hash were retained, no downloadable clean background. |
| `9ca90366-5c7d-451c-8c56-76e0bb4add2d` | correct parent above, V2; same tenant/project/session/correlation; full requested RM108/new headline/deep-green button/keep-photo prompt retained; inputs empty; background SHA `882571e6079124622a3eb45c0397c08de23e7ba9ca3abd58343dee9534405836` | Upstream did pass the full revision. Old worker used stale brief facts, a shared accent and a newly generated photo. |
| `07e41ab9-476b-4ad8-b719-a0d6544c855f` | current request background explicitly requires all English; current CTA field is `WhatsApp 咨询`; project wall language is Mandarin | An inconsistent text/language contract reached V3, which lacked a consistency guard. This is not evidence that an image model translated a correct English CTA. |

Production `video_agent_create_revision` is newer than the old migration snapshot: retry/cloud handling exists, but the first child of a parent is returned without comparing the new revision text. We preserve the function. `video_agent_worker_update` stores output JSONB unchanged; `video_agent_issue_path` supports the existing private results bucket and job-isolated PNG paths. These source reads establish JSON/path compatibility, not live acceptance of new writes.

## Resulting behavior

- Resolve one effective copy snapshot, applying explicit title, currency+price, CTA and button-color changes before generation/rendering. Unsupported or ambiguous changes fail explicitly, including an unsupported additional instruction alongside a supported price correction. No silent fallback to old text.
- Default revisions reuse the immediate parent's clean photo and saved logical overlay boxes/palette. Only explicit positive permission may generate a new photo. Negated permission does not count. Logical text box widths are retained; a glyph's measured width is not reused as a narrower constraint. Explicit ratio/type-size changes allow layout reflow while preserving the photo.
- Button fill/contrast is independent of brand and price accents. JPEG/WebP input is composited via lossless PNG so saving/reusing a PNG source does not alter untouched photo pixels through a second lossy encode.
- New completed posters include `poster_edit` inside the existing sole poster output: exact job/parent/version, render-state snapshot, private clean-source path/hash, reference count, generation-call count and unknown cost. The clean source is private metadata, not a second approved poster or advertising approval. Each version stores its own source in its own namespace; hash and parent scope are checked before reuse.
- A revision must have the exact immediate parent/version and matching internal project, external tenant/project, conversation and correlation. Corrupt source, wrong manifest version or missing source fails before image generation. Existing failed-first-generation uploaded-photo retry reuses the inherited main input; a failed revision without a saved render snapshot is explicitly limited rather than reverting to original facts.
- Current confirmed text is printed verbatim; price changes require an explicit currency and amount. Reference market never converts currency or invents a quote. Traditional and English are supported as supplied. English requirements reject conflicting Chinese visible copy before paid work; the A3 authoring owner must prepare consistent confirmed copy. No automatic translation claim is made.
- Customer main photos are genuinely loaded. Style references are downloaded as bytes and supplied to the existing direct-image editing adapter with correct subject/style roles. Unsupported generation-only gateway editing, missing references and optimization of a flattened poster without editable layers fail explicitly. Historic/competitor/industry discovery remains in its existing A3 owner; no fabricated source, local aesthetic claim, collection or quota reset.
- Scoped V3 provider revisions reject a returned old child or wrong parent/prompt/scope/tenant/project with HTTP409. The caller must continue from the latest child. The worker independently verifies the exact version increment.

## Existing caller contract and cross-repository handoff

No new DTO or API action:

```
provider_create_revision:
  tenant_id, project_id, parent_job_id, revision_prompt, revision_scope
response:
  job.id, parent_job_id, version_number, output_files[].path/type/sha256
```

Revision fields may be explicit newline/semicolon-delimited assignments, e.g. `主标题：下班后来放松`, `行动引导：Book on WhatsApp`, or unambiguous bounded corrections such as `价格由RM98改成RM108`. Missing currency, ambiguous changes and unsupported edits must be corrected rather than silently applied partially. Keep current `conversation_session_id`/correlation mappings. A3 should verify response identity, handle the409 conflict, select the newest child as next parent, and present failed language/copy/source errors as needing correction. A3 creative approval still uses its existing canonical artifact/version/checksum authority; V3 acceptance/URL/manifest is not that approval.

#839 comments6408273042/6408285682 and #1015 comment6408273237 carry the ownership/contract request. At this document's checkpoint no external A3 acknowledgement of this specific V3 contract has been observed; do not describe a comment alone as completed cross-repository wiring. The existing field contract is unchanged and V3 work is independently reviewable. Original Controller must reconcile this PR with PR48 and A3 language/confirmation paths, and perform one combined target-version UAT.

## Verification and visual evidence

Commands:

```
node --test --test-concurrency=1 tests/*.test.mjs
node --check api/video-worker.mjs
node --check api/_poster-revision.mjs
node --check api/_cloud-media-providers.mjs
node --check api/a3-video-provider.mjs
git diff --check
```

Author's initial full Linux run:151/151 pass, no skip; subsequent retry/currency/failed-revision regressions add three meaningful tests. Final exact-head full result is attached in the PR. New tests exercise real render/worker behavior with fake RPC/storage and synthetic image-provider responses, rather than accepting HTTP200/prompt strings as output proof.

Real local raster QA produces nine JPEGs plus a manifest in `POSTER_PROOF_DIR` (default OS-temp `v3-poster-exact-proofs`): before, button-only, price-only, title-only, CTA-only, English, Traditional, square, and latest three-revision worker output. The input photograph is the repository-owned hero asset, a photographic fixture, **not the customer's lost original massage background**. Before/after visual review verified changed RM108/headline/English CTA and unchanged face/photo/layout/brand/price under button-only change. Actual pixel crops confirm photo/brand/price equality and changed button pixels. Wrong-session, missing source, checksum mismatch and unsupported reference failures cannot complete a job.

The non-author review found and the author repaired: negated photo permission; combined CTA/color loss; hidden unsupported edits/fields; encoding drift; logical-vs-glyph box drift; old-child response success; and flattened-reference mode fallthrough. Giant Buffer failure diffs initially exhausted test-process memory; comparisons now use exact `Buffer.equals` booleans, retaining strict equality without huge diagnostic allocation. This does not erase the earlier failed runs.

Model generations invoked by this repair window: **0 live**, no provider charge initiated; local raster products are not billable model generations. Test provider call counts are simulated. Costs of the historical jobs remain **UNKNOWN**, and storage/CPU costs were not billed/read. No Meta create/ACTIVE/budget changes, WhatsApp messages or live customer image requests occurred.

## Release and remaining acceptance

This is not a production-pass receipt. After source review/CI the original Controller must include the PR48 dependency and this head in the existing release chain, verify actual V3 deployment SHA/alias and A3 contract together, then run:

1. Fresh authorized poster; price-only/title-only/CTA-only/button-only and combined observed correction; compare real output bytes and rendered text.
2. Same photo/layout across sequential latest-parent revisions; explicitly allowed replacement; ratio changes; refresh/re-entry and wrong-parent/conflict failures.
3. Actual customer reference under a configured edit-capable provider, or explicit unsupported failure; original exclusions; all-English CTA and Traditional text.
4. A3 confirmation/handoff uses the exact canonical asset/version/checksum; original failed test draft must never be used for live advertising.

Historical initial/revised outputs have no clean source. This PR deliberately cannot promise pixel-perfect edits of those legacy flattened posters; such a request is limited/failed, never reported as successfully preserving its photo. Safely retrying an existing failed uploaded-photo job is preserved. No production migration is required. Rolling back the worker/provider code leaves additive metadata readable but new precise revisions unavailable; retain private source objects until their normal lifecycle policy permits cleanup.
