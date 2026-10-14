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

## Runway

```text
AI_VIDEO_PROVIDER=runway
RUNWAYML_API_SECRET=...
RUNWAY_VIDEO_MODEL=gen4.5
AI_PROVIDER_MAX_WAIT_MS=210000
```

`AI_VIDEO_PROVIDER=auto` prefers Seedance when both keys exist, then Runway. Provider output is downloaded only from public HTTPS URLs, is size-bounded, and is passed through the same 1080×1920 render and quality gates as uploaded media.

Do not enable the switch until billing limits, credentials, and a small canary budget are approved. The worker never exposes secret values in its capability endpoint.

## Voice fallback

Edge TTS remains the zero-configuration default. To permit a paid OpenAI fallback after Edge is unavailable, configure:

```text
OPENAI_TTS_ENABLED=true
OPENAI_API_KEY=...
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=marin
TTS_PROVIDER=auto
```

`TTS_PROVIDER=edge` disables fallback. `TTS_PROVIDER=openai` uses OpenAI directly and still requires `OPENAI_TTS_ENABLED=true`. Uploaded voiceover always has priority over both providers. The worker records `voice_source`, `voice_provider`, and any `voice_error` in the output artifact. Customer-facing playback must disclose that generated narration is an AI voice.

## Reference pacing and transitions

A visual input with `role=reference` is analyzed only for scene-cut rhythm. Its pixels and audio never enter the output timeline. The five storyboard beat lengths are softly adapted to that rhythm while preserving the campaign's planned total duration. Every scene is rendered with an extra 0.5-second visual handle, then joined with a soft dissolve; the assembled source-audio track and scene voice track retain the original logical duration, preventing the CTA narration from being truncated.
