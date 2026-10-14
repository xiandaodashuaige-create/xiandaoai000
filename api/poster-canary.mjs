import { runOne } from './video-worker.mjs';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const access = process.env.VIDEO_AGENT_ACCESS;
  if (!access) return res.status(503).json({ error: 'video_agent_access_not_configured' });
  const oidcToken = String(req.headers['x-vercel-oidc-token'] || process.env.VERCEL_OIDC_TOKEN || '');
  const result = await runOne(access, {
    ...process.env,
    AI_MEDIA_GENERATION_ENABLED: 'true',
    OPENAI_IMAGE_MODEL: 'recraft/recraft-v4.1-flash',
    OPENAI_IMAGE_SIZE: '1024x1024',
    VERCEL_OIDC_TOKEN: oidcToken,
  });
  return res.status(result.ok ? 200 : 202).json(result);
}
