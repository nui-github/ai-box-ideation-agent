/**
 * Swimlane flow renderer.
 *
 * The model describes a flow as JSON (lanes, nodes with a lane, edges). This module
 * does everything geometric: assigns columns, routes orthogonal connectors, fans
 * connector ports, places masked labels, and emits an editorial SVG.
 *
 * Rules and look come from the diagram-design skill (.claude/skills/diagram-design):
 * 4px grid, r=8 right-angle connectors, labels masked with a 6px gap, no connector
 * behind a non-endpoint box, <=2 focal nodes, Thai labels at a 12px floor with Latin
 * technical sublabels in mono. The same rules are implemented for the curated
 * diagrams in scripts/generate-flow-diagrams.py.
 */

export type FlowKind = 'step' | 'focal' | 'effect';
export type FlowEdgeStyle = 'solid' | 'accent' | 'dash';

export interface FlowLaneSpec { name: string; tag: string; }
export interface FlowNodeSpec { id: string; lane: number; name: string; sub: string; kind: FlowKind; }
export interface FlowEdgeSpec { from: string; to: string; label: string; style: FlowEdgeStyle; }
export interface FlowSpec { lanes: FlowLaneSpec[]; nodes: FlowNodeSpec[]; edges: FlowEdgeSpec[]; }

// ── Geometry (all structural values divisible by 4) ─────────────────────────
const LEFT = 40;
const LABEL_COL = 160;
const TOP = 96;
const LANE_H = 160;
const NODE_H = 56;
const NODE_W = 176;
const COL_X0 = 196;
const PITCH = 240;
const R = 8;
const LABEL_H = 16;
const MIN_RIGHT = 1240;
const MAX_NODES = 14;
const MAX_EDGES = 20;
const MAX_LANES = 6;

interface Palette {
  paper: string; ink: string; muted: string; soft: string; accent: string; tint: string;
  nodeFill: string; effectFill: string; effectStroke: string; ruleStrong: string; ruleWeak: string;
}

const LIGHT: Palette = {
  paper: '#f5f5f5', ink: '#010136', muted: '#4f5d75', soft: '#5a6580', accent: '#0463EF',
  tint: 'rgba(4,99,239,0.08)', nodeFill: '#ffffff',
  effectFill: 'rgba(1,1,54,0.03)', effectStroke: 'rgba(1,1,54,0.30)',
  ruleStrong: 'rgba(1,1,54,0.22)', ruleWeak: 'rgba(1,1,54,0.10)',
};
const DARK: Palette = {
  paper: '#0b1030', ink: '#f5f5f5', muted: '#bfc0c0', soft: '#949eb2', accent: '#4d94ff',
  tint: 'rgba(77,148,255,0.12)', nodeFill: 'rgba(245,245,245,0.04)',
  effectFill: 'rgba(245,245,245,0.02)', effectStroke: 'rgba(245,245,245,0.30)',
  ruleStrong: 'rgba(245,245,245,0.22)', ruleWeak: 'rgba(245,245,245,0.10)',
};

const SANS = "'Geist', 'IBM Plex Sans Thai', sans-serif";
const MONO = "'Geist Mono', monospace";

let svgCounter = 0;

// ── Text measurement ─────────────────────────────────────────────────────────
/** Thai combining marks (above/below vowels, tone marks) take no horizontal advance. */
function isCombining(code: number): boolean {
  return code === 0x0e31 || (code >= 0x0e34 && code <= 0x0e3a) || (code >= 0x0e47 && code <= 0x0e4e);
}

function textWidth(text: string, per = 7.2): number {
  let w = 0;
  for (const ch of text) {
    if (!isCombining(ch.codePointAt(0) ?? 0)) w += per;
  }
  return w;
}

function ceil4(x: number): number { return Math.ceil(x / 4) * 4; }
function sign(v: number): number { return v > 0 ? 1 : v < 0 ? -1 : 0; }

function fit(text: string, maxWidth: number, per: number): string {
  if (textWidth(text, per) <= maxWidth) return text;
  const chars = Array.from(text);
  while (chars.length > 1 && textWidth(chars.join('') + '…', per) > maxWidth) chars.pop();
  return chars.join('').trimEnd() + '…';
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Parsing / normalisation ──────────────────────────────────────────────────
/** Parses the model's JSON (tolerating trailing commas / smart quotes) into a clean spec. */
export function parseFlowSpec(source: string): FlowSpec {
  let text = source.trim().replace(/[“”]/g, '"');
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    text = text.replace(/,\s*([}\]])/g, '$1');
    raw = JSON.parse(text);
  }
  return normalizeSpec(raw);
}

