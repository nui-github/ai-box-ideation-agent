# AI Model & Server Mechanics

The agent's intelligence is powered by Google Gemini through `@google/genai` library, managed by `server.mjs`.

## Backend Logic (`server.mjs`)
1. **Fallback Strategy**: The server implements an automatic fallback mechanism for rate limits. If `gemini-3.5-flash` hits a quota exhaustion limit (`429` / `RESOURCE_EXHAUSTED`), the server catches this and automatically steps over to a fallback array: `gemini-3.1-flash-lite`, `gemini-flash-latest`, `gemini-2.5-flash`.
2. **Endpoint:**
   - `POST /api/generate`: Receives `{ prompt, context, selectedModel }`. Expects a JSON response with the generated analysis.
3. **Environment:** Look for `GEMINI_API_KEY` in `.env`.

## Data Handling & Formatting
When the Angular app calls `/api/generate`, the response from Gemini is expected to be unstructured markdown or roughly formatted tags. The frontend code in `app.component.ts` transforms logic based on regex (e.g. `transformGeneratedText(text)`) into HTML safe tags combining `<div class="section-card">` components.

If you modify the prompt or add new "Sections" (like a Pro/Con list), you MUST update the Regex parsers in the Angular UI or change how the model structures its JSON response.
