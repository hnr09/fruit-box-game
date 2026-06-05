const admin = require('firebase-admin');

if (!admin.apps.length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://hnr09.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { type } = req.query;
  const collection = type === 'survivor' ? 'survivor_rankings' : 'rankings';
  const orderField = type === 'survivor' ? 'time' : 'score';

  try {
    const snap = await db.collection(collection).orderBy(orderField, 'desc').limit(10).get();
    const list = snap.docs.map(d => {
      const data = d.data();
      return { id: d.id, name: data.name, score: data.score || 0, time: data.time || 0 };
    });
    return res.status(200).json({ list });
  } catch(e) {
    return res.status(500).json({ error: '불러오기 실패: ' + e.message });
  }
}