export function normalizeSpec(raw: any): FlowSpec {
  if (!raw || typeof raw !== 'object') throw new Error('flow spec must be an object');

  const rawLanes: any[] = Array.isArray(raw.lanes) ? raw.lanes : [];
  const lanes: FlowLaneSpec[] = rawLanes.slice(0, MAX_LANES).map((l, i) => {
    if (typeof l === 'string') return { name: l.trim() || `Lane ${i + 1}`, tag: '' };
    return { name: String(l?.name ?? `Lane ${i + 1}`).trim(), tag: String(l?.tag ?? '').trim().toUpperCase().slice(0, 14) };
  });

  const seen = new Set<string>();
  const nodes: FlowNodeSpec[] = [];
  for (const n of (Array.isArray(raw.nodes) ? raw.nodes : []).slice(0, MAX_NODES)) {
    const id = String(n?.id ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    let lane = typeof n.lane === 'number' ? n.lane : parseInt(String(n.lane ?? ''), 10);
    if (Number.isNaN(lane)) {
      const byName = lanes.findIndex(l => l.name === String(n.lane ?? '').trim());
      lane = byName >= 0 ? byName : 0;
    }
    const kind: FlowKind = n.kind === 'focal' || n.kind === 'effect' ? n.kind : 'step';
    nodes.push({ id, lane: Math.max(0, Math.floor(lane)), name: String(n.name ?? id).trim(), sub: String(n.sub ?? '').trim(), kind });
  }
  if (nodes.length < 2) throw new Error('flow needs at least 2 nodes');

  const laneCount = Math.min(MAX_LANES, Math.max(lanes.length, ...nodes.map(n => n.lane + 1)));
  while (lanes.length < laneCount) lanes.push({ name: `Lane ${lanes.length + 1}`, tag: '' });
  for (const n of nodes) n.lane = Math.min(n.lane, laneCount - 1);

  // At most two focal nodes; extras fall back to plain steps.
  let focal = 0;
  for (const n of nodes) {
    if (n.kind === 'focal' && ++focal > 2) n.kind = 'step';
  }

  const ids = new Set(nodes.map(n => n.id));
  const pairs = new Set<string>();
  const edges: FlowEdgeSpec[] = [];
  for (const e of (Array.isArray(raw.edges) ? raw.edges : []).slice(0, MAX_EDGES)) {
    const from = String(e?.from ?? '').trim();
    const to = String(e?.to ?? '').trim();
    if (!ids.has(from) || !ids.has(to) || from === to || pairs.has(`${from}>${to}`)) continue;
    pairs.add(`${from}>${to}`);
    const style: FlowEdgeStyle = e.style === 'accent' || e.style === 'dash' ? e.style : 'solid';
    edges.push({ from, to, label: String(e.label ?? '').trim().slice(0, 40), style });
  }
  if (!edges.length) throw new Error('flow needs at least 1 edge');

  return { lanes, nodes, edges };
}

// ── Layout ───────────────────────────────────────────────────────────────────
type Side = 'left' | 'right' | 'top' | 'bottom';
type Pt = [number, number];
type Seg = [number, number, number, number];

interface PNode {
  spec: FlowNodeSpec; id: string; lane: number; col: number;
  x: number; y: number; w: number; cx: number; cy: number; name: string; sub: string;
}

interface PEdge {
  spec: FlowEdgeSpec; a: PNode; b: PNode; label: string; style: FlowEdgeStyle;
  s1: Side; s2: Side; off1: number; off2: number;
  d?: string; line?: [Pt, Pt]; segs: Seg[]; level?: number;
}

interface Built { d?: string; line?: [Pt, Pt]; segs: Seg[]; }

const isH = (s: Side) => s === 'left' || s === 'right';

function assignColumns(nodes: FlowNodeSpec[], edges: FlowEdgeSpec[]): Map<string, number> {
  const out = new Map<string, FlowEdgeSpec[]>();
  const indeg = new Map<string, number>();
  for (const n of nodes) { out.set(n.id, []); indeg.set(n.id, 0); }
  for (const e of edges) out.get(e.from)!.push(e);

  // DFS to find back edges (cycles / retry loops), which must not constrain columns.
  const state = new Map<string, number>();
  const back = new Set<FlowEdgeSpec>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const e of out.get(id)!) {
      const st = state.get(e.to) ?? 0;
      if (st === 1) back.add(e);
      else if (st === 0) visit(e.to);
    }
    state.set(id, 2);
  };
  const hasIncoming = new Set(edges.map(e => e.to));
  for (const n of nodes) if (!hasIncoming.has(n.id) && !state.get(n.id)) visit(n.id);
  for (const n of nodes) if (!state.get(n.id)) visit(n.id);

  const forward = edges.filter(e => !back.has(e));
  for (const e of forward) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const order: string[] = [];
  const queue = nodes.filter(n => (indeg.get(n.id) ?? 0) === 0).map(n => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const e of forward.filter(f => f.from === id)) {
      indeg.set(e.to, indeg.get(e.to)! - 1);
      if (indeg.get(e.to) === 0) queue.push(e.to);
    }
  }
  for (const n of nodes) if (!order.includes(n.id)) order.push(n.id);

  const laneOf = new Map(nodes.map(n => [n.id, n.lane] as const));
  // Same-lane steps advance a column; a hand-off to another lane may share the column
  // (it becomes a short vertical connector), which keeps the diagram compact.
  const step = (from: string, to: string) => (laneOf.get(from) === laneOf.get(to) ? 1 : 0);

  // Pass 1: plain depth, ignoring collisions.
  const depth = new Map<string, number>();
  for (const id of order) {
    let c = 0;
    for (const e of forward) if (e.to === id && depth.has(e.from)) c = Math.max(c, depth.get(e.from)! + step(e.from, id));
    depth.set(id, c);
  }
  // Pass 2: branches with slack (e.g. a later "owner edits" path that rejoins the main path)
  // sit as late as their successors allow, instead of fighting the main path for early columns.
  const alap = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const targets = forward.filter(e => e.from === id);
    alap.set(id, targets.length
      ? Math.min(...targets.map(e => alap.get(e.to)! - step(id, e.to)))
      : depth.get(id)!);
  }
  const minCol = new Map<string, number>();
  nodes.forEach((n, idx) => {
    if (idx === 0) return;
    if (alap.get(n.id)! > depth.get(n.id)!) minCol.set(n.id, alap.get(n.id)!);
  });

  // Pass 3: final columns, resolving collisions in topological order.
  const col = new Map<string, number>();
  const occupied = new Set<string>();
  for (const id of order) {
    let c = minCol.get(id) ?? 0;
    for (const e of forward) if (e.to === id && col.has(e.from)) c = Math.max(c, col.get(e.from)! + step(e.from, id));
    while (occupied.has(`${laneOf.get(id)}:${c}`)) c++;
    occupied.add(`${laneOf.get(id)}:${c}`);
    col.set(id, c);
  }
  return col;
}

