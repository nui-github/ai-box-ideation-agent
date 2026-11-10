#!/usr/bin/env python3
"""Generate the editorial swimlane flow diagrams shown in the app's quick-prompt viewer.

Follows the diagram-design skill (.claude/skills/diagram-design): 4px grid, orthogonal
r=8 connectors, masked arrow labels with a 6px gap, <=9 nodes, <=2 focal elements,
Thai labels at a 12px floor with Latin technical sublabels in mono.

Usage (Python 3.8+):
    python3 scripts/generate-flow-diagrams.py                     # writes src/assets/flows/*.svg
    python3 scripts/generate-flow-diagrams.py --check-dir DIR     # also writes HTML wrappers
                                                                  # for self_check / verify_geometry
Each flow is emitted twice: <slug>.svg (light) and <slug>-dark.svg.
"""
import argparse
import html
import math
import os
import sys

# ── Geometry (all divisible by 4) ───────────────────────────────────────────
W = 1280
LEFT, RIGHT = 40, 1240
LABEL_COL = 160
TOP = 96
LANE_H = 160
NODE_H = 56
NODE_W = 176
COL_X0 = 196
PITCH = 240
R = 8
LABEL_H = 16

# ── Palettes (mirror .claude/skills/diagram-design/references/style-guide.md) ─
LIGHT = dict(
    paper="#f5f5f5", ink="#010136", muted="#4f5d75", soft="#5a6580", accent="#0463EF",
    tint="rgba(4,99,239,0.08)", node_fill="#ffffff",
    effect_fill="rgba(1,1,54,0.03)", effect_stroke="rgba(1,1,54,0.30)",
    rule_strong="rgba(1,1,54,0.22)", rule_weak="rgba(1,1,54,0.10)",
)
DARK = dict(
    paper="#0b1030", ink="#f5f5f5", muted="#bfc0c0", soft="#949eb2", accent="#4d94ff",
    tint="rgba(77,148,255,0.12)", node_fill="rgba(245,245,245,0.04)",
    effect_fill="rgba(245,245,245,0.02)", effect_stroke="rgba(245,245,245,0.30)",
    rule_strong="rgba(245,245,245,0.22)", rule_weak="rgba(245,245,245,0.10)",
)

SANS = "'Geist', 'IBM Plex Sans Thai', sans-serif"
MONO = "'Geist Mono', monospace"

# Thai combining marks cost no horizontal advance.
_COMBINING = set(range(0x0E31, 0x0E32)) | set(range(0x0E34, 0x0E3B)) | set(range(0x0E47, 0x0E4F))


def text_w(text, per=7.2):
    return sum(per for ch in text if ord(ch) not in _COMBINING)


def ceil4(x):
    return int(math.ceil(x / 4.0) * 4)


def sign(v):
    return 1 if v > 0 else (-1 if v < 0 else 0)


class Node(object):
    def __init__(self, spec, lane_count):
        self.id = spec["id"]
        self.col = spec["col"]
        self.lane = spec["lane"]
        self.name = spec["name"]
        self.sub = spec.get("sub", "")
        self.kind = spec.get("kind", "step")
        self.w = spec.get("w", NODE_W)
        self.cx = COL_X0 + self.col * PITCH + NODE_W // 2
        self.x = self.cx - self.w // 2
        self.y = TOP + self.lane * LANE_H + 52
        self.cy = self.y + NODE_H // 2
        if text_w(self.name) > self.w - 16:
            raise ValueError("node name too wide for %s: %r (%.0f > %d)" % (self.id, self.name, text_w(self.name), self.w - 16))
        if text_w(self.sub, 5.58) > self.w - 16:
            raise ValueError("node sublabel too wide for %s: %r" % (self.id, self.sub))

    def port(self, side):
        return {
            "right": (self.x + self.w, self.cy),
            "left": (self.x, self.cy),
            "top": (self.cx, self.y),
            "bottom": (self.cx, self.y + NODE_H),
        }[side]

    def rect(self):
        return (self.x, self.y, self.w, NODE_H)


def rects_overlap(a, b, margin=0):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return not (ax + aw + margin <= bx or bx + bw + margin <= ax or ay + ah + margin <= by or by + bh + margin <= ay)


def seg_rect(seg):
    x1, y1, x2, y2 = seg
    return (min(x1, x2), min(y1, y2), abs(x2 - x1), abs(y2 - y1))


