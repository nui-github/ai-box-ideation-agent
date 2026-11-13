// Non-Gemini models, served through OpenRouter's OpenAI-compatible API.
// The key lives in the OPENROUTER_API_KEY env var (.env.local locally, project env on Vercel).

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Without a cap OpenRouter reserves credit for the model's whole context window and rejects the
// request when the balance is lower than that. 16k covers a full analysis.
const MAX_OUTPUT_TOKENS = 16000;

// App model name (what the Settings dropdown shows) -> OpenRouter request settings.
export const EXTERNAL_MODELS = {
  'groq-llama-3.3-70b': {
    id: 'meta-llama/llama-3.3-70b-instruct',
    // Pin to Groq's own inference so "Groq" really means Groq
    provider: { only: ['Groq'], allow_fallbacks: false }
  }
};

export function isExternalModel(name) {
  return Object.prototype.hasOwnProperty.call(EXTERNAL_MODELS, name);
}

/**
 * Streams a completion to `res` using the same NDJSON contract as the Gemini path:
 * {"chunk": "..."} lines, then {"done": true}, or {"error": "..."}.
 * Reasoning tokens (if a reasoning model is added) are not forwarded, only the final answer.
 */
export async function streamExternalModel(modelName, { messages, systemInstruction }, res) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า OPENROUTER_API_KEY บนเซิร์ฟเวอร์ จึงยังใช้โมเดลนี้ไม่ได้' });
  }

  const { id, provider } = EXTERNAL_MODELS[modelName];
  const upstream = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'Product Owner (PO) assistant agent'
    },
    body: JSON.stringify({
      model: id,
      stream: true,
      max_tokens: MAX_OUTPUT_TOKENS,
      ...(provider ? { provider } : {}),
      messages: [
        { role: 'system', content: systemInstruction },
        ...messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
      ]
    })
  });

  if (!upstream.ok) {
    let detail = '';
    try {
      const body = await upstream.json();
      detail = body?.error?.message || JSON.stringify(body);
    } catch {
      detail = upstream.statusText;
    }
    if (upstream.status === 402) {
      return res.status(402).json({ error: `เครดิต OpenRouter ไม่พอสำหรับ ${modelName} กรุณาเติมเครดิตที่ openrouter.ai/credits แล้วลองใหม่ (${detail})` });
    }
    return res.status(upstream.status === 429 ? 429 : 502).json({ error: `${modelName}: ${detail}` });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const decoder = new TextDecoder();
  let buffer = '';
  let produced = false;

  const handleLine = (line) => {
    if (!line.startsWith('data:')) return; // SSE comments (": OPENROUTER PROCESSING") and blanks
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;

    let json;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    if (json.error) {
      res.write(JSON.stringify({ error: `${modelName}: ${json.error.message || 'upstream error'}` }) + '\n');
      return;
    }
    const text = json.choices?.[0]?.delta?.content;
    if (text) {
      produced = true;
      res.write(JSON.stringify({ chunk: text }) + '\n');
    }
  };

  try {
    for await (const part of upstream.body) {
      buffer += decoder.decode(part, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(handleLine);
    }
    if (buffer) handleLine(buffer);

    if (!produced) {
      res.write(JSON.stringify({ error: `${modelName}: โมเดลไม่ได้ส่งคำตอบกลับมา` }) + '\n');
    }
    res.write(JSON.stringify({ done: true }) + '\n');
  } catch (err) {
    res.write(JSON.stringify({ error: `Streaming interrupted: ${String(err.message || err)}` }) + '\n');
  }
  res.end();
}
