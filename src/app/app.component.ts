import { Component, ChangeDetectionStrategy, signal, inject, ViewChild, ElementRef, AfterViewChecked, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';

import { NzLayoutModule } from 'ng-zorro-antd/layout';
import { NzMenuModule } from 'ng-zorro-antd/menu';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzAvatarModule } from 'ng-zorro-antd/avatar';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { NzDividerModule } from 'ng-zorro-antd/divider';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzDrawerModule } from 'ng-zorro-antd/drawer';
import { LucideAngularModule } from 'lucide-angular';

import { UxFlowService } from './services/ux-flow.service';
import { UxFlowPrompt } from './mock-data/ux-flow.mock';

interface FlowSection {
  title: string | null;
  label: string;
  icon: string;
  cls: string;
  body?: SafeHtml;
  diagramSteps?: string[];
}

interface Message {
  role: 'user' | 'assistant';
  content?: string;
  rawContent?: string;
  sections?: FlowSection[];
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    NzLayoutModule,
    NzMenuModule,
    NzInputModule,
    NzButtonModule,
    NzIconModule,
    NzAvatarModule,
    NzModalModule,
    NzSelectModule,
    NzToolTipModule,
    NzDividerModule,
    NzTagModule,
    NzDrawerModule,
    LucideAngularModule
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent implements AfterViewChecked, OnInit, OnDestroy {
  @ViewChild('chatWrap') private chatWrap!: ElementRef;

  private http = inject(HttpClient);
  private msg = inject(NzMessageService);
  private sanitizer = inject(DomSanitizer);
  private uxFlowService = inject(UxFlowService);

  isSettingsVisible = signal(false);
  isAnalyzing = signal(false);
  isCollapsed = signal(false);
  isDarkMode = signal(false);
  messageInputControl = new FormControl('');
  messages = signal<Message[]>([]);
  
  langPrefControl = new FormControl('th');
  modelPrefControl = new FormControl('gemini-3.5-flash');
  availableModels = signal<any[]>([
    { model: 'gemini-3.5-flash', remaining: 15, max: 15, resetAt: Date.now() + 60000, lockedUntil: null },
    { model: 'gemini-2.5-flash', remaining: 15, max: 15, resetAt: Date.now() + 60000, lockedUntil: null },
    { model: 'gemini-3.1-flash-lite', remaining: 15, max: 15, resetAt: Date.now() + 60000, lockedUntil: null },
    { model: 'gemini-flash-latest', remaining: 15, max: 15, resetAt: Date.now() + 60000, lockedUntil: null }
  ]);
  now = signal(Date.now());
  private intervalId: any;

  prompts = signal<UxFlowPrompt[]>([]);
  infoTexts = signal<Record<string, { title: string, text: string }>>({});
  
  isDrawerVisible = signal(false);
  drawerTitle = signal('');
  drawerContent = signal<SafeHtml|null>(null);

  ngOnInit() {
    this.uxFlowService.getPrompts().subscribe(data => this.prompts.set(data));
    this.uxFlowService.getInfoTexts().subscribe(data => this.infoTexts.set(data));
    this.intervalId = setInterval(() => {
      this.now.set(Date.now());
    }, 1000);

    const savedTheme = localStorage.getItem('theme');
    const preferDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const root = document.documentElement;
    if (savedTheme === 'dark' || (!savedTheme && preferDark)) {
      this.isDarkMode.set(true);
      document.body.classList.add('dark-theme');
      root.classList.add('dark-theme');
    } else {
      this.isDarkMode.set(false);
      document.body.classList.remove('dark-theme');
      root.classList.remove('dark-theme');
    }
  }

  toggleTheme() {
    const nextMode = !this.isDarkMode();
    this.isDarkMode.set(nextMode);
    const root = document.documentElement;
    if (nextMode) {
      document.body.classList.add('dark-theme');
      root.classList.add('dark-theme');
      localStorage.setItem('theme', 'dark');
    } else {
      document.body.classList.remove('dark-theme');
      root.classList.remove('dark-theme');
      localStorage.setItem('theme', 'light');
    }
  }

  ngOnDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  ngAfterViewChecked() {
    this.scrollToBottom();
  }

  scrollToBottom(): void {
    try {
      if (this.chatWrap) {
        this.chatWrap.nativeElement.scrollTop = this.chatWrap.nativeElement.scrollHeight;
      }
    } catch(err) { }
  }

  usePrompt(prompt: string) {
    this.messageInputControl.setValue(prompt);
  }

  showInfo(type: string) {
    const info = this.infoTexts()[type];
    if (info) {
      this.drawerTitle.set(info.title);
      const meta = { numCls: "step-num-default", dotCls: "bullet-dot-default" };
      this.drawerContent.set(this.sanitizer.bypassSecurityTrustHtml(this.renderBody(info.text, meta)));
      this.isDrawerVisible.set(true);
    }
  }

  closeDrawer() {
    this.isDrawerVisible.set(false);
  }

  newChat() {
    this.messages.set([]);
  }

  copyLast() {
    const msgs = this.messages();
    const lastAssistant = [...msgs].reverse().find(m => m.role === 'assistant');
    if (lastAssistant && lastAssistant.rawContent) {
      navigator.clipboard.writeText(lastAssistant.rawContent).then(() => {
        this.msg.success('คัดลอกผลลัพธ์เรียบร้อย');
      });
    } else {
      this.msg.warning('ยังไม่มีผลลัพธ์ให้คัดลอก');
    }
  }

  openSettings() {
    this.loadUsage();
    this.isSettingsVisible.set(true);
  }

  closeSettings() {
    this.isSettingsVisible.set(false);
  }

  saveSettings() {
    this.closeSettings();
    this.msg.success('บันทึกการตั้งค่าเรียบร้อย');
  }

  loadUsage() {
    this.http.get<any[]>('/api/models/usage').subscribe({
      next: (data) => this.availableModels.set(data),
      error: () => {
        this.availableModels.set([
          { model: 'gemini-3.5-flash', remaining: 15, max: 15, resetAt: Date.now() + 60000, lockedUntil: null },
          { model: 'gemini-2.5-flash', remaining: 15, max: 15, resetAt: Date.now() + 60000, lockedUntil: null },
          { model: 'gemini-3.1-flash-lite', remaining: 15, max: 15, resetAt: Date.now() + 60000, lockedUntil: null },
          { model: 'gemini-flash-latest', remaining: 15, max: 15, resetAt: Date.now() + 60000, lockedUntil: null }
        ]);
        this.msg.info('เชื่อมต่อระบบสล๊อตโควต้าของเซิร์ฟเวอร์ไม่ได้ ระบบได้สลับมาใช้ค่าจำลองเพื่อไม่ให้งานขัดข้องเรียบร้อยครับ');
      }
    });
  }

  getSeconds(targetTimestamp: number) {
    const s = Math.ceil((targetTimestamp - this.now()) / 1000);
    return s > 0 ? s : 0;
  }

  handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  async sendMessage() {
    const text = this.messageInputControl.value?.trim();
    if (!text || this.isAnalyzing()) return;

    this.messages.update(m => [...m, { role: 'user', content: text, rawContent: text }]);
    this.messageInputControl.setValue('');
    this.isAnalyzing.set(true);

    try {
      const payload = {
        messages: this.messages().map(m => ({ role: m.role, content: m.rawContent })),
        model: this.modelPrefControl.value || 'gemini-3.5-flash'
      };

      // Add a placeholder message for the assistant stream
      this.messages.update(m => [...m, { role: 'assistant', rawContent: '', sections: [] }]);

      const response = await fetch('/api/design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
         let errorText = await response.text();
         try {
           const parsed = JSON.parse(errorText);
           if (parsed.error) {
              
              if (typeof parsed.error === 'string') {
                 errorText = parsed.error;
              } else if (parsed.error.message) {
                 errorText = parsed.error.message;
              } else {
                 errorText = JSON.stringify(parsed.error);
              }
           }
         } catch(e) {}
         
         if (errorText.includes('Service Unavailable') || errorText.includes('503')) {
            errorText = 'เซิร์ฟเวอร์หลักของโมเดลทำงานหนักเกินไป (System Overloaded) กรุณารอสักครู่แล้วลองอีกครั้ง';
         }
         
         throw new Error(errorText);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder("utf-8");
      let fullText = "";
      let buffer = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n');
          // The last part might be incomplete, leave it in the buffer
          buffer = parts.pop() || "";

          for (let line of parts) {
             if (!line.trim()) continue;
             try {
               const parsed = JSON.parse(line);
               if (parsed.error) {
                 throw new Error(parsed.error);
               }
               if (parsed.chunk) {
                 fullText += parsed.chunk;
                 const sections = this.parseSections(fullText);
                 // Update the last message
                 this.messages.update(msgs => {
                   const newMsgs = [...msgs];
                   newMsgs[newMsgs.length - 1] = { role: 'assistant', rawContent: fullText, sections };
                   return newMsgs;
                 });
                 // Force scroll down as content comes in
                 setTimeout(() => this.scrollToBottom(), 50);
               }
             } catch(err: any) {
               // Ignore JSON parse errors for incomplete/corrupted lines, 
               // but DO NOT throw away valid Error objects from parsed.error
               if (err.message && !err.message.includes("Unexpected token") && !err.message.includes("Unexpected end of JSON input")) {
                 throw err;
               }
             }
          }
        }
        
        // Handle any remaining buffer
        if (buffer.trim()) {
           try {
             const parsed = JSON.parse(buffer);
             if (parsed.error) throw new Error(parsed.error);
             if (parsed.chunk) {
                fullText += parsed.chunk;
                const sections = this.parseSections(fullText);
                this.messages.update(msgs => {
                   const newMsgs = [...msgs];
                   newMsgs[newMsgs.length - 1] = { role: 'assistant', rawContent: fullText, sections };
                   return newMsgs;
                });
             }
           } catch (e) {
             // Ignore final chunk parse error
           }
        }
        
        if (!fullText.trim()) {
           throw new Error("เซิร์ฟเวอร์ตอบกลับสำเร็จ แต่ไม่มีข้อมูลข้อความ (อาจถูกบล็อกด้วย Safety Filter หรือรูปแบบคำถามไม่ถูกต้อง)");
        }
      }
    } catch (e: any) {
      console.error(e);
      let errorMsg = e.message || 'ข้อผิดพลาดจากเซิร์ฟเวอร์';
      
      const errObjStr = String(e.error?.error || '');
      if (typeof e.error === 'string') {
         errorMsg = e.error;
      } else if (e.error?.message) {
         errorMsg = e.error.message;
      }
      
      // Attempt to parse stringified JSON in errorMsg (Google GenAI error format)
      try {
         const parsedErrorMsg = JSON.parse(errorMsg);
         if (parsedErrorMsg.error && parsedErrorMsg.error.message) {
            errorMsg = parsedErrorMsg.error.message;
         }
      } catch(parseErr) {}

      // Translate common backend errors to friendly Thai messages
      if (errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('Too Many Requests') || errorMsg.includes('RESOURCE_EXHAUSTED')) {
         errorMsg = 'โควต้าการใช้งานเต็ม หรือมีผู้ใช้งานพร้อมกันมากเกินไป (Rate Limit Exceeded) กรุณารอสักครู่แล้วลองอีกครั้ง';
      } else if (errorMsg.includes('503') || errorMsg.includes('Service Unavailable') || errorMsg.includes('Overloaded')) {
         errorMsg = 'เซิร์ฟเวอร์หลักของ AI ทำงานหนักเกินไป (System Overloaded) กรุณารอสักครู่แล้วลองอีกครั้ง';
      } else if (errorMsg.includes('404') || errorMsg.includes('not found')) {
         errorMsg = 'ไม่พบโมเดลที่เลือกระบบจะพยายามใช้โมเดลสำรอง';
      }

      this.msg.error('เกิดข้อผิดพลาด: ' + errorMsg, { nzDuration: 6000 });
      
      // Remove the placeholder assistant message if it's empty so it doesn't corrupt history
      this.messages.update(msgs => {
         const last = msgs[msgs.length - 1];
         if (last && last.role === 'assistant' && (!last.rawContent || !last.rawContent.trim())) {
            return msgs.slice(0, -1);
         }
         return msgs;
      });
    } finally {
      this.isAnalyzing.set(false);
    }
  }

