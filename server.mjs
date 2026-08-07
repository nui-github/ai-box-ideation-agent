import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { handleDesignRequest, getModelUsage, MODEL_IDS } from './api/_lib/gemini-design.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const isDev = process.argv.includes('--dev');
const port = isDev ? 3001 : (process.env.PORT || 3000);

app.use(express.json());
app.use(cors());

app.get('/api/models/usage', (req, res) => {
  const stats = MODEL_IDS.map(m => ({ model: m, ...getModelUsage(m) }));
  res.json(stats);
});

app.post('/api/design', (req, res) => handleDesignRequest(req, res));

// Enforce JSON for unmatched API routes
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `API Route not found: ${req.method} ${req.originalUrl}` });
});

// Generic error handler for express middleware errors
app.use((err, req, res, next) => {
  console.error('Express Error:', err);
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(500).json({ error: 'Internal Server Error: ' + err.message });
  }
  next(err);
});

app.use(express.static(path.join(__dirname, 'dist/browser')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist/browser/index.html'));
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
