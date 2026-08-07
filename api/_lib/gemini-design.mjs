import { GoogleGenAI } from '@google/genai';

export const modelLimits = {
  'gemini-3.6-flash': 15,
  'gemini-3.5-flash': 15,
  'gemini-2.5-flash': 15,
  'gemini-3.1-flash-lite': 15,
  'gemini-flash-latest': 15
};

export const MODEL_IDS = Object.keys(modelLimits);

const usageStats = {};

export function getModelUsage(modelName) {
  const now = Date.now();
  if (!usageStats[modelName] || now > usageStats[modelName].resetAt) {
    usageStats[modelName] = {
      remaining: modelLimits[modelName] || 15,
      max: modelLimits[modelName] || 15,
      resetAt: now + 60000,
      lockedUntil: null
    };
  }
  if (usageStats[modelName].lockedUntil && now > usageStats[modelName].lockedUntil) {
    usageStats[modelName].lockedUntil = null;
    usageStats[modelName].remaining = modelLimits[modelName] || 15;
    usageStats[modelName].resetAt = now + 60000;
  }
  return usageStats[modelName];
}

const systemInstruction = `คุณคือ Senior UX/UI Designer และ Product Owner ของระบบ eSignature หน้าที่ของคุณคือรับ Requirement ใหม่ และออกแบบ User Flow แบบเข้าใจง่าย

ข้อมูลระบบปัจจุบันที่มีอยู่ (ใช้เพื่ออ้างอิงและประเมินความเป็นไปได้ ไม่ต้องแสดงในผลลัพธ์โดยตรง):
// API: /eSignature/save, /search, /getByTracking, /download, /void, /delete, /sharing/owner/esignature/get
// Status: ALL, DRAFT, INPROCESS, VOID, SUCCESS, REVISING, RETURNED, REJECTED
// StatusRecipient: PENDING, INPROCESS, COMPLETE, RETURNED, REJECTED, VOID
// Roles: ESIG_CREATE, ESIG_VIEWER, ESIG_ACCESS, ADMIN

กฎ:
1. เขียนอธิบายด้วยภาษาที่เข้าใจง่าย (Non-tech friendly) ให้ทาง PO (Product Owner), BA (Business Analyst) และ Designer อ่านแล้วเห็นภาพ โดยลดการใช้ภาษา Technical / แงะ API / ชื่อ DTO ลงให้เหลือน้อยที่สุด
2. แปลงเรื่องระบบหลังบ้านให้เป็นภาษาผู้ใช้งาน เช่น แทนที่จะพูดว่า "Call /search API พร้อม status=SUCCESS" ให้พูดว่า "โหลดรายการเอกสารที่เสร็จสมบูรณ์แล้ว"
3. UI ให้คิดตาม Ant Design Component (ng-zorro) แต่เรียกชื่อให้เป็นภาษาทำความเข้าใจง่าย เช่น "ตารางข้อมูล" หรือ "ปุ่มหลัก"
4. ใช้ผลลัพธ์เป็นโครงสร้าง Markdown ตามหัวข้อต่อไปนี้เท่านั้น

ตอบเป็น Markdown sections เหล่านี้เท่านั้น:
## 📋 User Flow
อธิบายขั้นตอนการทำงานทีละขั้นแบบ Journey ตั้งแต่ต้นจนจบแบบเข้าใจง่าย ไม่ต้องใส่ Endpoint ถ้ายากไป

## 🗺️ Flow Diagram
สรุป User Flow ด้านบนเป็นขั้นตอนสั้นๆ แบบ Numbered List เท่านั้น สำหรับนำไปวาดเป็นแผนภาพ (ห้ามมีข้อความอื่นนอกจาก List):
- แต่ละบรรทัดขึ้นต้นด้วยเลขลำดับ "1. " "2. " ต่อเนื่องกันตามลำดับเวลาจริง
- แต่ละขั้นตอนสั้นกระชับ ไม่เกิน 8 คำ ใช้ภาษาคน ไม่ใช่ศัพท์เทคนิค (เช่น "ผู้ใช้เปิดหน้าแดชบอร์ด" ไม่ใช่ "Call /search API")
- ห้ามใส่ข้อความ bold, คำอธิบายเพิ่มเติม, หรือบรรทัดว่างคั่นระหว่างขั้นตอน
- มีอย่างน้อย 3 ขั้นตอน และไม่เกิน 10 ขั้นตอน

## 🔍 Flow Analysis
เหตุผลในการออกแบบ การแก้ปัญหา Pain point และประสบการณ์ใช้งานที่ดีขึ้น

## ⚖️ Pros & Cons
ข้อดี และจุดที่ต้องระวัง (บอกด้วยภาษาธุรกิจ เช่น อาจจะเพิ่มขั้นตอนให้ผู้ใช้นิดนึง แต่ได้ความปลอดภัย)

## ⚠️ Technical Alert
เตือนทีม Dev สั้นๆ (ส่วนนี้เท่านั้นที่จะใช้ศัพท์เทคนิคได้บ้าง เช่น การแจ้งเตือนเมื่อไม่มีสิทธิ์ หรือต้องเตรียมรับรองข้อมูลแบบไหนใหม่)

## 🎨 UI Components
แนะนำส่วนประกอบหน้าจอตาม Ant Design (ng-zorro) แบบเข้าใจง่าย (เช่น Modal สำหรับยืนยัน, แจ้งเตือนแบบ Toast)

ตอบภาษาไทยเป็นหลัก เขียนให้อ่านแล้วรู้สึกโปรเฟสชันนอล เป็นมิตรครับ`;

