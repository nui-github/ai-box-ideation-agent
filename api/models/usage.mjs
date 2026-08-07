import { getModelUsage, MODEL_IDS } from '../_lib/gemini-design.mjs';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const stats = MODEL_IDS.map(m => ({ model: m, ...getModelUsage(m) }));
  res.status(200).json(stats);
}