function port(n: PNode, side: Side, off: number): Pt {
  switch (side) {
    case 'right': return [n.x + n.w, n.cy + off];
    case 'left': return [n.x, n.cy + off];
    case 'top': return [n.cx + off, n.y];
    default: return [n.cx + off, n.y + NODE_H];
  }
}

function buildPath(p1: Pt, s1: Side, p2: Pt, s2: Side, loopY?: number, shift = 0): Built | null {
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const f = (n: number) => Math.round(n * 100) / 100;

  if (isH(s1) && isH(s2)) {
    if (s1 !== s2) {
      const dir = s1 === 'right' ? 1 : -1;
      if ((x2 - x1) * dir <= 0) return null;
      if (y1 === y2) return { line: [p1, p2], segs: [[x1, y1, x2, y2]] };
      const dy = y2 - y1;
      const r = Math.min(R, Math.abs(dy) / 2, Math.abs(x2 - x1) / 4);
      const mid = (x1 + x2) / 2 + shift;
      if ((mid - x1) * dir < 2 * r || (x2 - mid) * dir < 2 * r) return null;
      const sg = sign(dy);
      return {
        d: `M ${f(x1)},${f(y1)} H ${f(mid - dir * r)} Q ${f(mid)},${f(y1)} ${f(mid)},${f(y1 + sg * r)} V ${f(y2 - sg * r)} Q ${f(mid)},${f(y2)} ${f(mid + dir * r)},${f(y2)} H ${f(x2)}`,
        segs: [[x1, y1, mid, y1], [mid, y1, mid, y2], [mid, y2, x2, y2]],
      };
    }
    // Same side on both ends: C-shape around the outside.
    const out = s1 === 'right' ? 1 : -1;
    const lx = (out > 0 ? Math.max(x1, x2) : Math.min(x1, x2)) + out * (28 + Math.abs(shift));
    const dy = y2 - y1;
    if (Math.abs(dy) < 2 * R) return null;
    const sg = sign(dy);
    return {
      d: `M ${f(x1)},${f(y1)} H ${f(lx - out * R)} Q ${f(lx)},${f(y1)} ${f(lx)},${f(y1 + sg * R)} V ${f(y2 - sg * R)} Q ${f(lx)},${f(y2)} ${f(lx - out * R)},${f(y2)} H ${f(x2)}`,
      segs: [[x1, y1, lx, y1], [lx, y1, lx, y2], [lx, y2, x2, y2]],
    };
  }

  if (!isH(s1) && !isH(s2)) {
    if (s1 !== s2) {
      const dir = s1 === 'bottom' ? 1 : -1;
      if ((y2 - y1) * dir <= 0) return null;
      if (x1 === x2) return { line: [p1, p2], segs: [[x1, y1, x2, y2]] };
      const dx = x2 - x1;
      const r = Math.min(R, Math.abs(dx) / 2, Math.abs(y2 - y1) / 4);
      const mid = (y1 + y2) / 2 + shift;
      if ((mid - y1) * dir < 2 * r || (y2 - mid) * dir < 2 * r) return null;
      const sg = sign(dx);
      return {
        d: `M ${f(x1)},${f(y1)} V ${f(mid - dir * r)} Q ${f(x1)},${f(mid)} ${f(x1 + sg * r)},${f(mid)} H ${f(x2 - sg * r)} Q ${f(x2)},${f(mid)} ${f(x2)},${f(mid + dir * r)} V ${f(y2)}`,
        segs: [[x1, y1, x1, mid], [x1, mid, x2, mid], [x2, mid, x2, y2]],
      };
    }
    // Loop over the top (or under the bottom) of the lane.
    if (x1 === x2) return null;
    const sx = sign(x2 - x1);
    if (s1 === 'top') {
      const ly = loopY ?? Math.min(y1, y2) - 28;
      return {
        d: `M ${f(x1)},${f(y1)} V ${f(ly + R)} Q ${f(x1)},${f(ly)} ${f(x1 + sx * R)},${f(ly)} H ${f(x2 - sx * R)} Q ${f(x2)},${f(ly)} ${f(x2)},${f(ly + R)} V ${f(y2)}`,
        segs: [[x1, y1, x1, ly], [x1, ly, x2, ly], [x2, ly, x2, y2]],
      };
    }
    const ly = loopY ?? Math.max(y1, y2) + 28;
    return {
      d: `M ${f(x1)},${f(y1)} V ${f(ly - R)} Q ${f(x1)},${f(ly)} ${f(x1 + sx * R)},${f(ly)} H ${f(x2 - sx * R)} Q ${f(x2)},${f(ly)} ${f(x2)},${f(ly - R)} V ${f(y2)}`,
      segs: [[x1, y1, x1, ly], [x1, ly, x2, ly], [x2, ly, x2, y2]],
    };
  }

  if (isH(s1)) {
    // Horizontal out, vertical in: single bend at (x2, y1).
    const dir = s1 === 'right' ? 1 : -1;
    const dyDir = s2 === 'top' ? 1 : -1;
    if ((x2 - x1) * dir < R || (y2 - y1) * dyDir < R) return null;
    return {
      d: `M ${f(x1)},${f(y1)} H ${f(x2 - dir * R)} Q ${f(x2)},${f(y1)} ${f(x2)},${f(y1 + dyDir * R)} V ${f(y2)}`,
      segs: [[x1, y1, x2, y1], [x2, y1, x2, y2]],
    };
  }

  // Vertical out, horizontal in: single bend at (x1, y2).
  const dirY = s1 === 'bottom' ? 1 : -1;
  const dxDir = s2 === 'left' ? 1 : -1;
  if ((y2 - y1) * dirY < R || (x2 - x1) * dxDir < R) return null;
  return {
    d: `M ${f(x1)},${f(y1)} V ${f(y2 - dirY * R)} Q ${f(x1)},${f(y2)} ${f(x1 + dxDir * R)},${f(y2)} H ${f(x2)}`,
    segs: [[x1, y1, x1, y2], [x1, y2, x2, y2]],
  };
}

