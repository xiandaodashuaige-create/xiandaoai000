# Ads Employee video adapter v1 (draft)

This is an isolated server-side adapter around the existing `video-agent-v0` API. It does not replace the `/video/` site, media project/job RPCs, storage, local worker, cloud poster worker, or their execution routing. Nothing in this directory deploys or contacts the live service by itself.

## Offline tests

From the repository root:

```sh
node --test integrations/ads-employee-video-v1/adapter.test.mjs
```

`fixtures.mjs` contains **synthetic** examples shaped like the inspected edge-function envelopes (`{ ok: true, job }`, `{ ok: true, bucket, path }`, `{ ok: true, url }`, and `{ ok: true, feedback }`). These are not live captures. The tests inject transport, authorization, project binding, persistence, clock, and retry delay; they do not connect to Supabase or mutate existing jobs.

## Server integration contract

Construct `createAdsEmployeeVideoAdapter` only inside the server process:

- `authorize(request)` must validate the caller's existing session and return trusted `{ actorId, tenantId, role }`. Never derive tenant or role from request JSON; changing an authorized role cannot change the tenant or project binding. Do not treat an `account_id` as a Meta account ID.
- `resolveBinding({ actorId, tenantId, role, projectRef })` must return the active, authorised `{ tenantId, videoProjectId }` pair or no binding. `projectRef` is an opaque caller-side project reference, not the media project ID. The adapter resolves this binding on every accepted operation and looks up every job/upload reference in that same tenant/project scope.
- `transport(action, payload, { signal })` must use server-configured API endpoints and credentials from the existing secret store. Keep both in the transport closure; never put them in browser code, requests, examples, logs, or returned errors. The adapter passes only the existing allowlisted media actions and safe payloads.
- `allowedOrigins` and `signedUrlOrigins` must be exact server-configured origin allowlists. Requests without an exact allowed `Origin` fail closed. A signed download URL is returned only for an allowed HTTPS origin.
- `persistence` must be the caller's **durable existing store**, not an in-memory map. It implements `reserveOperation`, `completeOperation`, `releaseOperation`, `reconcileOperation`, and `getJobMapping`; upload flow additionally needs `getUploadMapping` and snapshot creation needs `saveSnapshot`.

Persistence invariants:

1. Scope keys and mappings by the trusted tenant, project reference, and resolved media project—not by actor—so an authorized staff member and customer in the same merchant/project cannot create separate jobs for the same logical task. `reserveOperation` must atomically create one reservation for `(scope, operation, idempotencyKey)` and for any supplied `logicalKey`, return `created: true` only to one owner, and reject a changed payload fingerprint. Create uses the task ID as its logical key; submit and revision each use the mapped parent job as their logical key. Record the trusted initiating actor separately in operation audit details; every request still reauthenticates and re-resolves that actor's project authorization. The media service only creates one revision child per parent, so a different prompt for that same parent conflicts instead of silently returning an unrelated child. Thus a pending request cannot be repeated by changing its idempotency key or caller role.
2. Before accepting any media job response, require a nonblank job ID and exact `video_project_id` match to the current authorised binding. Status and submit must also match the mapped media job ID. Revisions must return a different job ID in the same project with the mapped parent and requested prompt/scope. Reject an identity mismatch before persisting mappings, exposing job metadata, or signing an output path. Preserve the reservation after an ambiguous post-write mismatch for reconciliation; never automatically repeat the write.
3. `completeOperation` must atomically persist the safe result and any `details.jobMapping` / `details.uploadMapping`. Job mappings retain the original media job ID, task ID, project ID, and parent job reference. Upload mappings retain the media job/project, server-issued input bucket/path, and metadata.
4. `releaseOperation` removes a reservation only for an explicit, definitive upstream rejection (or a local pre-write snapshot failure). `reconcileOperation` handles other non-completed reservations by reading durable caller state and/or the existing media service. It may return `{ state: 'completed', result }` only when it proves the original result. If the outcome cannot be proven, return no result; the adapter returns `reconciliation_required` and never repeats that write with a new key.
5. `saveSnapshot` stores the immutable v1 brief snapshot by task/version. Do not write these per-task values back into the shared media project/customer profile.

The reservation must be atomic across concurrent server instances. A lost response, timeout, or otherwise ambiguous failure after a create/submit/revision/feedback is an ambiguous write; keep its reservation for reconciliation rather than allowing another generation attempt. Explicit 4xx rejections and local pre-write snapshot failures release the reservation; writes are still never automatically retried. Read-only status and signed-URL reads have at most two retries, with a bounded per-call timeout and short exponential backoff.

### Request boundary

