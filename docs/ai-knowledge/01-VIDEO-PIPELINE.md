# Video Pipeline and Worker Context

This repository owns the video generation/rendering service and its worker execution paths.

## Pipeline concepts
1. Resolve project/job binding and authorized inputs.
2. Validate media, prompt context, format and output constraints.
3. Select an allowed workflow (for example remix, AI hybrid, image poster or voice/audio mix) based on actual configuration.
4. Execute through the selected Worker/provider.
5. Validate output manifest, checksum, dimensions, frame rate, duration, audio and quality gates.
6. Persist job state and artifact lineage.
7. Expose authorized status, download, revision and feedback operations.

## Local vs cloud
Local and cloud workers are separate execution environments. Do not infer parity from matching API shape. Compare real output samples, quality metrics, failure/retry behavior, cost and artifact provenance before retiring fallback.

## Historical PR evidence
- PR #18 closed 2026-10-14: documented cloud/local parity work and V3 provider contract; its description also recorded then-current Gateway credit and provider-key blockers.
- PR #7 was open in the 2026-11-14 audit snapshot for a bounded Ads Employee adapter.
- Other current open PRs at the 2026-11-14 audit included #48–#57; refresh their exact state before making task claims.

## No secrets
Never add provider keys, signed URLs, raw customer assets or private consumer repository details to this public documentation.