  private static readonly SECTION_MAP: Record<string, {cls: string, numCls: string, dotCls: string, icon: string, label: string}> = {
    "📋 User Flow":       { cls: "section-flow",     numCls: "step-num-flow",     dotCls: "bullet-dot-flow",     icon: "file-text",     label: "User Flow" },
    "🗺️ Flow Diagram":   { cls: "section-diagram",   numCls: "step-num-diagram",  dotCls: "bullet-dot-diagram",  icon: "map",            label: "Flow Diagram" },
    "🔍 Flow Analysis":   { cls: "section-analysis",  numCls: "step-num-analysis", dotCls: "bullet-dot-analysis", icon: "lightbulb",      label: "Flow Analysis" },
    "⚖️ Pros & Cons":    { cls: "section-pros",      numCls: "step-num-pros",     dotCls: "bullet-dot-pros",     icon: "scale",          label: "Pros & Cons" },
    "⚠️ Technical Alert": { cls: "section-alert",     numCls: "step-num-alert",    dotCls: "bullet-dot-alert",    icon: "triangle-alert", label: "Technical Alert" },
    "🎨 UI Components":   { cls: "section-ui",        numCls: "step-num-ui",       dotCls: "bullet-dot-ui",       icon: "palette",        label: "UI Components" },
  };

