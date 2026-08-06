# Tech Stack & Architecture

## Stack
- **Frontend Framework:** Angular (v18+)
- **UI Library:** ng-zorro-antd (Ant Design for Angular)
- **Icons:** `lucide-angular`
- **Styling:** SCSS (Custom styles overriding Ant Design variables, no Tailwind)
- **Backend Environment:** Node.js + Express (`server.mjs`)
- **AI Integration:** Google Gemini JS SDK v2+ (`@google/genai`)

## Directory Structure
```
/
├── server.mjs                  # Express backend: Handles Gemini API proxying, limits, fallbacks
├── proxy.conf.json             # Dev-server proxy config routing /api to server.mjs
├── .env.example                # Example environment variables (GEMINI_API_KEY)
├── package.json                # Dependencies and scripts (ng-zorro-antd, lucide-angular)
├── src/
│   ├── index.html              # App entry HTML
│   ├── main.ts                 # App bootstrap
│   ├── styles.scss             # Global styles, variables, dark mode overrides
│   └── app/
│       ├── app.component.ts    # Main container, layout logic, Theme toggle
│       ├── app.component.html  # Main layout (Sidebar, Header, Main Content, Drawer)
│       ├── app.component.scss  # Scoped component styles
│       ├── mock-data/          # ONLY mock data constants here (e.g., ux-flow.mock.ts)
│       └── services/           # Angular Services (e.g., ux-flow.service.ts, connects to API/Mock)
```

## Architectural Rules
1. **Service Layer (The Bridge) Pattern:** Angular Components MUST NOT import `mock-data/` directly. They must subscribe to Observables provided by `@Injectable` Services.
2. **Mock Data Extraction:** All hardcoded state initializations MUST be situated in `src/app/mock-data/`.
3. **API Proxy:** Never expose the Gemini API key to the frontend. All AI interactions go to `/api/generate` handled by `server.mjs`.