Pass either a parsed `body` (the framework's JSON parser must enforce the same 64 KiB limit before parsing) or a Web `ReadableStream` body. The adapter enforces the limit while reading streams and validates parsed-body size; it never falls back to an unbounded `request.json()` call.

The parsed request is shaped as:

```json
{
  "operation": "create_job",
  "projectRef": "caller-project-ref",
  "taskId": "caller-task-ref",
  "idempotencyKey": "stable-create-key",
  "input": {
    "projectName": "Campaign 17",
    "mode": "remix",
    "creativeBrief": {
      "campaignRef": "campaign-ref",
      "strategyRef": "strategy-ref",
      "materialVersionRef": "materials-v2",
      "language": "en",
      "audience": "Audience supplied by the approved brief",
      "offerFacts": "Caller-supplied facts",
      "prohibitedClaims": ["Claims not to make"],
      "referenceAssets": ["caller-asset-ref"],
      "desired": { "format": "video", "durationSeconds": 20, "count": 1 },
      "cta": "Learn more"
    }
  }
}
```

The example contains no credential. `projectRef` and task/campaign references are not media IDs. The adapter ignores client-supplied tenant, actor, video-project, media-job, storage bucket, or storage path values; media identifiers and paths come from the verified binding, durable mappings, or the authorised job's service response. The serialized request is limited to 64 KiB; field/list sizes are also bounded.

Supported modes are the existing `remix`, `ai_hybrid`, and `image_poster`. This boundary accepts `video` format for the first two and `image` for `image_poster`; any other mode/format is rejected rather than silently rewritten. Requested duration/count are part of the saved creative brief; the existing service may not enforce every requested duration.

Allowlisted operations:

| Adapter operation | Existing API action | Required references |
| --- | --- | --- |
| `create_job` | `init_job` | stable task ID, create idempotency key, complete v1 brief |
| `prepare_upload` | `sign_upload` | mapped job, idempotency key, safe file name/type/role |
| `submit_job` | `submit_job` | mapped job, idempotency key, previously issued upload references |
| `status` / `refresh` | `status` | mapped job |
| `download_url` | `status`, then `download_url` | mapped job and an asset reference in its output manifest |
| `create_revision` | `status`, then `create_revision` | completed parent with output manifest, idempotency key, one revision per parent, prompt/scope |
| `record_feedback` | `record_feedback` | authorised project, optional mapped job, idempotency key and feedback |

`worker_update`, acceptance, generic admin operations, arbitrary bucket/path signing, and advertising publication approval are deliberately not exposed. Feedback uses adapter-owned event types and the authenticated actor; it does not silently change shared project preferences. Media acceptance, if later required by a staff workflow, is distinct from approval to publish an advertisement and is outside this adapter.

### Result and customer/staff contract

Successful operations return `{ ok: true, result }`; safe failures return `{ ok: false, error }` with a stable code and no upstream response body. The result includes `taskId`, durable adapter `jobRef`, original `jobId`, `version`, `mode`, `executionTarget`, exact `serviceStatus`, adapter `state`, and asset metadata where the existing output manifest supplies it. Duration, dimensions, and cost are `null` when unknown.

The minimum customer result card should show:

- task/job reference and version;
- mode and execution target;
- the current state (`submitted`, `queued`, `rendering`, `needs-attention`, `completed`, or `failed`), without collapsing queued/rendering into completion;
- an asset card only when `completionConfirmed` is true, using only manifest metadata.

`serviceStatus: completed` without a valid `output_files` manifest yields `state: needs-attention`, `completionConfirmed: false`, and no downloadable asset. `ok: true` or HTTP 200 by itself never asserts that a media file exists. `record_feedback` accepts `{ jobRef?, taskId?, idempotencyKey, input: { content } }`; the authenticated staff/customer identity and feedback event type are server-derived.

`prepare_upload` returns a server-issued path, not a final creative and not a signed upload URL. Uploading a reference by itself is not a final asset; submit only persisted upload references for that mapped job. `download_url` accepts an asset reference, never a path or bucket. Returned signed URLs expire (the existing API currently issues a 3,600-second URL); request a fresh URL when needed. Any future ad-upload step must obtain a fresh, appropriately scoped asset reference and URL. Do not make storage public to avoid expiry.

## Integration handoff

| Area | Reused / caller work / verification |
| --- | --- |
| Media authority | Reuse the current Edge Function actions, project/job/storage RPCs and output manifest. The current `/video/` page remains the execution/data authority. |
| Workers | Reuse `api/video-worker.mjs` for its declared `image_poster` cloud capability with local fallback, and `worker/video_agent_worker.mjs` / local tools for existing local rendering. Do **not** describe all video rendering as cloud-hosted. |
| Ads Employee caller | Supply verified actor/tenant/project binding, existing server-side endpoint/credential transport, durable transactional persistence hooks, approved brief/task/campaign references, and the actual authorised upload mechanism. |
| This draft does not verify | Live endpoint/auth compatibility, caller database atomicity, production two-tenant isolation, worker online/heartbeat behavior, real uploaded assets, generated output metadata, or signed-URL behavior in deployment. No production records or network were used in tests. |

### Readiness checklist (not yet executed)

- [ ] Existing authorised upload → submit → worker claim/heartbeat → result-manifest/status → download.
- [ ] Two-tenant project/job/upload/result isolation under real caller bindings.
- [ ] Worker heartbeat and offline/timeout/fallback behavior observed without interrupting current workers.
- [ ] `image_poster` cloud-poster routing/local fallback and video local routing verified; do not infer all rendering runs in cloud.
- [ ] Existing `/video/` page and local rendering use remain unchanged and operational.
- [ ] Revision from an authorised completed job with an output manifest retains parent/version linkage, rejects a changed request for an existing parent revision, and cannot duplicate after an ambiguous response.
- [ ] Staff result feedback is scoped and does not approve ad publication.

Before any live canary, separately approve one owned-asset test project, named operator/owner, endpoint/credential controls, monitoring and rollback. Any production auth/DB change, credential rotation, advertising approval, or deployment requires its own owner-approved gate. If the caller's existing store cannot supply durable atomic idempotency/mappings, the smallest follow-up is a separately reviewed, additive persistence change in that caller's store with unique scoped idempotency-key and logical-key constraints, staged read/reconcile path, and rollback by disabling the adapter while retaining rows for audit; no video-service migration is required by this isolated draft. Owner for that future gate: Ads Employee integration owner together with the existing media-service owner.
