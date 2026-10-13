import crypto from 'node:crypto';

export const config = { maxDuration: 300 };

const DEFAULT_EMPLOYEE_ACCESS = 'lulian';
const DEFAULT_SUPABASE_URL = 'https://ejspsxjeelhsevldmnhl.supabase.co';
const EDGE_FUNCTION = 'video-agent-v0';

function env(name, fallback = '') {
  return process.env[name] || fallback;
}

function constantTimeEqual(supplied, expected) {
  const suppliedDigest = crypto.createHash('sha256').update(String(supplied)).digest();
  const expectedDigest = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(suppliedDigest, expectedDigest);
}

function employeeAuthorised(req) {
  const supplied = String(req.headers['x-employee-access'] || '');
  const expected = env('VIDEO_EMPLOYEE_ACCESS', DEFAULT_EMPLOYEE_ACCESS);
  return supplied.length > 0 && constantTimeEqual(supplied, expected);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!employeeAuthorised(req)) return res.status(401).json({ error: 'unauthorized' });

  const providerAccess = env('VIDEO_AGENT_ACCESS');
  const publishableKey = env('SUPABASE_PUBLISHABLE_KEY');
  if (!providerAccess || !publishableKey) {
    return res.status(503).json({ error: 'video_gateway_not_configured' });
  }

  try {
    const response = await fetch(
      `${env('SUPABASE_URL', DEFAULT_SUPABASE_URL)}/functions/v1/${EDGE_FUNCTION}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: publishableKey,
          'x-video-access': providerAccess,
        },
        body: JSON.stringify(req.body || {}),
      },
    );
    const text = await response.text();
    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json; charset=utf-8');
    return res.send(text);
  } catch (error) {
    return res.status(502).json({
      error: 'video_provider_unavailable',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
