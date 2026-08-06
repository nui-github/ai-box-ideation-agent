# AI Developer Instructions (For Claude / Next Agents)

If you are an AI (like Claude Code) reading this repository to continue development, you MUST follow these specific project rules:

## 1. Code Generation Rules (Angular + Zorro)
- **Do NOT use Tailwind.** If the user asks for layout changes, use `ng-zorro-antd` grids (`<div nz-row>`, `<div nz-col>`) or native flexbox in the `.scss` files.
- **Convert all React/Tailwind references:** If the user gives you code from an old React/Tailwind codebase, you must manually translate UI components to `ng-zorro` equivalents (e.g., `<nz-table>`, `<button nz-button>`).
- **No Inline Styles:** Use `class="..."` and define properties in the corresponding `.scss` file.
- **Maintain Dark Mode Vibe:** Use CSS variables (e.g. `var(--bg-app)`) when adding new properties so Dark Mode does not break.

## 2. Directory Structure Mandates
- **Mock Data Isolation:** If you need to create dummy data for testing, create a file inside `src/app/mock-data/` (e.g. `settings.mock.ts`). Export it as `export const MOCK_DATA = [...]`.
- **Services are the only Bridge:** Do **NOT** import mock data directly into a `.ts` Component. You must create an `@Injectable()` Service in `src/app/services/` that imports the mock data and returns it via `of(MOCK_DATA)` from `rxjs`. The component then `subscribe()`s to the service.

## 3. Strict File Path Output
When returning code blocks in your chat response, ALWAYS include the full file path at the top of the block, e.g.:
```ts
// src/app/services/some.service.ts
import { Injectable } from '@angular/core'; ...
```
This is critical for the human developer to know exactly which file you are editing.

## 4. Execution Context
- The app has a light/dark toggle.
- The app supports i18n placeholders (TH/EN concepts).
- Before refactoring large chunks, ensure you use `view_file` to understand the Regex parsing logic currently living in `app.component.ts`.