class Edge(object):
    def __init__(self, spec, nodes):
        self.a = nodes[spec["a"]]
        self.b = nodes[spec["b"]]
        self.route = spec.get("route", "auto")
        self.label = spec.get("label", "")
        self.style = spec.get("style", "solid")  # solid | accent | dash
        self.build()

    def build(self):
        a, b = self.a, self.b
        route = self.route
        if route == "auto":
            if a.lane == b.lane:
                route = "h"
            elif a.col == b.col:
                route = "v"
            else:
                raise ValueError("edge %s->%s needs an explicit route" % (a.id, b.id))
        self.route = route

        if route == "h":
            assert a.lane == b.lane, "h route needs same lane (%s->%s)" % (a.id, b.id)
            d = sign(b.cx - a.cx)
            p1 = a.port("right" if d > 0 else "left")
            p2 = b.port("left" if d > 0 else "right")
            self.line = (p1, p2)
            self.d = None
            self.segs = [(p1[0], p1[1], p2[0], p2[1])]
        elif route == "v":
            assert a.col == b.col, "v route needs same column (%s->%s)" % (a.id, b.id)
            d = sign(b.cy - a.cy)
            p1 = a.port("bottom" if d > 0 else "top")
            p2 = b.port("top" if d > 0 else "bottom")
            self.line = (p1, p2)
            self.d = None
            self.segs = [(p1[0], p1[1], p2[0], p2[1])]
        elif route == "hv":
            dx, dy = sign(b.cx - a.cx), sign(b.cy - a.cy)
            p1 = a.port("right" if dx > 0 else "left")
            p2 = b.port("top" if dy > 0 else "bottom")
            cx, cy = b.cx, a.cy
            self.d = "M %d,%d H %d Q %d,%d %d,%d V %d" % (p1[0], p1[1], cx - dx * R, cx, cy, cx, cy + dy * R, p2[1])
            self.line = None
            self.segs = [(p1[0], cy, cx, cy), (cx, cy, cx, p2[1])]
        elif route == "vh":
            dx, dy = sign(b.cx - a.cx), sign(b.cy - a.cy)
            p1 = a.port("bottom" if dy > 0 else "top")
            p2 = b.port("left" if dx > 0 else "right")
            cx, cy = a.cx, b.cy
            self.d = "M %d,%d V %d Q %d,%d %d,%d H %d" % (p1[0], p1[1], cy - dy * R, cx, cy, cx + dx * R, cy, p2[0])
            self.line = None
            self.segs = [(cx, p1[1], cx, cy), (cx, cy, p2[0], cy)]
        elif route in ("loop-top", "loop-bottom"):
            assert a.lane == b.lane, "loop route needs same lane"
            d = sign(b.cx - a.cx)
            lane_top = TOP + a.lane * LANE_H
            if route == "loop-top":
                ly = lane_top + 24
                p1, p2 = a.port("top"), b.port("top")
                self.d = "M %d,%d V %d Q %d,%d %d,%d H %d Q %d,%d %d,%d V %d" % (
                    p1[0], p1[1], ly + R, a.cx, ly, a.cx + d * R, ly, b.cx - d * R, b.cx, ly, b.cx, ly + R, p2[1])
            else:
                ly = lane_top + LANE_H - 24
                p1, p2 = a.port("bottom"), b.port("bottom")
                self.d = "M %d,%d V %d Q %d,%d %d,%d H %d Q %d,%d %d,%d V %d" % (
                    p1[0], p1[1], ly - R, a.cx, ly, a.cx + d * R, ly, b.cx - d * R, b.cx, ly, b.cx, ly - R, p2[1])
            self.line = None
            self.segs = [(a.cx, p1[1], a.cx, ly), (a.cx, ly, b.cx, ly), (b.cx, ly, b.cx, p2[1])]
        else:
            raise ValueError("unknown route %s" % route)

    def check_clear(self, nodes):
        """Rule 5: no transit behind a non-endpoint box."""
        for seg in self.segs:
            sr = seg_rect(seg)
            sr = (sr[0] - 1, sr[1] - 1, sr[2] + 2, sr[3] + 2)
            for n in nodes.values():
                if n is self.a or n is self.b:
                    continue
                if rects_overlap(sr, n.rect(), 2):
                    raise ValueError("edge %s->%s passes behind node %s" % (self.a.id, self.b.id, n.id))


