# Cloud media providers

The cloud video worker keeps remixing deterministic and enables paid AI media only behind an explicit switch.

## Required switch

```text
AI_MEDIA_GENERATION_ENABLED=true
```

Without this switch, no paid image or video generation request is sent. An `ai_hybrid` job without uploaded `ai_hook`/`ai_cta` assets fails explicitly and never falls back to a local remix that could be mistaken for AI-generated footage.

## GPT image generation

```text
OPENAI_API_KEY=...
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_SIZE=1088x1360
OPENAI_IMAGE_QUALITY=medium
```

This powers poster background generation when no main image is uploaded. AI Hybrid requires a real video provider and never substitutes a generated still.

On Vercel, the same adapter can run without exporting a provider secret. If `OPENAI_API_KEY` is absent, the worker reads the deployment's short-lived OIDC token from Vercel's runtime `x-vercel-oidc-token` request header (or `VERCEL_OIDC_TOKEN` during build/local use), sends the OpenAI-compatible request to AI Gateway, and selects `openai/gpt-image-2`. A direct provider key remains supported for non-Vercel runtimes and existing BYOK deployments. The token is never logged or returned by the capability endpoint.

## Seedance

```text
AI_VIDEO_PROVIDER=seedance
ARK_API_KEY=...
SEEDANCE_API_BASE=https://ark.ap-southeast.bytepluses.com/api/v3
SEEDANCE_VIDEO_MODEL=dreamina-seedance-2-5-260628
AI_PROVIDER_MAX_WAIT_MS=210000
```

For the Volcengine China endpoint, set `SEEDANCE_API_BASE=https://ark.cn-beijing.volces.com/api/v3` and use the matching model ID available to that account.

## Vercel AI Gateway video

Vercel deployments can use their short-lived OIDC identity, so no provider key is exported:

```text
AI_VIDEO_PROVIDER=vercel-ai-gateway
AI_GATEWAY_VIDEO_MODEL=klingai/kling-v3.0-i2v
AI_GATEWAY_VIDEO_QUALITY=std
AI_PROVIDER_MAX_WAIT_MS=210000
```

The worker submits asynchronous Gateway jobs with a stable idempotency key per V3 job and scene. When a `character_reference` image is uploaded, the same image is sent to both the hook and CTA generations so identity is anchored across the two clips. The artifact records the provider, exact model, Gateway task ID, checksum, and whether the character reference was used.

## Runway

```text
AI_VIDEO_PROVIDER=runway
RUNWAYML_API_SECRET=...
RUNWAY_VIDEO_MODEL=gen4.5
AI_PROVIDER_MAX_WAIT_MS=210000
```

`AI_VIDEO_PROVIDER=auto` prefers a configured AI Gateway video model, then Seedance, then Runway. Provider output is size-bounded and passed through the same 1080×1920 render and quality gates as uploaded media.

Do not enable the switch until billing limits, credentials, and a small canary budget are approved. The worker never exposes secret values in its capability endpoint.
