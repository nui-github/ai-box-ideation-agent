# PO Assistant: หลักการคิดและทำงานของ AI (Instruction Prompt)

เอกสารนี้เก็บหลักการที่ AI ยึดทุกครั้งที่วิเคราะห์โจทย์ฟีเจอร์ในแอปนี้

## หลักการหลัก

> คุณคือ Senior Product Owner ผู้เชี่ยวชาญด้าน UX และ System Design ทุกครั้งที่ได้รับโจทย์ฟีเจอร์ ให้วิเคราะห์และตอบกลับเป็น 4 ส่วนเสมอ ได้แก่: 1. User Stories (พร้อม Acceptance Criteria), 2. Main User Flow (ในรูปแบบ flowchart), 3. Alternative Use Cases และ 4. Edge Cases & Error Handling ที่อาจเกิดขึ้น

| ส่วน | หัวข้อที่ AI ตอบ (`##`) | การ์ดในแอป |
|---|---|---|
| 1. User Stories + Acceptance Criteria | `📖 User Stories` | User Stories (cyan) |
| 2. Main User Flow (flowchart) | `📋 User Flow` + `🗺️ Flow Diagram` | User Flow / Flow Diagram |
| 3. Alternative Use Cases | `🔀 Alternative Use Cases` | Alternative Use Cases (magenta) |
| 4. Edge Cases & Error Handling | `🚧 Edge Cases & Error Handling` | Edge Cases & Error Handling (orange) |

หลังจาก 4 ส่วนนี้ AI ยังตอบส่วนเสริมเดิมต่อ: Flow Analysis, Pros & Cons, Technical Alert, UI Components

## ตำแหน่งของ prompt

- **ค่าเริ่มต้น** อยู่ที่ [`api/_lib/default-instruction-prompt.md`](../api/_lib/default-instruction-prompt.md) (ไฟล์เดียวที่เป็น source of truth ของข้อความ prompt แก้ไฟล์นี้เพื่อเปลี่ยนค่าเริ่มต้น)
- **แก้ในแอป**: Settings → tab "AI Model" → ช่อง "Instruction Prompt" แล้วกด "บันทึกการตั้งค่า" (กด "คืนค่าเริ่มต้น" เพื่อกลับไปใช้ไฟล์ด้านบน)
- ค่าที่แก้เก็บที่ `data/instruction-prompt.json` (ไม่ commit) ถ้าไม่มีไฟล์นี้ระบบใช้ค่าเริ่มต้น
- API: `GET/PUT/DELETE /api/instruction` ([api/instruction.mjs](../api/instruction.mjs))

## สิ่งที่ระบบเติมให้เองต่อท้าย (แก้ไม่ได้)

ประกอบใน `buildSystemInstruction()` ([api/_lib/gemini-design.mjs](../api/_lib/gemini-design.mjs)):

1. Instruction Prompt (ค่าเริ่มต้นหรือที่แก้ไว้)
2. ข้อมูล Business Logic ที่อัปโหลดไว้
3. รูปแบบ JSON ของ Flow Diagram (`FLOW_FORMAT_SPEC`) เพราะตัววาดแผนภาพในแอปพึ่งพารูปแบบนี้ ถ้าให้แก้ได้ แผนภาพอาจเสีย

หมายเหตุ: ถ้าแก้ชื่อหัวข้อ `##` ใน prompt การ์ดที่ไม่รู้จักจะแสดงเป็นสไตล์ default ส่วนหัวข้อ `🗺️ Flow Diagram` ต้องคงชื่อเดิมไว้เพื่อให้แผนภาพแสดง
