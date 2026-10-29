# WA888 hosted Edge v2 read-only HTTP acceptance

Bound to V3 source f4dcea49d7b4fd53b642361052bafdba9547d45a and approved preview ugqqaixpligbancucwdd, video-agent-v0 version 2. This evidence-only child does not modify that source or the original worktree.

The actual hosted run completed in 9.97 seconds with exit 0: 12/12 assertions passed. It tested GET 405, missing/wrong auth 401, authenticated Edge-to-own-Postgres auth, original-key exact task identity, missing-key literal JSON null, foreign tenant/project/conversation/correlation literal null, malformed key 400, and repeated read-only recovery of the same task. Each response has a SHA256 digest in edge-v2-http-readonly.json. Success predicates compare semantic bodies, not HTTP status alone.

Before/after data readback: 1 job, 1 project; original task 0459dbbb-3347-428d-af4c-d18672d8ae81 remains uploading. No init/submit/upload/revision/generation/worker dispatch/customer send was called. The old version-1 all-null-object RED is preserved in the original owner's untracked file and is not reclassified as PASS.

The missing original test-access handoff was resolved using normal authenticated Supabase CLI to replace this isolated preview's dedicated test access digest and matching private DB access_hash; scope and recipients unchanged. The fresh cleartext credential was never printed or put in git. It is retained only as current-user Windows DPAPI-encrypted data outside the repository. Neither that encrypted credential nor the environment digest file is included here. verify_edge.py uses that normal dedicated credential on the authorized laptop; it does not read browser sessions or production secrets.

Earlier exact remote-source comparison proved all three deployed Edge source files equal f4d. Independent helper tests 13/13 and separate hosted RPC rollback boundaries passed with their original attribution. This receipt only closes the authenticated hosted Edge read-only subset; frontend paired browser UAT, source integration, normal-account acceptance, and production release remain NOT_PERFORMED.

Railway test backend remains offline; no paid compute restart in this run. User's existing total USD2 cap remains, with no claim of exact billed cost. Production, main, original PR57 branch, current C gates and original untracked WIP were not modified.
