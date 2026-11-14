# Video Factory — Agent Contract

## Start
1. Read this file and [docs/ai-knowledge/README.md](docs/ai-knowledge/README.md).
2. Read the owning Issue, current PR and exact head/base SHA.
3. Inspect the actual worker, adapter and runtime caller before claiming capability.
4. Check duplicate work, branch ancestry and allowed file ownership.

## Capability truth
Report separately:
- CODE_EXISTS
- RUNTIME_WIRED
- REAL_GENERATION_VERIFIED
- PRODUCTION_READY (only after applicable deployment and runtime gates)

A provider adapter, health endpoint, unit test or Preview is not proof of real paid generation.

## Safety
- Do not enable paid generation, change provider credentials, raise limits or send real customer media without the applicable Owner gate.
- Keep local Worker fallback until cloud samples pass the accepted quality bar.
- Preserve output manifest, checksum, dimensions, frame rate, audio and media provenance.
- Treat signed URLs as sensitive and respect expiry.
- Do not commit customer source media, credentials, raw production artifacts or private cross-project history.

## Public repository boundary
This repository is public. Never add private business repo internals, customer data, private credentials, account identifiers or internal automation prompts. Cross-project references must remain generic and safe for public visibility.

## Validation
Use the repository's prescribed tests and exact-SHA review. Real generation must be separately identified from mocked/fixture tests. The author cannot be the final independent Verifier.