function candidates(a: PNode, b: PNode): [Side, Side][] {
  const dx = Math.sign(b.col - a.col);
  const dy = Math.sign(b.lane - a.lane);
  if (dy === 0) {
    return dx > 0
      ? [['right', 'left'], ['top', 'top'], ['bottom', 'bottom']]
      : [['top', 'top'], ['bottom', 'bottom']];
  }
  if (dx === 0) {
    return dy > 0
      ? [['bottom', 'top'], ['right', 'right'], ['left', 'left']]
      : [['top', 'bottom'], ['right', 'right'], ['left', 'left']];
  }
  const leave: Side = dy > 0 ? 'bottom' : 'top';
  const enter: Side = dy > 0 ? 'top' : 'bottom';
  return dx > 0
    ? [['right', enter], [leave, 'left'], ['right', 'left']]
    : [['left', enter], [leave, 'right'], ['left', 'right']];
}

function segRect(s: Seg): [number, number, number, number] {
  return [Math.min(s[0], s[2]) - 1, Math.min(s[1], s[3]) - 1, Math.abs(s[2] - s[0]) + 2, Math.abs(s[3] - s[1]) + 2];
}

function overlaps(a: number[], b: number[], margin = 0): boolean {
  return !(a[0] + a[2] + margin <= b[0] || b[0] + b[2] + margin <= a[0] || a[1] + a[3] + margin <= b[1] || b[1] + b[3] + margin <= a[1]);
}

