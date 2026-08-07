import { deleteEntry } from '../_lib/business-logic-store.mjs';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { id } = req.query;
  res.status(200).json(deleteEntry(id));
}
