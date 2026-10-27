# Poster service direction: current request survives generation

Task: V3-POSTER-SERVICE-FIDELITY-20261027. Canonical A3 issue #839, related #964. Parent source: PR49 at 2e565a41a4011405a3e2e669d36881fcc6357979 (itself depends on PR48). This is a stacked source change, not a production deployment.

A customer requested facial sculpting for Singapore, but the poster showed generic facial care. The optional product field was empty; the actual service existed in `需求背景`. The generation helper ignored that field. PR49's immutable state and brief reconstruction also discarded it before the actual image-generation callback. The confirmed generic headline then became the only available scene direction.

The fix retains `customerRequest` as optional rendering metadata in the existing poster-edit-v1 state, serializes it back into the same brief grammar, and consumes it in the existing prompt. Explicit current service fields take priority; the request supplies missing direction; reference images, generic headlines and the business category cannot change the promoted service. It does not invent a technique, tool, device or promised outcome. Exact approved title/facts/CTA remain unchanged.

Legacy saved states recover only the missing context from their already validated immediate parent's current brief. No project memory, other tenant, schema migration, model/provider, external API, billing, approval or advertising-state changes. Existing source-image reuse remains intact.

Validation on the changed source:

- Sanitized reproduction on the unchanged PR49 source: 10 failures / 1 pass, including the actual state-to-generation callback missing the requested service. An initial incomplete local file copy was corrected before recording this reproduction.
- Final focused suite: 72/72 PASS, zero skip. Command: `node --test tests/poster-service-fidelity.test.mjs tests/poster-current-brief.test.mjs tests/poster-copy.test.mjs tests/poster-revision.test.mjs tests/poster-revision-render.test.mjs`.
- Thirteen new cases cover empty/explicit product, current/old request isolation, escaped/Traditional briefs, price filtering, exclusions, legacy manifests, field priority, the actual preparation callback and main-image reuse.
- Existing real Sharp/worker raster tests remain green: source/version isolation, exact revisions, untouched image/layout, English/Traditional and resized outputs. These are isolated fixtures, not new model-created customer images.
- Syntax and git whitespace checks pass. Dependencies installed from the unchanged lockfile; no lockfile change.
- Independent exact-head review and final remote CI are recorded separately in the PR and #839; this document does not predeclare their result.

Limits and release:

- No paid image-model call or production job mutation was made for this patch. Prompt transport tests prove what the generator receives, not that an image model always obeys it.
- A3 copy preparation must consume the same current service before customer confirmation. A generic or wrong AI draft must not be silently treated as an accurate service summary. This handoff is recorded on original #964.
- Keep the reported image unaccepted as a service-direction failure. The original publisher must combine PR48, PR49, this child and the relevant A3 reference/copy changes, verify actual deployed SHAs, then generate and visually inspect a fresh poster through the official homepage journey. Validate facial-sculpting direction, Singapore, current copy/facts, absence of unrelated cleansing imagery and persistence after refresh.
- A customer-uploaded source may itself show the wrong service; the code does not pretend to classify or replace that image. Existing confirmation and source-reuse semantics are retained.