def place_label(edge, nodes, dividers):
    """Return (x, y, w) of the mask rect, honoring the 6px gap, nodes and lane dividers."""
    text = edge.label
    lw = max(ceil4(text_w(text) + 8), 24)
    obstacles = [n.rect() for n in nodes.values()]
    segs = sorted(edge.segs, key=lambda s: -(abs(s[2] - s[0]) + abs(s[3] - s[1])))
    pref_above = edge.route != "loop-top"

    def clear(rect):
        if any(rects_overlap(rect, o, 2) for o in obstacles):
            return False
        if any(rect[1] - 2 <= dv <= rect[1] + rect[3] + 2 for dv in dividers):
            return False
        return True

    for seg in segs:
        x1, y1, x2, y2 = seg
        if y1 == y2:  # horizontal
            lo, hi = min(x1, x2) + 12, max(x1, x2) - 12
            if edge.route == "h":
                lo, hi = min(x1, x2) + 4, max(x1, x2) - 4
            mid = (x1 + x2) / 2.0
            for shift in (0, 8, -8, 16, -16, 24, -24, 32, -32, 48, -48):
                cx = mid + shift
                if cx - lw / 2.0 < lo or cx + lw / 2.0 > hi:
                    continue
                for above in ([pref_above, not pref_above]):
                    my = y1 - 6 - LABEL_H if above else y1 + 6
                    rect = (cx - lw / 2.0, my, lw, LABEL_H)
                    if clear(rect):
                        return (int(round(rect[0])), int(my), lw)
        elif x1 == x2:  # vertical
            lo, hi = min(y1, y2) + 12, max(y1, y2) - 12
            mid = (y1 + y2) / 2.0
            for shift in (0, 8, -8, 16, -16, 24, -24, 32, -32, 40, -40, 48, -48):
                my = mid - LABEL_H / 2.0 + shift
                if my < lo or my + LABEL_H > hi:
                    continue
                for side in ("right", "left"):
                    mx = x1 + 8 if side == "right" else x1 - 8 - lw
                    rect = (mx, my, lw, LABEL_H)
                    if clear(rect):
                        return (int(round(mx)), int(round(my)), lw)
    raise ValueError("no clear spot for label %r on %s->%s" % (text, edge.a.id, edge.b.id))


def esc(s):
    return html.escape(s, quote=True)


