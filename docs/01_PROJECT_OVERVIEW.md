# Project Overview: AI Design Agent

**Name:** AI Design Agent
**Description:** Internal tool for Product & UX/UI Designer to generate flow using Agent.

## Core Features
- Chat interface for generating UX flows and design analysis.
- Connects to Google Gemini API (model variants like `gemini-3.5-flash`, `gemini-1.5-pro` etc.) through a Node.js Express backend proxy.
- Side navigation and history drawer.
- Theme switching support (Light/Dark Mode).

## Important Developer Context
This project was initially bootstrapped and developed in Google AI Studio. It follows a strict set of rules to ensure structural integrity:
- **No pure React/Tailwind translations as outputs**: All UI elements MUST be rendered with `ng-zorro-antd` along with custom `.scss` for styling. Tailwind CSS is intentionally omitted/removed.
- **Backend separation**: Gemini API Secret Key is held securely in `server.mjs`. The Angular front-end speaks only to local endpoints `/api/generate`, `/api/models`.
- **Localization**: Supports multiple languages. Interface components should handle text gracefully for Thai (`TH`) and English (`EN`).

This documentation directory contains guidelines to pass over to AI assistants (like Claude) so they maintain the same conventions set intentionally by the initial designers and engineers.
