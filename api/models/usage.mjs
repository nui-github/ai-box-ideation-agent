import { getModelUsage } from '../_lib/gemini-design.mjs';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const models = ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
  const stats = models.map(m => ({ model: m, ...getModelUsage(m) }));
  res.status(200).json(stats);
}