// Streams the Gemini response, writing SSE-style JSON lines via `res.write`.
// Shared by the local Express server (server.mjs) and the Vercel serverless
// function (api/design.js) so behavior never drifts between the two hosts.
export async function handleDesignRequest(req, res) {
  let usedModel;
  try {
    const { messages, model } = req.body;
    const selectedModel = model || 'gemini-3.6-flash';
    usedModel = selectedModel;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Missing or invalid messages' });
    }

    const usage = getModelUsage(selectedModel);
    if (usage.lockedUntil && Date.now() < usage.lockedUntil) {
      const waitTime = Math.ceil((usage.lockedUntil - Date.now()) / 1000);
      return res.status(429).json({ error: `Model is locked. Please try again in ${waitTime} seconds.` });
    }

    const finalApiKey = process.env.GEMINI_API_KEY;

    if (!finalApiKey) {
      return res.status(400).json({
        error: 'ระบบยังไม่พบระบบ API Key กรุณาตั้งค่า API Key ผ่านเมนู Settings ของแอปเพื่อให้สามารถใช้งานร่วมกันได้'
      });
    }

    const ai = new GoogleGenAI({ apiKey: finalApiKey });

    const geminiMessages = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    try {
      let response;

      let fallbackModels = [
        'gemini-3.6-flash',
        'gemini-3.5-flash',
        'gemini-3.1-flash-lite',
        'gemini-flash-latest',
        'gemini-2.5-flash'
      ];
      const modelsToTry = Array.from(new Set([selectedModel, ...fallbackModels]));
      let lastError;

      let hasStreamed = false;

      for (const modelToTry of modelsToTry) {
        if (hasStreamed) break; // Cannot retry if streaming has already started

        let retries = 1;
        while (retries >= 0) {
          try {
            usedModel = modelToTry;
            // Use streaming to prevent proxy timeouts
            const stream = await ai.models.generateContentStream({
              model: modelToTry,
              contents: geminiMessages,
              config: {
                systemInstruction
              }
            });

            for await (const chunk of stream) {
              if (!hasStreamed) {
                // First chunk arrived, set headers and mark as streaming
                res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                hasStreamed = true;
              }

              let text = '';
              try {
                text = chunk.text;
              } catch (e) {
                // chunk.text can throw if blocked by safety
                res.write(JSON.stringify({ error: 'Safety Blocked: ' + String(e.message || e) }) + '\n');
                continue;
              }

              if (text) {
                res.write(JSON.stringify({ chunk: text }) + '\n');
              } else {
                const candidate = chunk.candidates?.[0];
                const finishReason = candidate?.finishReason;
                if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
                  res.write(JSON.stringify({ error: 'Safety Blocked or Incomplete: ' + finishReason }) + '\n');
                }
              }
            }
            if (hasStreamed) {
              res.write(JSON.stringify({ done: true }) + '\n');
              res.end();

              const actualUsage = getModelUsage(usedModel);
              if (actualUsage.remaining > 0) actualUsage.remaining--;
              return; // We handled the response completely
            } else {
              // Stream completed with 0 chunks
              throw new Error('Streaming failed: Model returned an empty response.');
            }
          } catch (err) {
            lastError = err;
            const errStr = String(err.message || err);
            console.warn(`Attempt failed for model ${modelToTry}. Retries left: ${retries}. Error: ${errStr}`);

            if (hasStreamed) {
              // Cannot retry seamlessly if we already streamed data
              res.write(JSON.stringify({ error: "Streaming interrupted: " + errStr }) + '\n');
              res.end();
              return;
            }

            // If it is a quota or rate limit exhaustion, do not retry this model. Let it break and fallback to next model immediately.
            const isQuotaExceeded = errStr.includes('quota') || errStr.toUpperCase().includes('RESOURCE_EXHAUSTED') || errStr.includes('Quota exceeded') || errStr.includes('429');
            if (isQuotaExceeded) {
              console.warn(`Quota exceeded for ${modelToTry}. Skipping retries & falling back to next available model.`);
              break;
            }

            if (retries > 0 && (errStr.includes('503') || errStr.toLowerCase().includes('unavailable'))) {
              const waitMs = (2 - retries) * 1000;
              await new Promise(resolve => setTimeout(resolve, waitMs));
              retries--;
              continue;
            }
            break;
          }
        }
      }

      if (!hasStreamed) {
        return res.status(500).json({ error: lastError?.message || lastError || 'ทุกโมเดลที่กำหนดล้มเหลวในการเชื่อมต่อ (อาจเกิดจากมีผู้ใช้งานหนาแน่น)' });
      }
    } catch (apiError) {
      const msg = apiError.message || String(apiError);
      const targetModel = usedModel || selectedModel;

      if (!usageStats[targetModel]) {
        getModelUsage(targetModel); // ensure initialized
      }

      if (msg.includes('429') && msg.includes('retry in')) {
        const match = msg.match(/retry in ([\d\.]+)s/);
        if (match && match[1]) {
          const delaySec = parseFloat(match[1]);
          usageStats[targetModel].lockedUntil = Date.now() + (delaySec * 1000);
          usageStats[targetModel].remaining = 0;
        }
      } else if (msg.includes('429') || msg.includes('503')) {
        usageStats[targetModel].lockedUntil = Date.now() + 30000;
        usageStats[targetModel].remaining = 0;
      }
      console.error('Final API Error:', apiError);
      if (!res.headersSent) {
        res.status(500).json({ error: msg || 'เกิดข้อผิดพลาดกับเซิร์ฟเวอร์ (API Error)' });
      }
    }
  } catch (error) {
    console.error('API Outer Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Unknown API Error' });
    }
  }
}