  parseSections(text: string): FlowSection[] {
    const raw: { title: string | null, lines: string[] }[] = [];
    let cur: { title: string | null, lines: string[] } | null = null;

    for (const line of text.split("\n")) {
      const m = line.match(/^## (.+)$/);
      if (m) {
        if (cur) raw.push(cur);
        cur = { title: m[1].trim(), lines: [] };
      }
      else if (cur) cur.lines.push(line);
      else {
        if (!raw.length) raw.push({ title: null, lines: [line] });
        else raw[0].lines.push(line);
      }
    }
    if (cur) raw.push(cur);

    return raw
      .map((s): FlowSection | null => {
        const content = s.lines.join("\n").trim();
        if (!content && !s.title) return null;

        const meta = s.title && AppComponent.SECTION_MAP[s.title]
          ? AppComponent.SECTION_MAP[s.title]
          : { cls: "section-default", numCls: "step-num-default", dotCls: "bullet-dot-default", icon: "file", label: s.title || "" };

        if (s.title === "🗺️ Flow Diagram") {
          const diagramSteps = content
            .split("\n")
            .map(line => line.match(/^(\d+)\.\s+(.+)$/))
            .filter((m): m is RegExpMatchArray => !!m)
            .map(m => m[2].trim());
          return { title: s.title, label: meta.label, icon: meta.icon, cls: meta.cls, diagramSteps };
        }

        return {
          title: s.title,
          label: meta.label,
          icon: meta.icon,
          cls: meta.cls,
          body: this.sanitizer.bypassSecurityTrustHtml(this.renderBody(content, meta))
        };
      })
      .filter((s): s is FlowSection => s !== null);
  }

  renderBody(content: string, meta: any): string {
    const numCls = meta ? meta.numCls : "step-num-default";
    const dotCls = meta ? meta.dotCls : "bullet-dot-default";
    
    return content.split("\n").map(line => {
      const sm = line.match(/^(\d+)\.\s+(.+)$/);
      if (sm) return `<div class="step-row"><span class="step-num ${numCls}">${sm[1]}</span><span class="step-text">${this.fmt(sm[2])}</span></div>`;
      const bm = line.match(/^[-•]\s+(.+)$/);
      if (bm) return `<div class="bullet-row"><span class="bullet-dot ${dotCls}"></span><span style="color:var(--gray-10);flex:1">${this.fmt(bm[1])}</span></div>`;
      if (line.trim()) return `<p style="margin:0 0 5px">${this.fmt(line)}</p>`;
      return `<div style="height:4px"></div>`;
    }).join("");
  }

  fmt(s: string): string {
    return this.esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  }

  esc(s: string): string { 
    return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); 
  }
}

