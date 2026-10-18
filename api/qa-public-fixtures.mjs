const FIXTURES = {
  person: {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/38/Business_Woman.jpg/960px-Business_Woman.jpg',
    type: 'image/jpeg',
    name: 'qa-character-reference.jpg',
  },
  proof: {
    url: 'https://developer.mozilla.org/shared-assets/videos/flower.mp4',
    type: 'video/mp4',
    name: 'qa-proof-footage.mp4',
  },
};

export default async function handler(req, res) {
  if (process.env.VERCEL_ENV !== 'preview') return res.status(404).json({ error: 'not_found' });
  const fixture = FIXTURES[String(req.query?.asset || '')];
  if (!fixture) return res.status(400).json({ error: 'invalid_fixture' });
  const response = await fetch(fixture.url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) return res.status(502).json({ error: 'fixture_fetch_failed' });
  const data = Buffer.from(await response.arrayBuffer());
  if (!data.length || data.length > 20 * 1024 * 1024) return res.status(502).json({ error: 'fixture_invalid_size' });
  res.setHeader('Content-Type', fixture.type);
  res.setHeader('Content-Disposition', `attachment; filename="${fixture.name}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).send(data);
}
