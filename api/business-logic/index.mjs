import { getEntries, addEntry } from '../_lib/business-logic-store.mjs';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json(getEntries());
  }
  if (req.method === 'POST') {
    const { title, content } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: 'Missing title or content' });
    }
    return res.status(200).json(addEntry({ title, content }));
  }
  res.status(405).json({ error: 'Method not allowed' });
}
