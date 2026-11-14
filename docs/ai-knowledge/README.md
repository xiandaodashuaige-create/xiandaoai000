# Video Factory — Knowledge Entry

## Read order
1. Root AGENTS.md.
2. Root CLAUDE.md when using Claude.
3. Relevant worker, provider and media documentation in this repository.
4. Owning Issue, current PR, exact base/head SHA and CI.
5. Verify runtime caller and real generation evidence before capability claims.

## Core areas
- Local Worker and cloud Worker.
- Video/poster generation pipeline.
- Media assembly, audio, voice, subtitles and CTA.
- Output quality and artifact manifest.
- Provider adapter, job lifecycle, revision and feedback.

## Public-repository rule
Only public-safe project documentation belongs here. Never copy private customer details, credentials, private repository architecture or cross-project internal history.

## Capability truth
CODE_EXISTS ≠ RUNTIME_WIRED ≠ REAL_GENERATION_VERIFIED. Mark provider credits/keys/configuration unknown unless freshly read from an authorized environment. Keep local fallback until equivalence is proven.

## External integration
Document the adapter contract and required caller behavior without exposing private consumer implementation. Consumer-side product orchestration belongs to its own repository.
