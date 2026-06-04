const crypto = require('crypto');

const SECRET = process.env.TOKEN_SECRET || 'apple-game-secret-2024';
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET;
const FIREBASE_URL = `https://firestore.googleapis.com/v1/projects/applegame-63e6c/databases/(default)/documents`;

// 사용된 토큰 저장 (메모리, Vercel 재시작 시 초기화되지만 충분함)
const usedTokens = new Set();

async function verifyRecaptcha(token) {
  const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `secret=${RECAPTCHA_SECRET}&response=${token}`,
  });
  const data = await res.json();
  return data.success && data.score >= 0.5;
}

function verifyToken(tokenStr, ip, ua) {
  try {
    const [payloadB64, sig] = tokenStr.split('.');
    if (!payloadB64 || !sig) return null;

    const payloadStr = Buffer.from(payloadB64, 'base64').toString('utf8');
    const expectedSig = crypto.createHmac('sha256', SECRET).update(payloadStr).digest('hex');
    if (sig !== expectedSig) return null; // 위조 토큰

    const payload = JSON.parse(payloadStr);

    // IP 확인
    const clientIp = ip.split(',')[0].trim();
    if (payload.ip !== clientIp) return null;

    // 토큰 재사용 확인
    if (usedTokens.has(tokenStr)) return null;

    return payload;
  } catch {
    return null;
  }
}

async function saveToFirebase(collection, data) {
  // Firebase REST API로 저장 (서버사이드)
  const fields = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'number') fields[k] = { integerValue: String(Math.floor(v)) };
  }
  fields['createdAt'] = { timestampValue: new Date().toISOString() };

  const res = await fetch(`${FIREBASE_URL}/${collection}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.FIREBASE_TOKEN}`,
    },
    body: JSON.stringify({ fields }),
  });
  return res.ok;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://hnr09.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { gameToken, recaptchaToken, name, score, time, gameType } = req.body || {};
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const ua = req.headers['user-agent'] || '';

  // 1. 입력값 검증
  if (!gameToken || !recaptchaToken || !name || score === undefined) {
    return res.status(400).json({ error: '필수 값 누락' });
  }
  if (typeof name !== 'string' || name.length < 1 || name.length > 10) {
    return res.status(400).json({ error: '닉네임 오류' });
  }

  // 2. 점수 범위 검증
  if (gameType === 'puzzle') {
    if (!Number.isInteger(score) || score < 0 || score > 170) {
      return res.status(400).json({ error: '유효하지 않은 점수' });
    }
  } else if (gameType === 'survivor') {
    if (!Number.isInteger(time) || time < 0 || time > 7200) {
      return res.status(400).json({ error: '유효하지 않은 시간' });
    }
  }

  // 3. 토큰 검증
  const payload = verifyToken(gameToken, ip, ua);
  if (!payload) {
    return res.status(403).json({ error: '유효하지 않은 게임 토큰' });
  }

  // 4. 게임 시간 검증 (퍼즐: 최소 30초, 최대 130초 / 서바이버: 최소 10초)
  const elapsed = (Date.now() - payload.issuedAt) / 1000;
  if (gameType === 'puzzle' && (elapsed < 30 || elapsed > 130)) {
    return res.status(403).json({ error: '게임 시간 오류' });
  }
  if (gameType === 'survivor' && elapsed < 10) {
    return res.status(403).json({ error: '게임 시간 오류' });
  }

  // 5. gameType 일치 확인
  if (payload.gameType !== gameType) {
    return res.status(403).json({ error: '게임 타입 불일치' });
  }

  // 6. reCAPTCHA 검증
  const captchaOk = await verifyRecaptcha(recaptchaToken);
  if (!captchaOk) {
    return res.status(403).json({ error: 'reCAPTCHA 실패' });
  }

  // 7. 토큰 소각 (재사용 방지)
  usedTokens.add(gameToken);
  setTimeout(() => usedTokens.delete(gameToken), 1000 * 60 * 10); // 10분 후 정리

  // 8. Firebase에 저장
  const collection = gameType === 'puzzle' ? 'rankings' : 'survivor_rankings';
  const saveData = gameType === 'puzzle'
    ? { name, score }
    : { name, score: score || 0, time: time || 0 };

  const saved = await saveToFirebase(collection, saveData);
  if (!saved) return res.status(500).json({ error: '저장 실패' });

  return res.status(200).json({ ok: true });
}
