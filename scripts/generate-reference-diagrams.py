#!/usr/bin/env python3
"""Generate the System Reference diagrams (API groups, data model, roles).

Companion to generate-flow-diagrams.py and built on the same palette, fonts and
rules from the diagram-design skill (.claude/skills/diagram-design). Content is
taken only from the app's System Reference text (src/app/mock-data/ux-flow.mock.ts)
and the default system knowledge in api/_lib/business-logic-store.mjs; nothing is
invented beyond that.

Usage (Python 3.8+):
    python3 scripts/generate-reference-diagrams.py
    python3 scripts/generate-reference-diagrams.py --check-dir DIR
Writes src/assets/flows/ref-{api,dto,roles}[-dark].svg
"""
import argparse
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("flows", os.path.join(HERE, "generate-flow-diagrams.py"))
flows = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(flows)

LIGHT, DARK, SANS, MONO = flows.LIGHT, flows.DARK, flows.SANS, flows.MONO
text_w, ceil4, esc = flows.text_w, flows.ceil4, flows.esc
W, LEFT, RIGHT = flows.W, flows.LEFT, flows.RIGHT


class Svg(object):
    def __init__(self, slug, title, desc, pal):
        self.slug, self.pal = slug, pal
        self.title, self.desc = title, desc
        self.out = []

    def add(self, s):
        self.out.append(s)

    def text(self, x, y, s, size=12, weight=None, fill=None, family=SANS, anchor=None, spacing=None):
        attrs = ' fill="%s" font-size="%s" font-family="%s"' % (fill or self.pal["ink"], size, family)
        if weight:
            attrs += ' font-weight="%s"' % weight
        if anchor:
            attrs += ' text-anchor="%s"' % anchor
        if spacing:
            attrs += ' letter-spacing="%s"' % spacing
        self.add('  <text x="%s" y="%s"%s>%s</text>' % (x, y, attrs, esc(s)))

    def box(self, x, y, w, h, kind="step", dash=False):
        p = self.pal
        fill, stroke = {
            "step": (p["node_fill"], p["ink"]),
            "focal": (p["tint"], p["accent"]),
            "effect": (p["effect_fill"], p["effect_stroke"]),
        }[kind]
        self.add('  <rect x="%d" y="%d" width="%d" height="%d" rx="6" fill="%s"/>' % (x, y, w, h, p["paper"]))
        d = ' stroke-dasharray="4,3"' if dash else ""
        self.add('  <rect x="%d" y="%d" width="%d" height="%d" rx="6" fill="%s" stroke="%s" stroke-width="1"%s/>' % (x, y, w, h, fill, stroke, d))

    def line(self, x1, y1, x2, y2, style="solid"):
        p = self.pal
        color = p["accent"] if style == "accent" else p["muted"]
        marker = "%s-arrow-accent" % self.slug if style == "accent" else "%s-arrow" % self.slug
        dash = ' stroke-dasharray="5,4"' if style == "dash" else ""
        self.add('  <line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s" stroke-width="%s"%s marker-end="url(#%s)"/>' % (x1, y1, x2, y2, color, "1.4" if style == "accent" else "1.2", dash, marker))

    def path(self, d, style="solid"):
        p = self.pal
        color = p["accent"] if style == "accent" else p["muted"]
        marker = "%s-arrow-accent" % self.slug if style == "accent" else "%s-arrow" % self.slug
        dash = ' stroke-dasharray="5,4"' if style == "dash" else ""
        self.add('  <path d="%s" fill="none" stroke="%s" stroke-width="%s"%s marker-end="url(#%s)"/>' % (d, color, "1.4" if style == "accent" else "1.2", dash, marker))

    def label(self, cx, y, s, color=None):
        """Masked arrow label; (cx, y) is the mask's top-center."""
        lw = max(ceil4(text_w(s) + 8), 24)
        self.add('  <rect x="%d" y="%d" width="%d" height="16" rx="2" fill="%s"/>' % (cx - lw // 2, y, lw, self.pal["paper"]))
        self.text(cx, y + 12, s, 12, "500", color or self.pal["soft"], SANS, "middle")

    def legend(self, base, items, note=None, right=RIGHT):
        p = self.pal
        ly = base + 24
        self.add('  <line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s" stroke-width="0.8"/>' % (LEFT, ly, right, ly, p["rule_weak"]))
        self.text(LEFT, ly + 24, "LEGEND", 8, None, p["muted"], MONO, None, "0.18em")
        x, iy = LEFT, ly + 44
        for kind, label in items:
            if kind in ("step", "focal", "effect", "zone"):
                if kind == "zone":
                    self.add('  <rect x="%d" y="%d" width="14" height="10" rx="2" fill="none" stroke="%s" stroke-width="1" stroke-dasharray="3,2"/>' % (x, iy, p["rule_strong"]))
                else:
                    fill, stroke = {"step": (p["node_fill"], p["ink"]), "focal": (p["tint"], p["accent"]), "effect": (p["effect_fill"], p["effect_stroke"])}[kind]
                    self.add('  <rect x="%d" y="%d" width="14" height="10" rx="2" fill="%s" stroke="%s" stroke-width="1"/>' % (x, iy, fill, stroke))
                tx = x + 20
            else:
                color = p["accent"] if kind == "accent" else p["muted"]
                marker = "%s-arrow-accent" % self.slug if kind == "accent" else "%s-arrow" % self.slug
                dash = ' stroke-dasharray="4,3"' if kind == "dash" else ""
                self.add('  <line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s" stroke-width="%s"%s marker-end="url(#%s)"/>' % (x, iy + 5, x + 28, iy + 5, color, "1.4" if kind == "accent" else "1.2", dash, marker))
                tx = x + 36
            self.text(tx, iy + 9, label, 12, None, p["muted"])
            x = ceil4(tx + text_w(label) + 28)
        if note:
            self.text(right, iy + 9, note, 12, None, p["soft"], SANS, "end")
        assert x <= right - (text_w(note) + 24 if note else 0), "legend too wide for %s" % self.slug

    def done(self, left, top, right, bottom, pad=32):
        """Frame the content with equal padding on every side."""
        p = self.pal
        vx, vy, vw, vh = left - pad, top - pad, right - left + 2 * pad, bottom - top + 2 * pad
        head = [
            '<svg viewBox="%d %d %d %d" width="%d" height="%d" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="%s-title %s-desc">' % (vx, vy, vw, vh, vw, vh, self.slug, self.slug),
            '  <title id="%s-title">%s</title>' % (self.slug, esc(self.title)),
            '  <desc id="%s-desc">%s</desc>' % (self.slug, esc(self.desc)),
            '  <defs>',
            '    <marker id="%s-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="%s"/></marker>' % (self.slug, p["muted"]),
            '    <marker id="%s-arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="%s"/></marker>' % (self.slug, p["accent"]),
            '  </defs>',
            '  <rect x="%d" y="%d" width="%d" height="%d" fill="%s"/>' % (vx, vy, vw, vh, p["paper"]),
        ]
        return "\n".join(head + self.out + ["</svg>"]) + "\n"


# ── 1. API groups ────────────────────────────────────────────────────────────
API_GROUPS = [
    dict(eyebrow="API GROUP · 01", title="ระบบจัดการเอกสาร (eSignature)", kind="focal",
         endpoints=["/eSignature/save", "/search · /getByTracking", "/download · /void · /delete"],
         caps=["บันทึกร่าง / ส่งเอกสารให้ผู้ที่เกี่ยวข้องเซ็น", "ค้นหาเอกสาร และตรวจสถานะล่าสุด", "ดาวน์โหลดไฟล์ที่จัดการเสร็จสมบูรณ์", "ยกเลิกเอกสารที่ส่งแล้ว หรือลบออกจากระบบ", "ส่งอีเมลแจ้งซ้ำไปเตือนผู้เซ็น"]),
    dict(eyebrow="API GROUP · 02", title="ระบบแชร์ข้อมูล (Sharing)", kind="step",
         endpoints=["/sharing/owner/esignature/get"],
         caps=["เจ้าของ: กำหนดสิทธิ์ · สร้างลิงก์ · แก้ไข/ลบการแชร์", "สมาชิก: เข้าถึงตามสิทธิ์ที่ได้รับ", "สมาชิก: ดูข้อมูลที่แชร์มา · รับอีเมลแจ้งเตือน"]),
    dict(eyebrow="API GROUP · 03", title="ระบบแม่แบบ (Template & E-Form)", kind="step",
         endpoints=None,
         caps=["Template: บันทึกโครงสร้างเอกสารไว้ใช้ซ้ำ", "E-Form: สร้างแบบฟอร์มออนไลน์", "ผู้รับกดลิงก์เพื่อกรอกข้อมูลเองได้โดยตรง"]),
]


def render_api(dark):
    pal = DARK if dark else LIGHT
    slug = "ref-api" + ("-dark" if dark else "")
    y0, gh, gap = 48, 148, 24
    top_to_bottom = 3 * gh + 2 * gap
    base = y0 + top_to_bottom + 4
    s = Svg(slug, "API Endpoints overview",
            "Architecture overview: the app calls three API groups: document management, sharing, and template and E-Form, with the document group highlighted as the core.",
            pal)

    centers = [y0 + i * (gh + gap) + gh // 2 for i in range(3)]
    # Arrows first (straight horizontals from the tall client column to each group)
    for cy in centers:
        s.line(280, cy, 380, cy)

    # Client column
    s.box(40, y0, 240, top_to_bottom)
    s.text(60, y0 + 28, "CLIENT", 8, None, pal["muted"], MONO, None, "0.18em")
    s.text(160, y0 + top_to_bottom // 2 - 2, "แอป eSignature", 12, "600", pal["ink"], SANS, "middle")
    s.text(160, y0 + top_to_bottom // 2 + 14, "request → API", 9, None, pal["muted"], MONO, "middle")

    for i, g in enumerate(API_GROUPS):
        y = y0 + i * (gh + gap)
        s.box(380, y, 860, gh, g["kind"])
        s.add('  <line x1="760" y1="%d" x2="760" y2="%d" stroke="%s" stroke-width="1"/>' % (y + 16, y + gh - 16, pal["rule_weak"]))
        s.text(400, y + 28, g["eyebrow"], 8, None, pal["accent"] if g["kind"] == "focal" else pal["muted"], MONO, None, "0.14em")
        s.text(400, y + 52, g["title"], 14, "600", pal["ink"])
        if g["endpoints"]:
            for j, ep in enumerate(g["endpoints"]):
                s.text(400, y + 80 + j * 18, ep, 10, None, pal["ink"], MONO)
        else:
            s.text(400, y + 80, "ยังไม่มี endpoint ระบุในข้อมูลอ้างอิง", 12, None, pal["soft"])
        for j, cap in enumerate(g["caps"]):
            assert text_w(cap) <= 424, "cap too wide: %s" % cap
            cy = y + 36 + j * 20
            s.add('  <circle cx="784" cy="%d" r="2" fill="%s"/>' % (cy - 4, pal["muted"]))
            s.text(796, cy, cap, 12, None, pal["ink"])
    s.legend(base, [("step", "กลุ่ม API"), ("focal", "กลุ่มหลักที่ flow ส่วนใหญ่ใช้"), ("arrow", "เรียกใช้")], right=1240)
    return s.done(LEFT, y0, 1240, base + 80)


# ── 2. Data model (conceptual ER) ───────────────────────────────────────────
def entity(s, x, y, w, tag, name, rows, kind="step"):
    """Two-section ER box. rows = [(Thai field name, mono type)]. Returns height."""
    pal = s.pal
    h = 48 + 24 * len(rows) + (4 if rows else 0)
    s.box(x, y, w, h, kind)
    band = pal["tint"] if kind == "focal" else pal["effect_fill"]
    s.add('  <rect x="%d" y="%d" width="%d" height="40" rx="6" fill="%s"/>' % (x + 1, y + 1, w - 2, band))
    s.add('  <rect x="%d" y="%d" width="%d" height="8" fill="%s"/>' % (x + 1, y + 33, w - 2, band))
    s.add('  <line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s" stroke-width="1"/>' % (x, y + 40, x + w, y + 40, pal["accent"] if kind == "focal" else pal["rule_strong"]))
    s.text(x + 16, y + 16, tag, 8, None, pal["accent"] if kind == "focal" else pal["muted"], MONO, None, "0.14em")
    s.text(x + 16, y + 32, name, 14, "600", pal["ink"])
    for i, (fname, ftype) in enumerate(rows):
        assert text_w(fname) + text_w(ftype, 6.2) <= w - 48, "ER row too wide: %s / %s" % (fname, ftype)
        ry = y + 64 + 24 * i
        s.text(x + 16, ry, fname, 12, None, pal["ink"])
        s.text(x + w - 16, ry, ftype, 10, None, pal["muted"], MONO, "end")
    return h


def enum_box(s, x, y, w, name, lines):
    pal = s.pal
    h = 48 + 20 * len(lines) - 8
    s.box(x, y, w, h, "effect", dash=True)
    s.text(x + 16, y + 20, "ENUM", 8, None, pal["muted"], MONO, None, "0.14em")
    s.text(x + 16, y + 36, name, 12, "600", pal["ink"])
    for i, ln in enumerate(lines):
        assert text_w(ln, 6.2) <= w - 32, "enum line too wide: %s" % ln
        s.text(x + 16, y + 60 + 20 * i, ln, 10, None, pal["muted"], MONO)
    return h


def render_dto(dark):
    pal = DARK if dark else LIGHT
    slug = "ref-dto" + ("-dark" if dark else "")
    base = 480
    s = Svg(slug, "Data Models overview",
            "Conceptual data model: an envelope has recipients and share settings, and uses status enums for the overall document and for each recipient. Not the physical database schema.",
            pal)

    # Connectors first
    s.line(380, 120, 300, 120, "dash")            # Envelope -> Status
    s.line(700, 120, 820, 120)                    # Envelope -> Recipient
    s.path("M 540,280 V 414 Q 540,422 548,422 H 820")  # Envelope -> Share
    s.line(1000, 172, 1000, 212, "dash")          # Recipient -> StatusRecipient

    # Labels + cardinality
    s.label(340, 98, "สถานะ")
    s.label(760, 98, "มีผู้เซ็น")
    s.text(708, 114, "1", 8, None, pal["muted"], MONO)
    s.text(812, 114, "N", 8, None, pal["muted"], MONO, "end")
    s.label(684, 396, "ถูกแชร์")
    s.text(548, 296, "1", 8, None, pal["muted"], MONO)
    s.text(812, 416, "N", 8, None, pal["muted"], MONO, "end")
    s.label(1036, 184, "สถานะ")

    enum_box(s, 40, 72, 260, "Status", ["DRAFT · INPROCESS · VOID · SUCCESS", "REVISING · RETURNED · REJECTED"])
    entity(s, 380, 72, 320, "ENTITY · AGGREGATE ROOT", "Envelope (Tracking)", [
        ("เลขที่อ้างอิง", "id"),
        ("หัวข้อเอกสาร", "text"),
        ("ไฟล์ที่เกี่ยวข้อง", "file[]"),
        ("วิธียืนยันตัวตน", "authen · eKYC"),
        ("รูปแบบการอนุมัติ", "SEQUENTIAL | PARALLEL"),
        ("สถานะภาพรวม", "Status"),
    ], "focal")
    entity(s, 820, 72, 360, "ENTITY", "Recipient (ผู้เซ็น)", [
        ("รายชื่อ / กลุ่มผู้อนุมัติ", "person | group"),
        ("สถานะรายบุคคล", "StatusRecipient"),
    ])
    enum_box(s, 820, 212, 360, "StatusRecipient", ["PENDING · INPROCESS · COMPLETE", "RETURNED · REJECTED · VOID"])
    entity(s, 820, 372, 360, "ENTITY", "Share (การแชร์)", [
        ("ระดับการแชร์", "VIEW | EDIT"),
        ("เงื่อนไขการเข้าถึง", "link | org | person"),
    ])
    s.legend(base, [("focal", "ข้อมูลหลักที่เป็นศูนย์กลาง"), ("step", "ข้อมูลที่เกี่ยวข้อง"), ("effect", "ค่าที่กำหนดไว้ (Enum)"), ("arrow", "เกี่ยวข้องกัน"), ("dash", "ใช้ค่าสถานะ")],
             note="โครงสร้างเชิงแนวคิด ไม่ใช่ schema ฐานข้อมูลจริง", right=1180)
    return s.done(LEFT, 72, 1180, base + 80)


# ── 3. Roles & permissions ───────────────────────────────────────────────────
ROLE_ZONES = [
    ("สร้างและจัดการเนื้อหา", "CONTENT", [
        ("ESIG_CREATE", "ผู้สร้างเอกสาร", "อัปโหลด ตั้งค่า และส่งเอกสารให้ผู้อื่น", "step"),
        ("EFORM_CREATE", "ผู้สร้างแบบฟอร์ม", "สร้าง E-Form ให้คนทั่วไปกรอกผ่านลิงก์", "step"),
    ]),
    ("ดูข้อมูลและทำงานเบื้องหลัง", "ACCESS", [
        ("RECIPIENT", "ผู้รับสิทธิ์เข้าถึง (Recipient)", "เปิดดูเฉพาะเอกสารที่ถูกส่งให้ตนเอง", "step"),
        ("VIEWER", "ผู้เยี่ยมชม (Viewer)", "ดูได้ แต่เปลี่ยนแปลงข้อมูลไม่ได้", "step"),
    ]),
    ("ฝ่ายเทคนิคและบริหารระบบ", "ADMINISTRATION", [
        ("ADMIN", "ผู้ดูแลระบบ (Admin)", "จัดการสิทธิ์ เข้าถึงข้อมูลทั้งหมดได้ครอบคลุม", "focal"),
    ]),
]


def render_roles(dark):
    pal = DARK if dark else LIGHT
    slug = "ref-roles" + ("-dark" if dark else "")
    zy, zh, zw, zgap = 48, 284, 368, 32
    base = zy + zh + 4
    s = Svg(slug, "Roles and permissions overview",
            "Role groups: content creators (document and form creators), access roles (recipient and viewer), and administration (admin with full management access).",
            pal)
    for zi, (title, tag, cards) in enumerate(ROLE_ZONES):
        zx = 40 + zi * (zw + zgap)
        s.add('  <rect x="%d" y="%d" width="%d" height="%d" rx="8" fill="none" stroke="%s" stroke-width="1" stroke-dasharray="4,4"/>' % (zx, zy, zw, zh, pal["rule_strong"]))
        s.text(zx + 20, zy + 28, title, 12, "600", pal["ink"])
        s.text(zx + 20, zy + 44, tag, 8, None, pal["muted"], MONO, None, "0.18em")
        for ci, (code, name, desc, kind) in enumerate(cards):
            cx, cy = zx + 16, zy + 60 + ci * 116
            s.box(cx, cy, zw - 32, 100, kind)
            assert text_w(name, 8.4) <= zw - 64 and text_w(desc) <= zw - 64, "role text too wide: %s" % name
            s.text(cx + 16, cy + 24, code, 9, None, pal["accent"] if kind == "focal" else pal["muted"], MONO, None, "0.12em")
            s.text(cx + 16, cy + 48, name, 14, "600", pal["ink"])
            s.text(cx + 16, cy + 74, desc, 12, None, pal["muted"])
    s.legend(base, [("step", "บทบาท"), ("focal", "สิทธิ์สูงสุด"), ("zone", "กลุ่มสิทธิ์")], right=1208)
    return s.done(LEFT, zy, 1208, base + 80)


DIAGRAMS = [("ref-api", render_api), ("ref-dto", render_dto), ("ref-roles", render_roles)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(HERE, "..", "src", "assets", "flows"))
    ap.add_argument("--check-dir", default=None)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    if args.check_dir:
        os.makedirs(args.check_dir, exist_ok=True)
    failed = False
    for slug, fn in DIAGRAMS:
        for dark in (False, True):
            name = slug + ("-dark" if dark else "")
            try:
                svg = fn(dark)
            except AssertionError as exc:
                print("FAIL %s: %s" % (name, exc))
                failed = True
                continue
            with open(os.path.join(args.out, name + ".svg"), "w", encoding="utf-8") as fh:
                fh.write(svg)
            if args.check_dir:
                paper = (DARK if dark else LIGHT)["paper"]
                with open(os.path.join(args.check_dir, name + ".html"), "w", encoding="utf-8") as fh:
                    fh.write(flows.CHECK_WRAPPER.format(title=name, paper=paper, svg=svg))
            print("ok   %s" % name)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
