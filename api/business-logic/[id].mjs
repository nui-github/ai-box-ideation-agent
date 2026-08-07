import { deleteEntry, updateEntry } from '../_lib/business-logic-store.mjs';

export default async function handler(req, res) {
  const { id } = req.query;

  if (req.method === 'DELETE') {
    return res.status(200).json(deleteEntry(id));
  }

  if (req.method === 'PUT') {
    const { title, content } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: 'Missing title or content' });
    }
    const entry = updateEntry(id, { title, content });
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    return res.status(200).json(entry);
  }

  res.status(405).json({ error: 'Method not allowed' });
}
