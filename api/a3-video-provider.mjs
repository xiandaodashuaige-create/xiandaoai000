import crypto from 'node:crypto';

export const config = { maxDuration: 300 };

const ALLOWED_ACTIONS = new Set([
  'provider_upsert_project', 'provider_init_job', 'provider_status',
  'provider_sign_upload', 'provider_submit_job', 'provider_download_url',
  'provider_create_revision', 'provider_accept_job',
]);

function secureEqual(left, right) {
  const a = crypto.createHash('sha256').update(String(left || '')).digest();
  const b = crypto.createHash('sha256').update(String(right || '')).digest();
  return crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
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
  if (action === 'provider_init_job') {
    for (const required of ['conversation_session_id', 'correlation_id', 'idempotency_key']) {
      if (!String(req.body?.[required] || '').trim()) return res.status(400).json({ error: `missing_${required}` });
    }
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
