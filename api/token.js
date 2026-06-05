import crypto from 'crypto';

const SECRET = process.env.TOKEN_SECRET || 'apple-game-secret-2024';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://hnr09.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const gameType = req.body?.gameType || 'puzzle';

  const payload = { ip, issuedAt: now, gameType };
  const payloadStr = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', SECRET).update(payloadStr).digest('hex');
  const token = Buffer.from(payloadStr).toString('base64') + '.' + sig;

  return res.status(200).json({ token, issuedAt: now });
}