const HORIZONTAL_SLOTS: Record<number, number[]> = { 1: [0], 2: [-8, 8], 3: [-12, 0, 12], 4: [-20, -8, 8, 20] };
const VERTICAL_SLOTS: Record<number, number[]> = { 1: [0], 2: [-16, 16], 3: [-24, 0, 24], 4: [-48, -16, 16, 48] };

function slotsFor(side: Side, count: number): number[] {
  const table = isH(side) ? HORIZONTAL_SLOTS : VERTICAL_SLOTS;
  return table[Math.min(count, 4)];
}

// ── Public API ───────────────────────────────────────────────────────────────
export function renderFlowSvg(spec: FlowSpec, dark: boolean): string {
  const pal = dark ? DARK : LIGHT;
  const id = `flow-${++svgCounter}`;
  const cols = assignColumns(spec.nodes, spec.edges);
  const laneCount = spec.lanes.length;

  const nodes = new Map<string, PNode>();
  for (const n of spec.nodes) {
    const col = cols.get(n.id) ?? 0;
    const cx = COL_X0 + col * PITCH + NODE_W / 2;
    const y = TOP + n.lane * LANE_H + 52;
    nodes.set(n.id, {
      spec: n, id: n.id, lane: n.lane, col, x: cx - NODE_W / 2, y, w: NODE_W, cx, cy: y + NODE_H / 2,
      name: fit(n.name, NODE_W - 16, 7.2), sub: fit(n.sub, NODE_W - 16, 5.58),
    });
  }
  const all = [...nodes.values()];
  const nodeRects = all.map(n => [n.x, n.y, n.w, NODE_H]);
  const maxRight = Math.max(...all.map(n => n.x + n.w));
  const RIGHT = Math.max(MIN_RIGHT, maxRight + 148);
  const W = RIGHT + 40;
  const base = TOP + laneCount * LANE_H;
  const H = base + 144;
  const dividers = Array.from({ length: laneCount + 1 }, (_, i) => TOP + i * LANE_H);

  // 1) choose sides with centred ports
  const edges: PEdge[] = [];
  for (const e of spec.edges) {
    const a = nodes.get(e.from)!;
    const b = nodes.get(e.to)!;
    const pe: PEdge = { spec: e, a, b, label: fit(e.label, 128, 7.2), style: e.style, s1: 'right', s2: 'left', off1: 0, off2: 0, segs: [] };
    let chosen: [Side, Side] | null = null;
    let fallback: [Side, Side] | null = null;
    for (const [s1, s2] of candidates(a, b)) {
      const loopY = (s1 === s2 && !isH(s1)) ? TOP + a.lane * LANE_H + (s1 === 'top' ? 24 : LANE_H - 24) : undefined;
      const built = buildPath(port(a, s1, 0), s1, port(b, s2, 0), s2, loopY);
      if (!built) continue;
      if (!fallback) fallback = [s1, s2];
      const clear = built.segs.every(seg => {
        const sr = segRect(seg);
        return all.every(n => n === a || n === b || !overlaps(sr, [n.x, n.y, n.w, NODE_H], 2));
      });
      if (clear) { chosen = [s1, s2]; break; }
    }
    const pick = chosen ?? fallback;
    if (!pick) continue;
    pe.s1 = pick[0];
    pe.s2 = pick[1];
    edges.push(pe);
  }

  // 2) fan ports where several connectors share one side of a node
  const groups = new Map<string, { edge: PEdge; end: 1 | 2; key: number }[]>();
  for (const pe of edges) {
    for (const end of [1, 2] as const) {
      const self = end === 1 ? pe.a : pe.b;
      const other = end === 1 ? pe.b : pe.a;
      const side = end === 1 ? pe.s1 : pe.s2;
      const gk = `${self.id}:${side}`;
      if (!groups.has(gk)) groups.set(gk, []);
      groups.get(gk)!.push({ edge: pe, end, key: isH(side) ? other.cy : other.cx });
    }
  }
  groups.forEach(list => {
    list.sort((p, q) => p.key - q.key);
    const side = list[0].end === 1 ? list[0].edge.s1 : list[0].edge.s2;
    const slots = slotsFor(side, list.length);
    list.forEach((item, i) => {
      const off = slots[Math.min(i, slots.length - 1)];
      if (item.end === 1) item.edge.off1 = off; else item.edge.off2 = off;
    });
  });
  // A single connector on one end follows the fanned end so straight lines stay straight.
  const countAt = (n: PNode, side: Side) => groups.get(`${n.id}:${side}`)?.length ?? 0;
  for (const pe of edges) {
    const opposite = (isH(pe.s1) && isH(pe.s2) && pe.s1 !== pe.s2) || (!isH(pe.s1) && !isH(pe.s2) && pe.s1 !== pe.s2);
    if (!opposite) continue;
    const c1 = countAt(pe.a, pe.s1);
    const c2 = countAt(pe.b, pe.s2);
    if (c1 === 1 && c2 > 1) pe.off1 = pe.off2;
    else if (c2 === 1 && c1 > 1) pe.off2 = pe.off1;
  }

  // 3) final paths. Straight and single-bend connectors go first; connectors with a free
  // channel (mid-segment, outer lane, loop level) then slide to a clear channel so no two
  // strokes run on top of each other.
  const band = (a: Seg, b: Seg, tol: number): boolean => {
    const ah = a[1] === a[3];
    const bh = b[1] === b[3];
    if (ah !== bh) return false;
    if (ah) return Math.abs(a[1] - b[1]) < tol && Math.min(Math.max(a[0], a[2]), Math.max(b[0], b[2])) - Math.max(Math.min(a[0], a[2]), Math.min(b[0], b[2])) > 6;
    return Math.abs(a[0] - b[0]) < tol && Math.min(Math.max(a[1], a[3]), Math.max(b[1], b[3])) - Math.max(Math.min(a[1], a[3]), Math.min(b[1], b[3])) > 6;
  };
  /** tol 10: keep parallel strokes visibly apart; tol 3: at the very least never draw one on top of another. */
  const collides = (segs: Seg[], placedSegs: Seg[], tol: number) => segs.some(s1 => placedSegs.some(s2 => band(s1, s2, tol)));
  const hitsNode = (segs: Seg[], pe: PEdge) => segs.some(sg => {
    const sr = segRect(sg);
    return all.some(n => n !== pe.a && n !== pe.b && overlaps(sr, [n.x, n.y, n.w, NODE_H], 2));
  });
  const isLoop = (pe: PEdge) => pe.s1 === pe.s2 && !isH(pe.s1);
  const isShiftable = (pe: PEdge) => {
    if (isLoop(pe)) return true;
    if (pe.s1 === pe.s2) return true; // C-shape
    const opposite = isH(pe.s1) === isH(pe.s2);
    if (!opposite) return false;
    const p1 = port(pe.a, pe.s1, pe.off1);
    const p2 = port(pe.b, pe.s2, pe.off2);
    return isH(pe.s1) ? p1[1] !== p2[1] : p1[0] !== p2[0];
  };

  const placed: Seg[] = [];
  const finalize = (pe: PEdge, built: Built) => { pe.d = built.d; pe.line = built.line; pe.segs = built.segs; placed.push(...built.segs); };
  const ordered = [...edges.filter(pe => !isShiftable(pe)), ...edges.filter(isShiftable)];
  for (const pe of ordered) {
    const p1 = port(pe.a, pe.s1, pe.off1);
    const p2 = port(pe.b, pe.s2, pe.off2);
    const tries: (Built | null)[] = [];
    if (isLoop(pe)) {
      const laneTop = TOP + pe.a.lane * LANE_H;
      for (const level of [24, 36, 12]) {
        tries.push(buildPath(p1, pe.s1, p2, pe.s2, pe.s1 === 'top' ? laneTop + level : laneTop + LANE_H - level));
      }
    } else if (isShiftable(pe)) {
      for (const sh of [0, 12, -12, 24, -24, 36, -36]) {
        tries.push(buildPath(p1, pe.s1, p2, pe.s2, undefined, pe.s1 === pe.s2 ? Math.abs(sh) : sh));
      }
    } else {
      tries.push(buildPath(p1, pe.s1, p2, pe.s2));
    }
    const valid = tries.filter((t): t is Built => !!t);
    const best = valid.find(t => !collides(t.segs, placed, 10) && !hitsNode(t.segs, pe))
      ?? valid.find(t => !collides(t.segs, placed, 3) && !hitsNode(t.segs, pe))
      ?? valid.find(t => !hitsNode(t.segs, pe))
      ?? valid[0]
      ?? buildPath(port(pe.a, pe.s1, 0), pe.s1, port(pe.b, pe.s2, 0), pe.s2);
    if (best) finalize(pe, best);
  }
  const routed = edges.filter(pe => pe.segs.length);

  // 4) labels (masked, 6px clear of the stroke, clear of nodes / other connectors / dividers)
  const placedMasks: number[][] = [];
  const labels: { x: number; y: number; w: number; text: string; style: FlowEdgeStyle }[] = [];
  for (const pe of routed) {
    if (!pe.label) continue;
    const lw = Math.max(ceil4(textWidth(pe.label) + 8), 24);
    const others: number[][] = [];
    for (const o of routed) if (o !== pe) for (const s of o.segs) others.push(segRect(s));
    const clear = (r: number[]) =>
      !nodeRects.some(nr => overlaps(r, nr, 2)) &&
      !others.some(o => overlaps(r, o, 2)) &&
      !placedMasks.some(m => overlaps(r, m, 2)) &&
      !dividers.some(dv => r[1] - 2 <= dv && dv <= r[1] + r[3] + 2);
    const segs = [...pe.segs].sort((p, q) => (Math.abs(q[2] - q[0]) + Math.abs(q[3] - q[1])) - (Math.abs(p[2] - p[0]) + Math.abs(p[3] - p[1])));
    const preferAbove = !(pe.s1 === 'top' && pe.s2 === 'top');
    let spot: [number, number] | null = null;
    for (const [sx1, sy1, sx2, sy2] of segs) {
      if (spot) break;
      if (sy1 === sy2) {
        const direct = pe.segs.length === 1;
        const lo = Math.min(sx1, sx2) + (direct ? 4 : 12);
        const hi = Math.max(sx1, sx2) - (direct ? 4 : 12);
        const mid = (sx1 + sx2) / 2;
        for (const shift of [0, 8, -8, 16, -16, 24, -24, 32, -32, 48, -48]) {
          const cx = mid + shift;
          if (cx - lw / 2 < lo || cx + lw / 2 > hi) continue;
          for (const above of [preferAbove, !preferAbove]) {
            const my = above ? sy1 - 6 - LABEL_H : sy1 + 6;
            if (clear([cx - lw / 2, my, lw, LABEL_H])) { spot = [Math.round(cx - lw / 2), my]; break; }
          }
          if (spot) break;
        }
      } else if (sx1 === sx2) {
        const lo = Math.min(sy1, sy2) + 12;
        const hi = Math.max(sy1, sy2) - 12;
        const mid = (sy1 + sy2) / 2;
        for (const shift of [0, 8, -8, 16, -16, 24, -24, 32, -32, 40, -40, 48, -48]) {
          const my = mid - LABEL_H / 2 + shift;
          if (my < lo || my + LABEL_H > hi) continue;
          for (const side of ['right', 'left']) {
            const mx = side === 'right' ? sx1 + 8 : sx1 - 8 - lw;
            if (clear([mx, my, lw, LABEL_H])) { spot = [Math.round(mx), Math.round(my)]; break; }
          }
          if (spot) break;
        }
      }
    }
    if (spot) {
      placedMasks.push([spot[0], spot[1], lw, LABEL_H]);
      labels.push({ x: spot[0], y: spot[1], w: lw, text: pe.label, style: pe.style });
    }
  }

  // 5) emit
  const out: string[] = [];
  const w = (s: string) => out.push(s);
  const title = 'Flow diagram';
  w(`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="${id}-title ${id}-desc">`);
  w(`  <title id="${id}-title">${title}</title>`);
  w(`  <desc id="${id}-desc">${esc(`Swimlane flow with ${nodes.size} steps across ${laneCount} lanes: ${all.map(n => n.name).join(', ')}.`)}</desc>`);
  w('  <defs>');
  w(`    <marker id="${id}-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="${pal.muted}"/></marker>`);
  w(`    <marker id="${id}-arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="${pal.accent}"/></marker>`);
  w('  </defs>');
  w(`  <rect width="100%" height="100%" fill="${pal.paper}"/>`);

  dividers.forEach((y, i) => {
    const strong = i === 0 || i === laneCount;
    w(`  <line x1="${LEFT}" y1="${y}" x2="${RIGHT}" y2="${y}" stroke="${strong ? pal.ruleStrong : pal.ruleWeak}" stroke-width="1"/>`);
  });
  w(`  <line x1="${LABEL_COL}" y1="${TOP}" x2="${LABEL_COL}" y2="${base}" stroke="${pal.ruleStrong}" stroke-width="1"/>`);

  spec.lanes.forEach((lane, i) => {
    const cy = TOP + i * LANE_H + LANE_H / 2;
    w(`  <text x="60" y="${cy - 4}" fill="${pal.ink}" font-size="12" font-weight="600" font-family="${SANS}">${esc(fit(lane.name, 92, 7.2))}</text>`);
    if (lane.tag) w(`  <text x="60" y="${cy + 14}" fill="${pal.muted}" font-size="8" font-family="${MONO}" letter-spacing="0.18em">${esc(lane.tag)}</text>`);
  });

  for (const pe of routed) {
    const accent = pe.style === 'accent';
    const color = accent ? pal.accent : pal.muted;
    const marker = accent ? `${id}-arrow-accent` : `${id}-arrow`;
    const sw = accent ? '1.4' : '1.2';
    const dash = pe.style === 'dash' ? ' stroke-dasharray="5,4"' : '';
    if (pe.line) {
      const [[x1, y1], [x2, y2]] = pe.line;
      w(`  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${sw}"${dash} marker-end="url(#${marker})"/>`);
    } else {
      w(`  <path d="${pe.d}" fill="none" stroke="${color}" stroke-width="${sw}"${dash} marker-end="url(#${marker})"/>`);
    }
  }

  for (const l of labels) {
    w(`  <rect x="${l.x}" y="${l.y}" width="${l.w}" height="${LABEL_H}" rx="2" fill="${pal.paper}"/>`);
    w(`  <text x="${l.x + l.w / 2}" y="${l.y + 12}" fill="${l.style === 'accent' ? pal.accent : pal.soft}" font-size="12" font-weight="500" font-family="${SANS}" text-anchor="middle">${esc(l.text)}</text>`);
  }

  for (const n of all) {
    const kind = n.spec.kind;
    const fill = kind === 'focal' ? pal.tint : kind === 'effect' ? pal.effectFill : pal.nodeFill;
    const stroke = kind === 'focal' ? pal.accent : kind === 'effect' ? pal.effectStroke : pal.ink;
    w(`  <rect x="${n.x}" y="${n.y}" width="${n.w}" height="${NODE_H}" rx="6" fill="${pal.paper}"/>`);
    w(`  <rect x="${n.x}" y="${n.y}" width="${n.w}" height="${NODE_H}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`);
    w(`  <text x="${n.cx}" y="${n.y + (n.sub ? 24 : 32)}" fill="${pal.ink}" font-size="12" font-weight="600" font-family="${SANS}" text-anchor="middle">${esc(n.name)}</text>`);
    if (n.sub) w(`  <text x="${n.cx}" y="${n.y + 40}" fill="${pal.muted}" font-size="9" font-family="${MONO}" text-anchor="middle">${esc(n.sub)}</text>`);
  }

  // Legend
  const ly = base + 24;
  w(`  <line x1="${LEFT}" y1="${ly}" x2="${RIGHT}" y2="${ly}" stroke="${pal.ruleWeak}" stroke-width="0.8"/>`);
  w(`  <text x="${LEFT}" y="${ly + 24}" fill="${pal.muted}" font-size="8" font-family="${MONO}" letter-spacing="0.18em">LEGEND</text>`);
  const items: [string, string][] = [['step', 'ขั้นตอน']];
  if (all.some(n => n.spec.kind === 'focal')) items.push(['focal', 'ขั้นสำคัญ']);
  if (all.some(n => n.spec.kind === 'effect')) items.push(['effect', 'ผลที่เกิดขึ้น']);
  items.push(['arrow', 'ลำดับขั้น']);
  if (routed.some(e => e.style === 'accent')) items.push(['accent', 'ส่งต่อสำคัญ']);
  if (routed.some(e => e.style === 'dash')) items.push(['dash', 'วนกลับ / ทางเลือก']);
  let lx = LEFT;
  const iy = ly + 44;
  for (const [kind, label] of items) {
    let tx: number;
    if (kind === 'step' || kind === 'focal' || kind === 'effect') {
      const fill = kind === 'focal' ? pal.tint : kind === 'effect' ? pal.effectFill : pal.nodeFill;
      const stroke = kind === 'focal' ? pal.accent : kind === 'effect' ? pal.effectStroke : pal.ink;
      w(`  <rect x="${lx}" y="${iy}" width="14" height="10" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`);
      tx = lx + 20;
    } else {
      const accent = kind === 'accent';
      const color = accent ? pal.accent : pal.muted;
      const marker = accent ? `${id}-arrow-accent` : `${id}-arrow`;
      const dash = kind === 'dash' ? ' stroke-dasharray="4,3"' : '';
      w(`  <line x1="${lx}" y1="${iy + 5}" x2="${lx + 28}" y2="${iy + 5}" stroke="${color}" stroke-width="${accent ? '1.4' : '1.2'}"${dash} marker-end="url(#${marker})"/>`);
      tx = lx + 36;
    }
    w(`  <text x="${tx}" y="${iy + 9}" fill="${pal.muted}" font-size="12" font-family="${SANS}">${esc(label)}</text>`);
    lx = ceil4(tx + textWidth(label) + 28);
  }

  w('</svg>');
  return out.join('\n') + '\n';
}

/** Convenience: model JSON in, themed SVG out. Throws if the JSON is unusable. */
export function flowJsonToSvg(source: string, dark: boolean): string {
  return renderFlowSvg(parseFlowSpec(source), dark);
}