def render(flow, dark):
    pal = DARK if dark else LIGHT
    slug = flow["slug"] + ("-dark" if dark else "")
    lanes = flow["lanes"]
    n_lanes = len(lanes)
    nodes = {}
    for spec in flow["nodes"]:
        nodes[spec["id"]] = Node(spec, n_lanes)
    edges = [Edge(e, nodes) for e in flow["edges"]]

    # Budgets (SKILL.md §7)
    assert len(nodes) <= 9, "too many nodes"
    assert len(edges) <= 12, "too many arrows"
    assert sum(1 for n in nodes.values() if n.kind == "focal") <= 2, "too many focal nodes"
    assert n_lanes <= 5, "too many lanes"
    for e in edges:
        e.check_clear(nodes)

    base = TOP + n_lanes * LANE_H
    H = base + 144
    dividers = [TOP + i * LANE_H for i in range(n_lanes + 1)]

    out = []
    w = out.append
    w('<svg viewBox="0 0 %d %d" width="%d" height="%d" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="%s-title %s-desc">'
      % (W, H, W, H, slug, slug))
    w('  <title id="%s-title">%s</title>' % (slug, esc(flow["title"])))
    w('  <desc id="%s-desc">%s</desc>' % (slug, esc(flow["desc"])))
    w('  <defs>')
    w('    <marker id="%s-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="%s"/></marker>' % (slug, pal["muted"]))
    w('    <marker id="%s-arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="%s"/></marker>' % (slug, pal["accent"]))
    w('  </defs>')
    w('  <rect width="100%%" height="100%%" fill="%s"/>' % pal["paper"])

    # Lane dividers + actor column
    for i, y in enumerate(dividers):
        strong = i in (0, n_lanes)
        w('  <line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s" stroke-width="1"/>' % (LEFT, y, RIGHT, y, pal["rule_strong"] if strong else pal["rule_weak"]))
    w('  <line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s" stroke-width="1"/>' % (LABEL_COL, TOP, LABEL_COL, base, pal["rule_strong"]))

    # Lane labels (Thai register + Latin eyebrow)
    for i, (th, en) in enumerate(lanes):
        cy = TOP + i * LANE_H + LANE_H // 2
        w('  <text x="60" y="%d" fill="%s" font-size="12" font-weight="600" font-family="%s">%s</text>' % (cy - 4, pal["ink"], SANS, esc(th)))
        w('  <text x="60" y="%d" fill="%s" font-size="8" font-family="%s" letter-spacing="0.18em">%s</text>' % (cy + 14, pal["muted"], MONO, esc(en)))

    # Arrows first
    for e in edges:
        color = pal["accent"] if e.style == "accent" else pal["muted"]
        marker = "%s-arrow-accent" % slug if e.style == "accent" else "%s-arrow" % slug
        sw = "1.4" if e.style == "accent" else "1.2"
        dash = ' stroke-dasharray="5,4"' if e.style == "dash" else ""
        if e.line:
            (x1, y1), (x2, y2) = e.line
            w('  <line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s" stroke-width="%s"%s marker-end="url(#%s)"/>' % (x1, y1, x2, y2, color, sw, dash, marker))
        else:
            w('  <path d="%s" fill="none" stroke="%s" stroke-width="%s"%s marker-end="url(#%s)"/>' % (e.d, color, sw, dash, marker))

    # Arrow labels (masked, after arrows, before nodes)
    for e in edges:
        if not e.label:
            continue
        mx, my, lw = place_label(e, nodes, dividers)
        color = pal["accent"] if e.style == "accent" else pal["soft"]
        w('  <rect x="%d" y="%d" width="%d" height="%d" rx="2" fill="%s"/>' % (mx, my, lw, LABEL_H, pal["paper"]))
        w('  <text x="%s" y="%d" fill="%s" font-size="12" font-weight="500" font-family="%s" text-anchor="middle">%s</text>'
          % (("%g" % (mx + lw / 2.0)), my + 12, color, SANS, esc(e.label)))

    # Nodes
    for n in nodes.values():
        if n.kind == "focal":
            fill, stroke = pal["tint"], pal["accent"]
        elif n.kind == "effect":
            fill, stroke = pal["effect_fill"], pal["effect_stroke"]
        else:
            fill, stroke = pal["node_fill"], pal["ink"]
        w('  <rect x="%d" y="%d" width="%d" height="%d" rx="6" fill="%s"/>' % (n.x, n.y, n.w, NODE_H, pal["paper"]))
        w('  <rect x="%d" y="%d" width="%d" height="%d" rx="6" fill="%s" stroke="%s" stroke-width="1"/>' % (n.x, n.y, n.w, NODE_H, fill, stroke))
        w('  <text x="%d" y="%d" fill="%s" font-size="12" font-weight="600" font-family="%s" text-anchor="middle">%s</text>' % (n.cx, n.y + 24, pal["ink"], SANS, esc(n.name)))
        if n.sub:
            w('  <text x="%d" y="%d" fill="%s" font-size="9" font-family="%s" text-anchor="middle">%s</text>' % (n.cx, n.y + 40, pal["muted"], MONO, esc(n.sub)))

    # Legend
    ly = base + 24
    w('  <line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s" stroke-width="0.8"/>' % (LEFT, ly, RIGHT, ly, pal["rule_weak"]))
    w('  <text x="%d" y="%d" fill="%s" font-size="8" font-family="%s" letter-spacing="0.18em">LEGEND</text>' % (LEFT, ly + 24, pal["muted"], MONO))
    items = [("step", "ขั้นตอน")]
    if any(n.kind == "focal" for n in nodes.values()):
        items.append(("focal", flow.get("focal_legend", "ขั้นสำคัญ")))
    if any(n.kind == "effect" for n in nodes.values()):
        items.append(("effect", flow.get("effect_legend", "ผลต่อผู้เกี่ยวข้อง")))
    items.append(("arrow", "ลำดับขั้น"))
    if any(e.style == "accent" for e in edges):
        items.append(("accent", "ส่งต่อสำคัญ"))
    if any(e.style == "dash" for e in edges):
        items.append(("dash", flow.get("dash_legend", "วนกลับ / ทางเลือก")))
    x = LEFT
    iy = ly + 44
    for kind, label in items:
        if kind in ("step", "focal", "effect"):
            fill, stroke = {"step": (pal["node_fill"], pal["ink"]), "focal": (pal["tint"], pal["accent"]), "effect": (pal["effect_fill"], pal["effect_stroke"])}[kind]
            w('  <rect x="%d" y="%d" width="14" height="10" rx="2" fill="%s" stroke="%s" stroke-width="1"/>' % (x, iy, fill, stroke))
            tx = x + 20
        else:
            color = pal["accent"] if kind == "accent" else pal["muted"]
            marker = "%s-arrow-accent" % slug if kind == "accent" else "%s-arrow" % slug
            dash = ' stroke-dasharray="4,3"' if kind == "dash" else ""
            w('  <line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s" stroke-width="%s"%s marker-end="url(#%s)"/>' % (x, iy + 5, x + 28, iy + 5, color, "1.4" if kind == "accent" else "1.2", dash, marker))
            tx = x + 36
        w('  <text x="%d" y="%d" fill="%s" font-size="12" font-family="%s">%s</text>' % (tx, iy + 9, pal["muted"], SANS, esc(label)))
        x = ceil4(tx + text_w(label) + 28)
    if x > RIGHT:
        raise ValueError("legend too wide for %s" % slug)

    w('</svg>')
    return "\n".join(out) + "\n"


