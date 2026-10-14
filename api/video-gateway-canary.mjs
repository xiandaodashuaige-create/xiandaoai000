import crypto from 'node:crypto';
import {
  experimental_getVideoStatus as getVideoStatus,
  experimental_startVideo as startVideo,
} from 'ai';

export const config = { maxDuration: 60 };

const MODEL = 'bytedance/seedance-v1.0-pro-fast';
const CONFIRMATION = 'LULIAN_V3_CANARY_20261014';
const PROMPT = [
  'Vertical 9:16 smartphone UGC advertising shot for a beauty salon.',
  'A real Chinese beauty salon owner in her early 30s stands inside a busy modern salon and addresses the phone camera.',
  'She uses natural hand gestures, a confident friendly expression, and takes one small step toward the camera.',
  'Handheld phone realism, natural indoor fluorescent light, realistic skin texture, real salon beds and staff softly visible behind her.',
  'One continuous shot, commercially usable composition, leave clean lower-third space for captions added later.',
  'No subtitles, no logos, no on-screen text, no watermark, no beauty-filter plastic skin, no warped fingers.',
].join(' ');

function secureEqual(left, right) {
  const a = crypto.createHash('sha256').update(String(left || '')).digest();
  const b = crypto.createHash('sha256').update(String(right || '')).digest();
  return crypto.timingSafeEqual(a, b);
}

function authorize(req) {
  return secureEqual(req.headers['x-video-access'], process.env.VIDEO_AGENT_ACCESS);
}

function compactVideo(video) {
  return {
    url: video?.url || video?.providerMetadata?.url || video?.providerMetadata?.downloadUrl || null,
    mediaType: video?.mediaType || null,
    hasInlineBytes: Boolean(video?.uint8Array || video?.base64),
    providerMetadata: video?.providerMetadata || null,
  };
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      service: 'v3-ai-video-gateway-canary',
      model: MODEL,
      billable: true,
      fixedDurationSeconds: 5,
      fixedResolution: '720p',
      fixedAspectRatio: '9:16',
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!authorize(req)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (req.body?.confirmation !== CONFIRMATION) {
    return res.status(400).json({ error: 'confirmation_required' });
  }

  try {
    if (req.body?.action === 'start') {
      const { operation, warnings } = await startVideo({
        model: MODEL,
        prompt: PROMPT,
        aspectRatio: '9:16',
        resolution: '720p',
        duration: 5,
      });
      return res.status(202).json({ ok: true, model: MODEL, operation, warnings: warnings || [] });
    }

    if (req.body?.action === 'status') {
      const serialized = JSON.stringify(req.body?.operation || null);
      if (serialized.length > 20000) {
        return res.status(400).json({ error: 'operation_too_large' });
      }
      const result = await getVideoStatus(MODEL, { operation: req.body.operation });
      return res.status(200).json({
        ...result,
        videos: Array.isArray(result.videos) ? result.videos.map(compactVideo) : [],
      });
    }

    return res.status(400).json({ error: 'unsupported_action' });
  } catch (error) {
    return res.status(502).json({
      error: 'gateway_video_canary_failed',
      detail: error instanceof Error ? error.message : String(error),
      cause: error?.cause instanceof Error ? error.cause.message : undefined,
    });
  }
}
