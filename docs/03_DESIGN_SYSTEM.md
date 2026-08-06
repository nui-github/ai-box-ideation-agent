# Design System & Styling (UX/UI Spec)

The design system is heavily enforced via global and scoped SCSS. We do **NOT** use Tailwind. Instead, layout relies on `ng-zorro-antd` grids (`nz-row`, `nz-col`) and layouts (`nz-layout`).

## Typography
- **Primary Font:** `IBM Plex Sans Thai`, sans-serif.

## Color Palette
```css
:root {
  --primary-color: #0463EF;
  --accent-color: #16EA9E;
  --bg-app: #f8fafc;
  --border-color: #e2e8f0;
  --text-primary: #010136;
  --gray-7: #475569;
  --gray-10: #0f172a;
}
```

### Dark Mode overrides
Dark mode is implemented via CSS class injection (`.dark-theme`) on the `:root` and `body`.
```css
:root.dark-theme {
  --bg-app: #0f172a;               /* deep dark background */
  --border-color: #1e293b;
  --text-primary: #cbd5e1;
  ...
}
```
**Important:** When editing elements, do not hardcode colors in the TS/HTML. Use the SCSS variables (`var(--primary-color)`) so the app respects the theme toggle.

## Border Radius
- `4px`: Inputs, Text Field, Text Area, Dropdown, Select, Box Upload, Buttons.
- `8px`: Sub-sections and Cards (`.model-card`, `.section-card`).
- `16px`: Major layout sections.

## Ng-Zorro Overrides
Any overrides to Ng-Zorro defaults are located in `src/styles.scss`. We heavily override the default Ant Design colors for layout backgrounds `.ant-layout`, scrollbar styling, text inputs, and modals to conform to our dark mode variables dynamically. Make sure to append `!important` to override nested zorro defaults when creating new customized components.
