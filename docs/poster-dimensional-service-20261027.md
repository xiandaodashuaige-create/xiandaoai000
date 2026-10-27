# Dimensional service names in poster generation

Task V3-DIMENSIONAL-SERVICE-839-20261027; canonical A3 #839, related #964.
Base: V3 #53, 8c16ec208f98b11928285a101bc2bb84614c1dd8.

The immutable state already retained the current request, but buildPosterPrompt
removed the digit from a dimensional service name: 3D面部骨雕 became D面部骨雕,
and HIFU4D紧致 became HIFUD紧致. The same loss affected explicit product,
current request, title context and background revisions before the source callback.

The existing numeric cleanup now preserves an integer immediately followed by
ASCII/fullwidth D when D is not the start of an English word. Currency-bearing
amounts, ordinary offer digits and the existing duration cleanup retain their
previous behavior. Exact approved title, facts and CTA remain in the existing
immutable state and deterministic renderer. No model, provider, API, layout,
font, migration, billing, auth or advertisement action changes.

Validation on the isolated branch:
- Six new state/prompt/source-callback regressions failed on unchanged #53:
  17 passed, 6 failed; log material-dimension-red-20261027.log.
- Product fix: 103/103 related tests across six poster suites passed, zero skips;
  includes actual Sharp JPEG/reference layout/version/photo tests.
- A final additional day/discount boundary test and the whole service suite:
  24/24 passed, zero skips. It shares 23 tests with the six-suite run; these
  figures must not be added as if they were disjoint.
- Node syntax and git diff --check passed. No existing assertion or skip changed.
- Model/source bytes and network in tests are TEST-ONLY; no paid generation.

Only api/_poster-copy.mjs, the existing service regression file and this note
are owned by this child. Other numeric scene constraints retain existing worker
policy; this is a dimensional service-identity correction, not a generic number
policy rewrite. A3 #1138 has a separate active quote/background repair and is not
modified here. The existing #51/#54 dependencies and formal F preparation chain
remain under the original Controller. Consume this full descendant of #53 once;
do not separately replay #48/#49/#50/#52/#53 ancestors.

Source delivery, independent exact-head review, source CI, final combined CI and
production visual acceptance are separate. No main merge, deployment, SQL apply,
release lease, Meta action or customer image was performed by this child.
The official-homepage real bone-sculpting image and revision UAT remain required.

Final review repair: the independent exact-d43 reader reproduced a P2 where
numeric-regex trailing whitespace let 3 D / 3\tD through. Two actual cases
failed on d43 (24 pass / 2 fail). trimStart instead of trim now preserves
leading spacing but requires the digit to be adjacent to D. Final six-suite
106/106 Node/Sharp tests pass, zero skips; this is the final application source.
The earlier d43 CI201 PASS and independent24 PASS remain historical evidence,
not approval for this successor. New exact-source review and CI are required.
