# Poster history and reference repair — 2026-10-14

## Problem and resulting behavior

The cloud poster worker previously ignored role=reference uploads and the selected remake/optimization purpose. It applied one green template to the first main image, or generated a prompt-only background without a main image. It did not reproduce the historical reference-directed design process.

The repair passes actual reference bytes to OpenAI image edits, keeps main customer material first and style references separate, and adds black/gold and burgundy styles alongside green. Exact copy is typeset from the current brief, with measured text budgets and exact output dimensions. Remake requires a reference; optimization requires a main input; unsupported or unavailable reference editing fails visibly instead of falling back to a local template that drops the references.

## Evidence and scope

- Baseline: e8aa18d58f1db44027cac33b5c0c9c1d464bbe6e, repository xiandaodashuaige-create/xiandaoai000.
- Historical image artifacts inspected: 01_漏跟进痛点_黑金版_1080x1350.png and 02_咨询到预约流程_酒红版_1080x1350.png, dated 2026-08-20.
- Recovered user feedback includes “太乱了，不是广告图” and “有点接近了”; these do not establish final acceptance of the inspected historical images. A later narrow history retrieval was unavailable.
- Historical requirements: single poster, one main selling point, short copy, clear CTA, real material priority, reference-directed style, current customer facts.
- External small trial: same black/gold reference and prompt, one image each through Nano Banana 2 and GPT image via the connected Runway workspace; 7 and 17 credits respectively. Both finished. The former included unwanted quotation marks and output 928x1152; the latter output 1536x1920 and followed the supplied copy more closely. These are one-sample design checks, not conversion benchmarks.
- Current conversation image generation also produced a full poster and a blank background from the same reference. The blank background was passed through both old and repaired cloud renderPoster code to compare real rendering behavior at 1080x1350.
- Production GET /api/video-worker returned providers.enabled=false and image=false. GET /api/a3-video-provider returned configured=true and image_poster in its workflow list. Contract availability is not proof of successful generation.
- Targeted provider/poster tests and inline JavaScript parse validation pass. The generated media API calls in tests are mocked; the actual references and real typography renderer are checked independently.

## Remaining runtime requirement

Reference image edits require AI_MEDIA_GENERATION_ENABLED=true and OPENAI_API_KEY in the worker environment. Gateway-only reference editing is deliberately rejected until its edit contract is verified. Production switch and billing configuration are unchanged. No authenticated website submission, cloud image edit with its credentials, or A3 chat round trip has been verified by this change.

The output explicitly carries visual_review=required. No claim of automated OCR, face detection, policy certification, or human acceptance is made. Free-form revisions guide generated backgrounds; copy/style changes use labeled fields. Native model design is stronger than the deterministic template in this small sample, but an all-in-one poster route still needs reliable text/brand review before adoption.

## Primary source contracts

- OpenAI image edits: https://developers.openai.com/api/reference/python/resources/images/methods/edit
- Ideogram typography/reference workflows: https://developer.ideogram.ai/
- Recraft style generation API: https://www.recraft.ai/api
- Bannerbear exact template modifications: https://developers.bannerbear.com/v5/
- Adobe Photoshop/Firefly automation: https://developer.adobe.com/firefly-services/docs/photoshop/

Only OpenAI image-edit support is added. Other services were researched or tested through connectors; no unverified adapters are added.

