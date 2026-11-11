import { getInstruction, setInstruction, resetInstruction, MAX_INSTRUCTION_LENGTH } from './_lib/instruction-store.mjs';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json(getInstruction());
  }
  if (req.method === 'PUT') {
    const prompt = req.body?.prompt;
    if (typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'Missing prompt' });
    }
    if (prompt.length > MAX_INSTRUCTION_LENGTH) {
      return res.status(400).json({ error: `Prompt too long (max ${MAX_INSTRUCTION_LENGTH} characters)` });
    }
    return res.status(200).json(setInstruction(prompt));
  }
  if (req.method === 'DELETE') {
    return res.status(200).json(resetInstruction());
  }
  res.status(405).json({ error: 'Method not allowed' });
}
