# Cloud media providers

The cloud video worker keeps remixing deterministic and enables paid AI media only behind an explicit switch.

## Required switch

```text
AI_MEDIA_GENERATION_ENABLED=true
```

Without this switch, no paid image or video generation request is sent. An `ai_hybrid` job without uploaded `ai_hook`/`ai_cta` assets fails explicitly and follows the existing cloud-to-local fallback path.

## GPT image generation

```text
OPENAI_API_KEY=...
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_SIZE=1088x1360
OPENAI_IMAGE_QUALITY=medium
```

This powers poster background generation when no main image is uploaded, and is the fallback source for AI Hybrid hook/CTA stills when no video provider is configured.

## Seedance

```text
AI_VIDEO_PROVIDER=seedance
ARK_API_KEY=...
SEEDANCE_API_BASE=https://ark.ap-southeast.bytepluses.com/api/v3
SEEDANCE_VIDEO_MODEL=dreamina-seedance-2-5-260628
AI_PROVIDER_MAX_WAIT_MS=210000
```

For the Volcengine China endpoint, set `SEEDANCE_API_BASE=https://ark.cn-beijing.volces.com/api/v3` and use the matching model ID available to that account.

## Runway

```text
AI_VIDEO_PROVIDER=runway
RUNWAYML_API_SECRET=...
RUNWAY_VIDEO_MODEL=gen4.5
AI_PROVIDER_MAX_WAIT_MS=210000
```

`AI_VIDEO_PROVIDER=auto` prefers Seedance when both keys exist, then Runway. Provider output is downloaded only from public HTTPS URLs, is size-bounded, and is passed through the same 1080×1920 render and quality gates as uploaded media.

Do not enable the switch until billing limits, credentials, and a small canary budget are approved. The worker never exposes secret values in its capability endpoint.
