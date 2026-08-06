import { handleDesignRequest } from './_lib/gemini-design.mjs';

export const config = {
  maxDuration: 60
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  await handleDesignRequest(req, res);
}
