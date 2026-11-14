# Video Factory

Video-generation service and worker pipelines with local and cloud execution paths, media assembly, quality gates and provider adapters.

## Main areas
- Video and poster generation.
- Local Worker and cloud Worker paths.
- Media assembly, voice/audio/subtitle/CTA handling.
- Output quality checks and artifact manifests.
- Job lifecycle, revision, feedback and download.
- Provider adapter contracts for external consumers.

## Development entry
Read [AGENTS.md](AGENTS.md), [CLAUDE.md](CLAUDE.md) and [docs/ai-knowledge/README.md](docs/ai-knowledge/README.md), then the owning Issue and exact PR head.

## Safety
- Paid generation stays behind explicit flags, configured credentials and quota controls.
- Do not expose keys, signed URLs, customer assets or private integration context.
- A health endpoint or adapter contract is not proof of real generation.
- Keep the local fallback until cloud quality and runtime parity are independently verified.
