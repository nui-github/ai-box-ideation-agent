/**
 * Editorial skin for Mermaid flowcharts, mirroring the diagram-design style guide
 * (.claude/skills/diagram-design/references/style-guide.md): AI-BOX navy ink, one
 * blue accent, hairline strokes, no shadows, Thai-capable sans.
 *
 * Gemini only decides structure and which semantic class a node belongs to.
 * Colours are owned here, so light/dark stay consistent and the model cannot
 * ship off-palette fills.
 */

interface Palette {
  paper: string;
  paper2: string;
  ink: string;
  muted: string;
  soft: string;
  accent: string;
  accentTint: string;
  nodeFill: string;
  rule: string;
  decisionFill: string;
}

const LIGHT: Palette = {
  paper: '#f5f5f5',
  paper2: '#ececec',
  ink: '#010136',
  muted: '#4f5d75',
  soft: '#5a6580',
  accent: '#0463EF',
  accentTint: '#e2e9f5',
  nodeFill: '#ffffff',
  rule: '#bfc0c0',
  decisionFill: '#ececec',
};

const DARK: Palette = {
  paper: '#0b1030',
  paper2: '#141a40',
  ink: '#f5f5f5',
  muted: '#bfc0c0',
  soft: '#949eb2',
  accent: '#4d94ff',
  accentTint: '#16295f',
  nodeFill: '#141a40',
  rule: '#3a4170',
  decisionFill: '#1c2352',
};

const FONT_FAMILY = "'IBM Plex Sans Thai', 'Geist', system-ui, sans-serif";

export function mermaidConfig(dark: boolean) {
  const p = dark ? DARK : LIGHT;
  return {
    startOnLoad: false,
    securityLevel: 'strict' as const,
    theme: 'base' as const,
    fontFamily: FONT_FAMILY,
    themeVariables: {
      darkMode: dark,
      background: p.paper,
      fontFamily: FONT_FAMILY,
      fontSize: '14px',
      primaryColor: p.nodeFill,
      primaryTextColor: p.ink,
      primaryBorderColor: p.ink,
      secondaryColor: p.paper2,
      tertiaryColor: p.paper2,
      lineColor: p.muted,
      textColor: p.ink,
      nodeBorder: p.ink,
      mainBkg: p.nodeFill,
      edgeLabelBackground: p.paper,
      clusterBkg: p.paper2,
      clusterBorder: p.rule,
      titleColor: p.ink,
    },
    flowchart: {
      curve: 'linear' as const,
      nodeSpacing: 44,
      rankSpacing: 60,
      padding: 14,
      useMaxWidth: false,
    },
  };
}

/**
 * Drops any classDef lines the model wrote and appends the canonical ones.
 * Node-to-class assignments (`class A,F startEnd`) from the model are kept.
 */
export function applyFlowTheme(code: string, dark: boolean): string {
  const p = dark ? DARK : LIGHT;
  const stripped = code
    .split('\n')
    .filter(line => !/^\s*classDef\s/.test(line))
    .join('\n')
    .trimEnd();

  const startEndText = dark ? DARK.paper : LIGHT.paper;
  const defs = [
    `classDef startEnd fill:${p.ink},stroke:${p.ink},color:${startEndText}`,
    `classDef process fill:${p.nodeFill},stroke:${p.ink},color:${p.ink}`,
    `classDef decision fill:${p.decisionFill},stroke:${p.ink},color:${p.ink}`,
    `classDef alert fill:${p.nodeFill},stroke:${p.muted},color:${p.ink},stroke-dasharray:4 3`,
    `classDef focal fill:${p.accentTint},stroke:${p.accent},color:${p.ink},stroke-width:1.5px`,
  ];
  return `${stripped}\n    ${defs.join('\n    ')}\n`;
}