# ── Flow definitions ─────────────────────────────────────────────────────────
def N(id, col, lane, name, sub="", kind="step", w=NODE_W):
    return dict(id=id, col=col, lane=lane, name=name, sub=sub, kind=kind, w=w)


def E(a, b, route="auto", label="", style="solid"):
    return dict(a=a, b=b, route=route, label=label, style=style)


FLOWS = [
    dict(
        slug="bulk-void-envelope",
        title="Bulk Void Envelope user flow",
        desc="Swimlane user flow: a sender selects several envelopes and confirms a void with a reason, the system checks permissions and status then voids each eligible envelope, the sender reviews per-envelope results, and recipients receive a void notice by email.",
        lanes=[("ผู้ใช้", "SENDER"), ("ระบบ", "SYSTEM"), ("ผู้รับ", "RECIPIENT")],
        focal_legend="ขั้นที่ย้อนกลับไม่ได้", effect_legend="ผลที่เกิดกับผู้รับ", dash_legend="วนกลับ / ลองใหม่",
        nodes=[
            N("A", 0, 0, "เลือกหลาย Envelope", "status: INPROCESS"),
            N("B", 1, 0, "ยืนยัน + ระบุเหตุผล", "reason required", "focal"),
            N("C", 1, 1, "ตรวจสิทธิ์และสถานะ", "skip VOID/SUCCESS/no role"),
            N("D", 2, 1, "Void ทีละรายการ", "POST /eSignature/void"),
            N("E", 3, 1, "สรุปผลรายรายการ", "ok · skipped · failed"),
            N("F", 3, 0, "ดูผลและแก้ที่พลาด", "retry failed only"),
            N("G", 2, 2, "ได้รับอีเมลแจ้งยกเลิก", "email notice", "effect", 200),
        ],
        edges=[
            E("A", "B"),
            E("B", "C", "v", "ส่งคำขอ", "accent"),
            E("C", "D", "h", "ผ่าน"),
            E("D", "E"),
            E("E", "F", "v", "รายงานผล"),
            E("D", "G", "v", "แจ้งผู้รับ"),
            E("F", "A", "loop-top", "ลองใหม่เฉพาะที่พลาด", "dash"),
        ],
    ),
    dict(
        slug="realtime-dashboard",
        title="Real-time Dashboard user flow",
        desc="Swimlane user flow: a viewer opens the company dashboard, the system loads status totals, and the numbers update on their own when a signer changes an envelope's status.",
        lanes=[("ผู้ใช้", "VIEWER"), ("ระบบ", "SYSTEM"), ("ผู้เซ็น", "SIGNER")],
        focal_legend="ผลลัพธ์หลัก", effect_legend="เหตุการณ์จากผู้เซ็น",
        nodes=[
            N("U0", 0, 0, "เปิด Dashboard", "scope: whole company"),
            N("S0", 1, 1, "โหลดสรุปสถานะ", "POST /eSignature/search"),
            N("U1", 2, 0, "ดูภาพรวมตามสถานะ", "filter · drill-down"),
            N("U2", 3, 0, "ตัวเลขอัปเดตเอง", "no manual refresh", "focal"),
            N("S1", 3, 1, "รับเหตุการณ์สถานะ", "event: status changed"),
            N("P0", 3, 2, "ผู้เซ็นเซ็นเอกสาร", "status changes", "effect"),
        ],
        edges=[
            E("U0", "S0", "hv", "ขอข้อมูล"),
            E("S0", "U1", "hv", "ส่งตัวเลข"),
            E("U1", "U2", "h", "เปิดค้าง"),
            E("P0", "S1", "v", "เซ็นแล้ว"),
            E("S1", "U2", "v", "ดันอัปเดต", "accent"),
        ],
    ),
    dict(
        slug="delegate-signing",
        title="Delegate signing user flow",
        desc="Swimlane user flow: a recipient delegates signing to another person, the system validates and moves the signing turn, the delegate gets an email invite and signs, and the original recipient sees the updated status.",
        lanes=[("ผู้รับเดิม", "RECIPIENT"), ("ระบบ", "SYSTEM"), ("ผู้รับแทน", "DELEGATE")],
        focal_legend="ขั้นเปลี่ยนผู้เซ็น", effect_legend="ผลต่อผู้รับแทน",
        nodes=[
            N("R0", 0, 0, "เปิดเอกสารที่ได้รับ", "status: INPROCESS"),
            N("R1", 1, 0, "กด Delegate + ระบุอีเมล", "reason optional"),
            N("S0", 1, 1, "ตรวจสิทธิ์ส่งต่อ", "block self · void doc"),
            N("S1", 2, 1, "ย้ายคิวเซ็นให้ผู้รับแทน", "recipient replaced", "focal"),
            N("S2", 3, 1, "บันทึกผลการเซ็น", "audit log"),
            N("R2", 3, 0, "เห็นว่าส่งต่อแล้ว", "tracking updated"),
            N("D0", 2, 2, "ได้รับอีเมลคำเชิญ", "email invite", "effect"),
            N("D1", 3, 2, "เซ็นเอกสารแทน", "authen as delegate"),
        ],
        edges=[
            E("R0", "R1"),
            E("R1", "S0", "v", "ส่งคำขอ", "accent"),
            E("S0", "S1", "h", "ผ่าน"),
            E("S1", "D0", "v", "ส่งอีเมล"),
            E("D0", "D1", "h", "เปิดลิงก์"),
            E("D1", "S2", "v", "เซ็นเสร็จ"),
            E("S2", "R2", "v", "แจ้งผลกลับ"),
        ],
    ),
    dict(
        slug="template-sharing",
        title="Template sharing user flow",
        desc="Swimlane user flow: a template owner picks a template and sets team permissions, the system saves the sharing rule and emails members, members open and reuse the template, and the owner can later change or revoke access.",
        lanes=[("เจ้าของ Template", "OWNER"), ("ระบบ", "SYSTEM"), ("สมาชิกทีม", "MEMBER")],
        focal_legend="จุดตัดสินใจสิทธิ์", effect_legend="ฝั่งสมาชิกทีม", dash_legend="เปลี่ยนสิทธิ์ภายหลัง",
        nodes=[
            N("O0", 0, 0, "เลือก Template", "my templates"),
            N("O1", 1, 0, "กำหนดผู้รับและสิทธิ์", "View | Edit", "focal"),
            N("O2", 3, 0, "แก้สิทธิ์ / ยกเลิกแชร์", "revoke anytime"),
            N("S0", 1, 1, "บันทึกกฎการแชร์", "sharing rule saved"),
            N("S1", 2, 1, "แจ้งสมาชิกทางอีเมล", "email notice"),
            N("S2", 3, 1, "ปรับสิทธิ์มีผลทันที", "access updated"),
            N("M0", 2, 2, "เปิด Template ที่แชร์", "by granted level", "effect"),
            N("M1", 3, 2, "ใช้สร้างเอกสารใหม่", "copy to draft"),
        ],
        edges=[
            E("O0", "O1"),
            E("O1", "S0", "v", "บันทึกสิทธิ์", "accent"),
            E("S0", "S1", "h", "สำเร็จ"),
            E("S1", "M0", "v", "ส่งอีเมล"),
            E("M0", "M1", "h", "กดใช้"),
            E("O2", "S2", "v", "ปรับ", "dash"),
            E("S2", "M1", "v", "ตัดสิทธิ์", "dash"),
        ],
    ),
    dict(
        slug="eform-public-link",
        title="E-Form public link user flow",
        desc="Swimlane user flow: a creator opens a public link for an E-Form, shares it outside the system, an external guest fills the form without logging in, and the system validates and stores the response for the creator.",
        lanes=[("ผู้สร้างฟอร์ม", "CREATOR"), ("ระบบ", "SYSTEM"), ("ผู้กรอกภายนอก", "GUEST")],
        focal_legend="ขั้นที่ไม่ต้อง Login", dash_legend="ส่งต่อนอกระบบ",
        nodes=[
            N("C0", 0, 0, "สร้าง E-Form + เปิดลิงก์", "role: EFORM_CREATE"),
            N("C1", 1, 0, "คัดลอกลิงก์ไปแชร์", "no login needed"),
            N("C2", 3, 0, "เห็นคำตอบที่ส่งเข้ามา", "response list"),
            N("S0", 0, 1, "สร้างลิงก์สาธารณะ", "tokenized URL"),
            N("S1", 3, 1, "ตรวจและบันทึกคำตอบ", "stored per link"),
            N("G0", 2, 2, "เปิดแบบฟอร์ม", "no login required", "focal"),
            N("G1", 3, 2, "กรอกและส่งข้อมูล", "required fields checked"),
        ],
        edges=[
            E("C0", "S0", "v", "ขอลิงก์"),
            E("S0", "C1", "hv", "ได้ลิงก์"),
            E("C1", "G0", "hv", "ส่งลิงก์ออกไป", "dash"),
            E("G0", "G1", "h", "กรอก"),
            E("G1", "S1", "v", "ส่งข้อมูล"),
            E("S1", "C2", "v", "แจ้งผู้สร้าง", "accent"),
        ],
    ),
    dict(
        slug="recipient-2fa",
        title="Recipient 2FA user flow",
        desc="Swimlane user flow: a recipient opens the document link, the system requires two-factor authentication and sends a one-time code, the recipient enters it, and the system either lets them sign or lets them request a new code after a wrong attempt.",
        lanes=[("ผู้เซ็น", "RECIPIENT"), ("ระบบ", "SYSTEM")],
        focal_legend="ผ่านการยืนยันตัวตน", effect_legend="OTP ถึงผู้เซ็น", dash_legend="ผิด / ขอรหัสใหม่",
        nodes=[
            N("R0", 0, 0, "เปิดลิงก์เอกสาร", "from email"),
            N("R1", 1, 0, "ได้รับรหัส OTP", "SMS · Email", "effect"),
            N("R2", 2, 0, "กรอกรหัส OTP", "6 digits"),
            N("R3", 3, 0, "เซ็นเอกสารได้", "identity verified", "focal"),
            N("S0", 0, 1, "ตรวจว่าต้องทำ 2FA", "doc requires authen"),
            N("S1", 1, 1, "สร้างและส่ง OTP", "expires · rate limit"),
            N("S2", 2, 1, "ตรวจรหัส", "max tries · lock"),
        ],
        edges=[
            E("R0", "S0", "v", "เปิดลิงก์"),
            E("S0", "S1", "h", "ต้องทำ"),
            E("S1", "R1", "v", "ส่ง OTP"),
            E("R1", "R2", "h", "กรอก"),
            E("R2", "S2", "v", "ส่งรหัส"),
            E("S2", "R3", "hv", "ถูกต้อง", "accent"),
            E("S2", "S1", "loop-bottom", "ผิด: ขอรหัสใหม่", "dash"),
        ],
    ),
    dict(
        slug="envelope-reminder",
        title="Envelope reminder user flow",
        desc="Swimlane user flow: a sender sets a reminder rule, the system checks pending envelopes near expiry and emails the recipient, repeating until the recipient signs, then stops reminding and updates the sender.",
        lanes=[("ผู้ส่ง", "SENDER"), ("ระบบ", "SYSTEM"), ("ผู้เซ็น", "RECIPIENT")],
        focal_legend="ผลลัพธ์ที่ต้องการ", effect_legend="อีเมลถึงผู้เซ็น", dash_legend="เตือนซ้ำ",
        nodes=[
            N("U0", 0, 0, "ตั้งกฎเตือนในเอกสาร", "before expiry · interval"),
            N("U1", 3, 0, "เห็นสถานะอัปเดต", "tracking updated"),
            N("S0", 0, 1, "บันทึกกำหนดเตือน", "schedule saved"),
            N("S1", 1, 1, "เช็คเอกสารค้างเซ็น", "INPROCESS · near expiry"),
            N("S2", 2, 1, "ส่งอีเมลเตือน", "email reminder"),
            N("S3", 3, 1, "หยุดเตือนรายการนี้", "stop reminders"),
            N("P0", 2, 2, "ได้รับอีเมลเตือน", "link to sign", "effect"),
            N("P1", 3, 2, "เซ็นเอกสาร", "status: COMPLETE", "focal"),
        ],
        edges=[
            E("U0", "S0", "v", "ตั้งกฎ"),
            E("S0", "S1", "h", "ทุกวัน"),
            E("S1", "S2", "h", "ใกล้หมด"),
            E("S2", "P0", "v", "ส่งเตือน"),
            E("P0", "P1", "h", "กดเซ็น"),
            E("P1", "S3", "v", "เซ็นแล้ว", "accent"),
            E("S3", "U1", "v", "แจ้งผู้ส่ง"),
            E("S2", "S1", "loop-top", "ยังไม่เซ็น: เตือนซ้ำ", "dash"),
        ],
    ),
    dict(
        slug="export-report",
        title="Export Report user flow",
        desc="Swimlane user flow: an admin picks a monthly report and file format, the system gathers usage statistics and builds the file, and the admin downloads it, or receives an emailed link when the file is large.",
        lanes=[("ผู้ใช้", "ADMIN"), ("ระบบ", "SYSTEM")],
        focal_legend="รายงานที่ได้รับ", dash_legend="ทางเลือกเมื่อไฟล์ใหญ่",
        nodes=[
            N("U0", 0, 0, "เลือกรายงานรายเดือน", "month · scope"),
            N("U1", 1, 0, "เลือกรูปแบบไฟล์", "PDF · XLSX · CSV"),
            N("U2", 2, 0, "ได้รับแจ้งว่าไฟล์พร้อม", "ready to download"),
            N("U3", 3, 0, "ดาวน์โหลดรายงาน", "file saved", "focal"),
            N("S0", 1, 1, "รวบรวมสถิติเอกสาร", "count by status · user"),
            N("S1", 2, 1, "สร้างไฟล์รายงาน", "async if large"),
            N("S2", 3, 1, "ส่งลิงก์ทางอีเมล", "if over size limit"),
        ],
        edges=[
            E("U0", "U1"),
            E("U1", "S0", "v", "ขอรายงาน", "accent"),
            E("S0", "S1", "h", "รวมแล้ว"),
            E("S1", "U2", "v", "พร้อมแล้ว"),
            E("U2", "U3", "h", "กดโหลด"),
            E("S1", "S2", "h", "ไฟล์ใหญ่", "dash"),
            E("S2", "U3", "v", "ลิงก์อีเมล", "dash"),
        ],
    ),
]


