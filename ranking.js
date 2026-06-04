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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://hnr09.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { type } = req.query;
  const collection = type === 'survivor' ? 'survivor_rankings' : 'rankings';
  const orderField = type === 'survivor' ? 'time' : 'score';

  try {
    const firedb = getDb();
    const snap = await firedb.collection(collection).orderBy(orderField, 'desc').limit(10).get();
    const list = snap.docs.map(d => ({ id: d.id, ...d.data(), createdAt: undefined }));
    return res.status(200).json({ list });
  } catch(e) {
    return res.status(500).json({ error: '불러오기 실패' });
  }
}
