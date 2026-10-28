# Bounded current poster request

Task V3-POSTER-REQUEST-BOUND-20261027, canonical A3 #839/#964. Parent source is V3 #52 at ce210045ac0d5afaec3a8cebca91812074d1c92c, already containing #48/#49/#50. This closes the optional request-context length/type P2 retained by #50's source review.

The existing validatePosterState entry now accepts missing context for legacy manifests, requires supplied context to be a string and uses the existing A3 poster-brief 8192 UTF-16-character bound. Oversized input fails before source loading or image generation; it is never silently truncated, which could discard a service named near the end. Parent scope checks and scoped legacy recovery remain unchanged. No renderer/reference/API/model/SQL/billing/Meta or production change.

Regression on unchanged #52: the two new rejection tests failed (15/17 passed); the real preparation callback accepted the oversized background. After the bounded validation, the poster regression group, including actual Sharp/worker/reference geometry/version/source tests, passes. Exact count, independent review and remote CI are recorded on the child PR. Syntax and git whitespace checks pass.

Four new cases cover the full allowed boundary preserving the final service, oversize rejection with zero generation calls, invalid saved types, and missing legacy context. The original 13 service-direction cases and reference rendering remain present. No real customer model output was generated; image adherence still requires original C's same-version deployment and visual website UAT. This child does not turn the earlier prompt-quality limitation into a production PASS.
