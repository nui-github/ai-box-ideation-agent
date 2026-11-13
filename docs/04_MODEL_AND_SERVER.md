# AI Model & Server Mechanics

The agent's intelligence is powered by Google Gemini through `@google/genai` library, managed by `server.mjs`.

## Backend Logic (`server.mjs`)
1. **Fallback Strategy**: The server implements an automatic fallback mechanism for rate limits. If `gemini-3.5-flash` hits a quota exhaustion limit (`429` / `RESOURCE_EXHAUSTED`), the server catches this and automatically steps over to a fallback array: `gemini-3.1-flash-lite`, `gemini-2.5-flash` (`gemini-3.8-flash` and `gemini-flash-latest` were removed: their requests hung without ever answering).
2. **Endpoint:**
   - `POST /api/generate`: Receives `{ prompt, context, selectedModel }`. Expects a JSON response with the generated analysis.
3. **Environment:** Look for `GEMINI_API_KEY` in `.env`.

## Data Handling & Formatting
When the Angular app calls `/api/generate`, the response from Gemini is expected to be unstructured markdown or roughly formatted tags. The frontend code in `app.component.ts` transforms logic based on regex (e.g. `transformGeneratedText(text)`) into HTML safe tags combining `<div class="section-card">` components.

If you modify the prompt or add new "Sections" (like a Pro/Con list), you MUST update the Regex parsers in the Angular UI or change how the model structures its JSON response.

## Non-Gemini models (OpenRouter)
Besides Gemini, the Settings dropdown offers a model served through [OpenRouter](https://openrouter.ai) (OpenAI-compatible API). They are defined in `api/_lib/openrouter.mjs`:

| Dropdown name | OpenRouter model | Notes |
|---|---|---|
| `groq-llama-3.3-70b` | `meta-llama/llama-3.3-70b-instruct` | Pinned to the Groq provider (`provider.only: ['Groq']`, no fallback) |

- Key: `OPENROUTER_API_KEY` in `.env.local` (gitignored) locally, and as a project environment variable on Vercel. Never commit it.
- These models do **not** fall back to Gemini. If the call fails the error is shown, so the user knows the chosen model did not answer.
- `max_tokens` is capped (16000) so OpenRouter does not reserve credit for the whole context window.
- To add another model, add an entry to `EXTERNAL_MODELS`, to `modelLimits` in `gemini-design.mjs`, and to the model lists in `app.component.ts`.

DeepSeek-R1 (`deepseek/deepseek-r1-0528`) was tried and removed: it is a paid model and the OpenRouter account had no credit. To bring it back, add the entry to `EXTERNAL_MODELS`, `modelLimits` and the lists in `app.component.ts` once the account has credit.
