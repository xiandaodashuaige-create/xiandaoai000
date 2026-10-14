import crypto from 'node:crypto';

export const config = { maxDuration: 300 };

const ALLOWED_ACTIONS = new Set([
  'provider_upsert_project', 'provider_init_job', 'provider_status',
  'provider_sign_upload', 'provider_submit_job', 'provider_download_url',
  'provider_create_revision', 'provider_record_feedback', 'provider_accept_job',
]);

const JOB_ACTIONS = new Set([
  'provider_status', 'provider_sign_upload', 'provider_submit_job',
  'provider_download_url', 'provider_record_feedback', 'provider_accept_job',
]);

function secureEqual(left, right) {
  const a = crypto.createHash('sha256').update(String(left || '')).digest();
  const b = crypto.createHash('sha256').update(String(right || '')).digest();
  return crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      service: 'v3-video-employee-provider',
      contract_version: '1.0',
      integration_target: 'v3-ads-employee',
      configured: Boolean(process.env.A3_VIDEO_PROVIDER_TOKEN && process.env.VIDEO_AGENT_ACCESS && process.env.SUPABASE_PUBLISHABLE_KEY),
      actions: [...ALLOWED_ACTIONS],
      workflows: ['remix', 'ai_hybrid', 'image_poster'],
    });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const expected = process.env.A3_VIDEO_PROVIDER_TOKEN;
  if (!expected || !secureEqual(req.headers.authorization?.replace(/^Bearer\s+/i, ''), expected)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const action = String(req.body?.action || '');
  if (!ALLOWED_ACTIONS.has(action)) return res.status(400).json({ error: 'unsupported_provider_action' });
  for (const required of ['tenant_id', 'project_id']) {
    if (!String(req.body?.[required] || '').trim()) return res.status(400).json({ error: `missing_${required}` });
  }
  if (action === 'provider_upsert_project') {
    for (const required of ['project_name', 'business_type']) {
      if (!String(req.body?.[required] || '').trim()) return res.status(400).json({ error: `missing_${required}` });
    }
  }
  if (action === 'provider_init_job') {
    for (const required of ['conversation_session_id', 'correlation_id', 'idempotency_key', 'brief']) {
      if (!String(req.body?.[required] || '').trim()) return res.status(400).json({ error: `missing_${required}` });
    }
    if (!['remix', 'ai_hybrid', 'image_poster'].includes(String(req.body?.workflow_mode || ''))) {
      return res.status(400).json({ error: 'invalid_workflow_mode' });
    }
  }
  if (JOB_ACTIONS.has(action) && !String(req.body?.job_id || '').trim()) {
    return res.status(400).json({ error: 'missing_job_id' });
  }
  if (action === 'provider_create_revision') {
    if (!String(req.body?.parent_job_id || '').trim()) return res.status(400).json({ error: 'missing_parent_job_id' });
    if (!String(req.body?.revision_prompt || '').trim()) return res.status(400).json({ error: 'missing_revision_prompt' });
  }
  if (action === 'provider_record_feedback' && !String(req.body?.feedback_text || '').trim()) {
    return res.status(400).json({ error: 'missing_feedback_text' });
  }
  const providerAccess = process.env.VIDEO_AGENT_ACCESS;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const supabaseUrl = process.env.SUPABASE_URL || 'https://ejspsxjeelhsevldmnhl.supabase.co';
  if (!providerAccess || !publishableKey) return res.status(503).json({ error: 'provider_not_configured' });
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/video-agent-v0`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: publishableKey, 'x-video-access': providerAccess },
      body: JSON.stringify(req.body),
    });
    const text = await response.text();
    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json; charset=utf-8');
    return res.send(text);
  } catch (error) {
    return res.status(502).json({ error: 'video_provider_unavailable', detail: error instanceof Error ? error.message : String(error) });
  }
}
