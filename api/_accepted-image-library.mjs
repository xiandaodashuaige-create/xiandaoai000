const SHA256 = /^[a-f0-9]{64}$/i;
const exact = (v) => typeof v === 'string' && /^[^\s\u0000-\u001f\u007f]{1,128}$/u.test(v);
const stamp = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));

/** Read checksum-bound confirmed images, using a tenant-scoped seek cursor. */
export async function readAcceptedImageLibrary(post, tenantId, projectId, cursor) {
  if (!exact(tenantId) || !exact(projectId) ||
      (cursor !== undefined && (!stamp(cursor?.acceptedAt) || !exact(cursor?.jobId)))) {
    throw new Error('invalid_library_scope');
  }
  const result = await post({
    action: 'provider_list_accepted_images', tenant_id: tenantId, project_id: projectId,
    ...(cursor ? { cursor } : {}),
  });
  if (result?.ok !== true || !Array.isArray(result.jobs) || result.jobs.length > 31) throw new Error('library_jobs_unavailable');
  const jobs = [];
  const seen = new Set();
  for (const job of result.jobs) {
    if (job?.external_tenant_id !== tenantId || job?.external_project_id !== projectId) throw new Error('library_scope_mismatch');
    const file = job.output_files?.[0];
    if (job.status !== 'completed' || !stamp(job.accepted_at) || !SHA256.test(job.output_sha256 ?? '') ||
        !exact(job.id) || !exact(job.conversation_session_id) || !Number.isInteger(job.version_number) ||
        job.version_number < 1 || seen.has(job.id) || !file ||
        typeof file.path !== 'string' || file.path.length > 2048 ||
        !/\.(?:png|jpe?g|webp)$/i.test(file.path) ||
        (file.type && !/^image\/(?:png|jpeg|webp)$/i.test(file.type))) throw new Error('library_job_invalid');
    seen.add(job.id);
    jobs.push({
      id: job.id, external_tenant_id: tenantId, external_project_id: projectId,
      conversation_session_id: job.conversation_session_id, version_number: job.version_number,
      status: 'completed', accepted_at: job.accepted_at, output_sha256: job.output_sha256,
      output_files: [{ path: file.path, ...(file.type ? { type: file.type } : {}) }],
    });
  }
  // The provider SQL owns ordering and the 31st row is a pagination sentinel.
  const limited = jobs.length > 30;
  const page = jobs.slice(0, 30);
  const last = page.at(-1);
  return { ok: true, jobs: page, limited,
    ...(limited ? { nextCursor: { acceptedAt: last.accepted_at, jobId: last.id } } : {}) };
}
