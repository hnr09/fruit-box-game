const crypto = require('crypto');

const SECRET = process.env.TOKEN_SECRET || 'apple-game-secret-2024';
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET;

// Firebase Admin 초기화
let db = null;
function getDb() {
  if (db) return db;
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  db = admin.firestore();
  return db;
}

const usedTokens = new Set();

async function verifyRecaptcha(token) {
  try {
    const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${RECAPTCHA_SECRET}&response=${token}`,
    });
    const data = await res.json();
    return data.success && data.score >= 0.5;
  } catch { return false; }
}

function verifyToken(tokenStr, ip) {
  try {
    const [payloadB64, sig] = tokenStr.split('.');
    if (!payloadB64 || !sig) return null;
    const payloadStr = Buffer.from(payloadB64, 'base64').toString('utf8');
    const expectedSig = crypto.createHmac('sha256', SECRET).update(payloadStr).digest('hex');
    if (sig !== expectedSig) return null;
    if (usedTokens.has(tokenStr)) return null;
    const payload = JSON.parse(payloadStr);
    if (payload.ip !== ip) return null;
    return payload;
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://hnr09.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { gameToken, recaptchaToken, name, score, time, gameType } = req.body || {};
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();

  // 1. 입력값 검증
  if (!gameToken || !recaptchaToken || !name) return res.status(400).json({ error: '값 누락' });
  if (typeof name !== 'string' || name.length < 1 || name.length > 10) return res.status(400).json({ error: '닉네임 오류' });

  // 2. 점수 범위
  if (gameType === 'puzzle') {
    if (!Number.isInteger(score) || score < 0 || score > 170) return res.status(400).json({ error: '점수 오류' });
  } else if (gameType === 'survivor') {
    if (!Number.isInteger(time) || time < 0 || time > 7200) return res.status(400).json({ error: '시간 오류' });
  }

  // 3. 토큰 검증
  const payload = verifyToken(gameToken, ip);
  if (!payload) return res.status(403).json({ error: '토큰 오류' });

  // 4. 게임 시간 검증
  const elapsed = (Date.now() - payload.issuedAt) / 1000;
  if (gameType === 'puzzle' && (elapsed < 30 || elapsed > 135)) return res.status(403).json({ error: '시간 오류' });
  if (gameType === 'survivor' && elapsed < 10) return res.status(403).json({ error: '시간 오류' });
  if (payload.gameType !== gameType) return res.status(403).json({ error: '게임 타입 오류' });

  // 5. reCAPTCHA
  const captchaOk = await verifyRecaptcha(recaptchaToken);
  if (!captchaOk) return res.status(403).json({ error: 'reCAPTCHA 실패' });

  // 6. 토큰 소각
  usedTokens.add(gameToken);
  setTimeout(() => usedTokens.delete(gameToken), 600000);

  // 7. Firebase 저장
  try {
    const firedb = getDb();
    const collection = gameType === 'puzzle' ? 'rankings' : 'survivor_rankings';
    const data = gameType === 'puzzle'
      ? { name, score, createdAt: new Date() }
      : { name, score: score || 0, time: time || 0, createdAt: new Date() };
    await firedb.collection(collection).add(data);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: '저장 실패' });
  }
}