CHECK_WRAPPER = """<!DOCTYPE html>
<html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<style>body{{margin:0;padding:2rem;background:{paper}}}.diagram-container{{width:100%;overflow-x:auto}}svg{{width:100%;min-width:1280px;display:block}}</style>
</head><body>
<div class="diagram-container">
{svg}</div>
</body></html>
"""


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(here, "..", "src", "assets", "flows"))
    ap.add_argument("--check-dir", default=None, help="also write HTML wrappers for the skill's verify scripts")
    ap.add_argument("--only", default=None, help="only generate this slug")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    if args.check_dir:
        os.makedirs(args.check_dir, exist_ok=True)

    failed = False
    for flow in FLOWS:
        if args.only and flow["slug"] != args.only:
            continue
        for dark in (False, True):
            name = flow["slug"] + ("-dark" if dark else "")
            try:
                svg = render(flow, dark)
            except (ValueError, AssertionError) as exc:
                print("FAIL %s: %s" % (name, exc))
                failed = True
                continue
            with open(os.path.join(args.out, name + ".svg"), "w", encoding="utf-8") as fh:
                fh.write(svg)
            if args.check_dir:
                paper = (DARK if dark else LIGHT)["paper"]
                with open(os.path.join(args.check_dir, name + ".html"), "w", encoding="utf-8") as fh:
                    fh.write(CHECK_WRAPPER.format(title=flow["title"], paper=paper, svg=svg))
            print("ok   %s" % name)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
