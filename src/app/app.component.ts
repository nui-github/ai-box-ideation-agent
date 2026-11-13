import { Component, ChangeDetectionStrategy, signal, computed, inject, ViewChild, ElementRef, AfterViewChecked, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom, startWith } from 'rxjs';
import mermaid from 'mermaid';
import { mermaidConfig, applyFlowTheme } from './mermaid-theme';
import { flowJsonToSvg } from './flow-diagram';

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
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import { LucideAngularModule } from 'lucide-angular';

import { UxFlowService } from './services/ux-flow.service';
import { UxFlowPrompt } from './mock-data/ux-flow.mock';

interface FlowSection {
  title: string | null;
  label: string;
  icon: string;
  cls: string;
  body?: SafeHtml;
  /** Source of the diagram: a `flow` JSON spec (preferred) or legacy `mermaid` code. */
  diagramCode?: string;
  /** Natural pixel size of the rendered SVG, so the zoom modal can size its scroll area to the scaled diagram. */
  diagramSize?: { w: number; h: number } | null;
  diagramKind?: 'flow' | 'mermaid';
}

/** A saved conversation. Only the raw text is stored; the section cards are rebuilt on load. */
interface ChatSession {
  id: string;
  title: string;
  updatedAt: number;
  messages: { role: 'user' | 'assistant'; rawContent: string }[];
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
    NzTabsModule,
    LucideAngularModule
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent implements AfterViewChecked, OnInit, OnDestroy {
  @ViewChild('chatWrap') private chatWrap!: ElementRef;
  @ViewChild('diagramCanvas') private diagramCanvas?: ElementRef<HTMLElement>;
  @ViewChild('diagramStage') private diagramStage?: ElementRef<HTMLElement>;
  @ViewChild('logicFileInput') private logicFileInput?: ElementRef<HTMLInputElement>;

  private http = inject(HttpClient);
  private msg = inject(NzMessageService);
  private sanitizer = inject(DomSanitizer);
  private uxFlowService = inject(UxFlowService);
  private diagramCache = new Map<string, { html: SafeHtml; size: { w: number; h: number } | null }>();
  private mermaidIdCounter = 0;

  isSettingsVisible = signal(false);
  isAnalyzing = signal(false);
  /** The answer being exported; rendered as a print-only copy of the page. */
  printData = signal<{ question: string; date: string; sections: FlowSection[] } | null>(null);
  isCollapsed = signal(false);
  isDarkMode = signal(false);
  messageInputControl = new FormControl('');
  messages = signal<Message[]>([]);
  chatHistory = signal<ChatSession[]>([]);
  activeChatId = signal<string | null>(null);
  private static readonly HISTORY_KEY = 'chat-history-v1';
  private static readonly MAX_SAVED_CHATS = 30;
  
  langPrefControl = new FormControl('th');
  modelPrefControl = new FormControl('gemini-3.6-flash');
  availableModels = signal<any[]>([
    { model: 'gemini-3.6-flash', remaining: 15, max: 15, resetAt: Date.now() + 60000, lockedUntil: null },
    { model: 'gemini-3.5-flash', remaining: 15, max: 15, resetAt: Date.now() + 60000, lockedUntil: null },
    { model: 'gemini-2.5-flash', remaining: 15, max: 15, resetAt: Date.now() + 60000, lockedUntil: null },
    { model: 'gemini-3.1-flash-lite', remaining: 15, max: 15, resetAt: Date.now() + 60000, lockedUntil: null },
    { model: 'groq-llama-3.3-70b', remaining: 60, max: 60, resetAt: Date.now() + 60000, lockedUntil: null },
    { model: 'deepseek-r1', remaining: 60, max: 60, resetAt: Date.now() + 60000, lockedUntil: null }
  ]);
  now = signal(Date.now());
  private intervalId: any;

  prompts = signal<UxFlowPrompt[]>([]);
  infoTexts = signal<Record<string, { title: string, text: string }>>({});
  
  isDrawerVisible = signal(false);
  drawerTitle = signal('');
  drawerContent = signal<SafeHtml|null>(null);

  instructionControl = new FormControl('', { nonNullable: true });
  private modelValue = toSignal(this.modelPrefControl.valueChanges.pipe(startWith(this.modelPrefControl.value)));
  private langValue = toSignal(this.langPrefControl.valueChanges.pipe(startWith(this.langPrefControl.value)));
  private instructionValue = toSignal(this.instructionControl.valueChanges.pipe(startWith(this.instructionControl.value)), { initialValue: '' });
  /** Values the drawer opened with; Save is enabled only when the form differs from them. */
  private settingsSnapshot = signal<{ model: string | null, lang: string | null }>({ model: null, lang: null });
  isSettingsDirty = computed(() =>
    this.modelValue() !== this.settingsSnapshot().model ||
    this.langValue() !== this.settingsSnapshot().lang ||
    this.instructionValue().trim() !== this.savedInstruction().trim()
  );
  defaultInstruction = signal('');
  savedInstruction = signal('');
  isSavingSettings = signal(false);
  readonly maxInstructionLength = 20000;
  businessLogicEntries = signal<{ id: string, title: string, content: string }[]>([]);
  isAddingLogic = signal(false);
  reuploadTargetId = signal<string | null>(null);

  isDiagramModalVisible = signal(false);
  isPanning = signal(false);
  private pan: { x: number; y: number; left: number; top: number; id: number } | null = null;
  private zoomAnimTimer: any;
  diagramModalSvg = signal<SafeHtml | null>(null);
  diagramModalTitle = signal('Flow Diagram');
  diagramNatural = signal<{ w: number; h: number } | null>(null);
  diagramZoom = signal(1);

  ngOnInit() {
    this.restorePreferences();
    this.chatHistory.set(this.readHistory());
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

    mermaid.initialize(mermaidConfig(this.isDarkMode()));
  }

  /** Restores the model and output language chosen in Settings (saved per browser). */
  private restorePreferences() {
    try {
      const model = localStorage.getItem('pref-model');
      if (model && this.availableModels().some(m => m.model === model)) {
        this.modelPrefControl.setValue(model);
      }
      const lang = localStorage.getItem('pref-lang');
      if (lang === 'th' || lang === 'en') {
        this.langPrefControl.setValue(lang);
      }
    } catch {
      // storage unavailable: keep defaults
    }
  }

  private persistPreferences() {
    try {
      localStorage.setItem('pref-model', this.modelPrefControl.value || 'gemini-3.6-flash');
      localStorage.setItem('pref-lang', this.langPrefControl.value || 'th');
    } catch {
      // storage unavailable: preferences last for this session only
    }
  }

  /**
   * Exports one answer (text sections + flow diagram) as a PDF through the browser's print dialog
   * ("Save as PDF"), which keeps text selectable and the diagram as vector. The page is swapped for a
   * print-only copy rendered in the light theme, whatever theme is on screen.
   */
  async exportPdf(index: number) {
    const msgs = this.messages();
    const msg = msgs[index];
    if (!msg?.sections?.length) return;

    const question = [...msgs.slice(0, index)].reverse().find(m => m.role === 'user')?.content ?? '';
    const sections = msg.sections.map(s => {
      if (s.diagramCode && s.diagramKind === 'flow') {
        try {
          return { ...s, body: this.sanitizer.bypassSecurityTrustHtml(flowJsonToSvg(s.diagramCode, false)) };
        } catch {
          return s;
        }
      }
      return s;
    });

    const root = document.documentElement;
    const wasDark = root.classList.contains('dark-theme');
    const originalTitle = document.title;

    this.printData.set({
      question,
      date: new Date().toLocaleString('th-TH', { dateStyle: 'long', timeStyle: 'short' }),
      sections
    });
    root.classList.remove('dark-theme');
    document.body.classList.remove('dark-theme');
    // Browsers suggest the document title as the PDF file name
    document.title = (question.trim().replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60) || 'PO-analysis').trim();

    const restore = () => {
      window.removeEventListener('afterprint', restore);
      document.title = originalTitle;
      if (wasDark) {
        root.classList.add('dark-theme');
        document.body.classList.add('dark-theme');
      }
      this.printData.set(null);
    };
    window.addEventListener('afterprint', restore);

    // Let Angular render the print copy before the browser snapshots the page
    // (timeout fallback: animation frames pause while the tab is in the background)
    await new Promise<void>(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      setTimeout(resolve, 150);
    });
    window.print();
  }

  async toggleTheme() {
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

    // Re-render any diagrams already on screen so they pick up the new mermaid theme
    mermaid.initialize(mermaidConfig(nextMode));
    this.diagramCache.clear();
    for (const message of this.messages()) {
      if (message.sections?.some(s => s.diagramCode)) {
        await this.hydrateMermaidSections(message.sections);
      }
    }
    this.messages.update(msgs => [...msgs]);
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

  /** Opens a curated example flow (src/assets/flows/<slug>[-dark].svg) in the zoomable diagram viewer. */
  openFlowExample(prompt: UxFlowPrompt) {
    if (!prompt.flow) return;
    return this.openCuratedDiagram(prompt.flow, `${prompt.text} · Flow ตัวอย่าง`);
  }

  /** System Reference topics (api | dto | roles) each have a curated overview diagram (ref-<key>.svg). */
  openReferenceDiagram(key: string) {
    const title = this.infoTexts()[key]?.title ?? 'System Reference';
    return this.openCuratedDiagram(`ref-${key}`, `${title} · แผนภาพ`);
  }

  private async openCuratedDiagram(slug: string, title: string) {
    const file = `assets/flows/${slug}${this.isDarkMode() ? '-dark' : ''}.svg`;
    try {
      const svg = await firstValueFrom(this.http.get(file, { responseType: 'text' }));
      const sized = this.sizeSvgFromViewBox(svg);
      this.openDiagramModal(this.sanitizer.bypassSecurityTrustHtml(sized), this.parseSvgSize(sized), title);
    } catch {
      this.msg.error('โหลดแผนภาพไม่สำเร็จ');
    }
  }

  openDiagramModal(svg: SafeHtml | undefined, size: { w: number; h: number } | null = null, title = 'Flow Diagram') {
    if (!svg) return;
    this.diagramModalTitle.set(title);
    this.diagramNatural.set(size);
    this.diagramModalSvg.set(svg);
    this.diagramZoom.set(1);
    this.isDiagramModalVisible.set(true);
  }

  closeDiagramModal() {
    this.isDiagramModalVisible.set(false);
  }

  /** Click-and-drag on the diagram canvas pans it (mouse/pen; touch keeps native scrolling). */
  onPanStart(e: PointerEvent) {
    const canvas = this.diagramCanvas?.nativeElement;
    if (!canvas || e.button !== 0 || e.pointerType === 'touch') return;
    // Ignore presses on the scrollbars so they keep working normally.
    const rect = canvas.getBoundingClientRect();
    if (e.clientX - rect.left > canvas.clientWidth || e.clientY - rect.top > canvas.clientHeight) return;
    this.pan = { x: e.clientX, y: e.clientY, left: canvas.scrollLeft, top: canvas.scrollTop, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
    this.isPanning.set(true);
  }

  onPanMove(e: PointerEvent) {
    const canvas = this.diagramCanvas?.nativeElement;
    if (!canvas || !this.pan || e.pointerId !== this.pan.id) return;
    canvas.scrollLeft = this.pan.left - (e.clientX - this.pan.x);
    canvas.scrollTop = this.pan.top - (e.clientY - this.pan.y);
  }

  onPanEnd(e: PointerEvent) {
    if (!this.pan || e.pointerId !== this.pan.id) return;
    this.diagramCanvas?.nativeElement.releasePointerCapture?.(e.pointerId);
    this.pan = null;
    this.isPanning.set(false);
  }

  /** Scroll wheel / trackpad pinch zooms the diagram, keeping the point under the cursor fixed. */
  onDiagramWheel(e: WheelEvent) {
    const canvas = this.diagramCanvas?.nativeElement;
    const stage = this.diagramStage?.nativeElement;
    if (!canvas || !stage) return;
    e.preventDefault();

    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const old = this.diagramZoom();
    const next = Math.min(2.5, Math.max(0.25, +(old * Math.exp(-e.deltaY * unit * 0.0015)).toFixed(3)));
    if (next === old) return;

    // The sizer is the scroll-area footprint of the scaled diagram (it may be centred by auto margins),
    // so anchor on its on-screen position before and after rather than on canvas padding.
    const sizer = stage.parentElement as HTMLElement;
    const before = sizer.getBoundingClientRect();
    const px = (e.clientX - before.left) / old;
    const py = (e.clientY - before.top) / old;

    // Apply immediately and without the button-zoom transition, so the layout is
    // already final when we re-anchor.
    stage.style.transition = 'none';
    sizer.style.transition = 'none';
    stage.style.transform = `scale(${next})`;
    const natural = this.diagramNatural();
    if (natural) {
      sizer.style.width = `${natural.w * next}px`;
      sizer.style.height = `${natural.h * next}px`;
    }
    this.diagramZoom.set(next);
    const after = sizer.getBoundingClientRect();
    canvas.scrollLeft += after.left + px * next - e.clientX;
    canvas.scrollTop += after.top + py * next - e.clientY;
    clearTimeout(this.zoomAnimTimer);
    this.zoomAnimTimer = setTimeout(() => {
      stage.style.transition = '';
      sizer.style.transition = '';
    }, 150);
  }

  zoomIn() {
    this.diagramZoom.update(z => Math.min(2.5, +(z + 0.25).toFixed(2)));
  }

  zoomOut() {
    this.diagramZoom.update(z => Math.max(0.25, +(z - 0.25).toFixed(2)));
  }

  onDiagramModalOpen() {
    this.fitDiagramWidth();
  }

  /** Scales the diagram so its natural (unscaled) width fills the canvas, so a huge flowchart isn't rendered at a cramped 100%. */
  fitDiagramWidth() {
    const canvasEl = this.diagramCanvas?.nativeElement;
    const svgEl = this.diagramStage?.nativeElement.querySelector('svg') as SVGSVGElement | null;
    if (!canvasEl || !svgEl) return;

    // Read the SVG's own coordinate-space width (viewBox), not its rendered box —
    // the rendered box is ambiguous right after the modal opens (width:100% inside
    // an inline-block parent resolves to 0 before the browser's next layout pass).
    const naturalWidth = svgEl.viewBox?.baseVal?.width || svgEl.getBoundingClientRect().width || svgEl.scrollWidth;
    if (!naturalWidth) return;

    const canvasStyle = getComputedStyle(canvasEl);
    const availableWidth = canvasEl.clientWidth - parseFloat(canvasStyle.paddingLeft) - parseFloat(canvasStyle.paddingRight);

    const fitScale = Math.min(2.5, Math.max(0.25, +(availableWidth / naturalWidth).toFixed(2)));
    this.diagramZoom.set(fitScale);
  }

  newChat() {
    this.messages.set([]);
    this.activeChatId.set(null);
  }

  private readHistory(): ChatSession[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(AppComponent.HISTORY_KEY) || '[]');
      return Array.isArray(parsed)
        ? parsed.filter((c: ChatSession) => c && typeof c.id === 'string' && Array.isArray(c.messages))
        : [];
    } catch {
      return [];
    }
  }

  private writeHistory(list: ChatSession[]): ChatSession[] {
    // Saved per browser; if storage is full, drop the oldest chats until it fits
    let toSave = list;
    for (;;) {
      try {
        localStorage.setItem(AppComponent.HISTORY_KEY, JSON.stringify(toSave));
        return toSave;
      } catch {
        if (!toSave.length) return toSave; // storage unavailable altogether
        toSave = toSave.slice(0, -1);
      }
    }
  }

  /** Saves the open conversation to Chat History (only once it has an answer). */
  private saveCurrentChat() {
    const msgs = this.messages().filter(m => m.rawContent?.trim());
    if (!msgs.some(m => m.role === 'assistant')) return;

    const id = this.activeChatId() ?? crypto.randomUUID();
    this.activeChatId.set(id);

    const firstQuestion = msgs.find(m => m.role === 'user')?.rawContent ?? '';
    const title = firstQuestion.replace(/\s+/g, ' ').trim().slice(0, 60) || 'แชทใหม่';

    const session: ChatSession = {
      id,
      title,
      updatedAt: Date.now(),
      messages: msgs.map(m => ({ role: m.role, rawContent: m.rawContent! }))
    };
    const list = [session, ...this.chatHistory().filter(c => c.id !== id)].slice(0, AppComponent.MAX_SAVED_CHATS);
    this.chatHistory.set(this.writeHistory(list));
  }

  /** Reopens a saved conversation so the user can keep chatting in it. */
  async loadChat(id: string) {
    if (this.isAnalyzing()) return;
    const chat = this.chatHistory().find(c => c.id === id);
    if (!chat) return;

    const restored: Message[] = chat.messages.map(m =>
      m.role === 'user'
        ? { role: 'user', content: m.rawContent, rawContent: m.rawContent }
        : { role: 'assistant', rawContent: m.rawContent, sections: this.parseSections(m.rawContent, true) }
    );
    for (const m of restored) {
      if (m.sections) await this.hydrateMermaidSections(m.sections);
    }
    this.messages.set(restored);
    this.activeChatId.set(id);
  }

  deleteChat(id: string, event: Event) {
    event.stopPropagation();
    this.chatHistory.set(this.writeHistory(this.chatHistory().filter(c => c.id !== id)));
    if (this.activeChatId() === id) this.newChat();
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
    this.loadBusinessLogic();
    this.loadInstruction();
    this.settingsSnapshot.set({ model: this.modelPrefControl.value, lang: this.langPrefControl.value });
    this.isSettingsVisible.set(true);
  }

  /** Closes the drawer and drops any unsaved edits. */
  closeSettings() {
    const { model, lang } = this.settingsSnapshot();
    this.modelPrefControl.setValue(model);
    this.langPrefControl.setValue(lang);
    this.isSettingsVisible.set(false);
  }

  async saveSettings() {
    const prompt = this.instructionControl.value.trim();
    if (!prompt) {
      this.msg.warning('Instruction Prompt ต้องไม่ว่าง (กด "คืนค่าเริ่มต้น" ถ้าต้องการใช้ค่าเดิม)');
      return;
    }
    if (prompt.length > this.maxInstructionLength) {
      this.msg.warning(`Instruction Prompt ยาวเกิน ${this.maxInstructionLength} ตัวอักษร`);
      return;
    }

    if (prompt !== this.savedInstruction()) {
      this.isSavingSettings.set(true);
      try {
        const res = await firstValueFrom(this.http.put<{ prompt: string }>('/api/instruction', { prompt }));
        this.savedInstruction.set(res.prompt);
      } catch {
        this.msg.error('บันทึก Instruction Prompt ไม่สำเร็จ');
        return;
      } finally {
        this.isSavingSettings.set(false);
      }
    }

    this.settingsSnapshot.set({ model: this.modelPrefControl.value, lang: this.langPrefControl.value });
    this.persistPreferences();
    this.closeSettings();
    this.msg.success('บันทึกการตั้งค่าเรียบร้อย');
  }

  loadInstruction() {
    this.http.get<{ prompt: string, defaultPrompt: string }>('/api/instruction').subscribe({
      next: (data) => {
        this.defaultInstruction.set(data.defaultPrompt);
        this.savedInstruction.set(data.prompt);
        this.instructionControl.setValue(data.prompt);
      },
      error: () => this.msg.error('โหลด Instruction Prompt ไม่สำเร็จ')
    });
  }

  resetInstruction() {
    this.instructionControl.setValue(this.defaultInstruction());
  }

  loadBusinessLogic() {
    this.http.get<{ id: string, title: string, content: string }[]>('/api/business-logic').subscribe({
      next: (data) => this.businessLogicEntries.set(data),
      error: () => this.msg.error('โหลดข้อมูล Business Logic ไม่สำเร็จ')
    });
  }

  triggerLogicFileUpload() {
    this.reuploadTargetId.set(null);
    this.logicFileInput?.nativeElement.click();
  }

  triggerLogicReupload(id: string) {
    this.reuploadTargetId.set(id);
    this.logicFileInput?.nativeElement.click();
  }

  async onLogicFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    if (!files.length) return;

    const targetId = this.reuploadTargetId();
    this.isAddingLogic.set(true);

    if (targetId) {
      const file = files[0];
      try {
        const content = await file.text();
        const entry = await firstValueFrom(
          this.http.put<{ id: string, title: string, content: string }>(`/api/business-logic/${targetId}`, { title: file.name, content })
        );
        this.businessLogicEntries.update(list => list.map(e => e.id === targetId ? entry : e));
      } catch {
        this.msg.error(`อัปโหลด ${file.name} ไม่สำเร็จ`);
      }
      this.reuploadTargetId.set(null);
    } else {
      for (const file of files) {
        try {
          const content = await file.text();
          const entry = await firstValueFrom(
            this.http.post<{ id: string, title: string, content: string }>('/api/business-logic', { title: file.name, content })
          );
          this.businessLogicEntries.update(list => [...list, entry]);
        } catch {
          this.msg.error(`อัปโหลด ${file.name} ไม่สำเร็จ`);
        }
      }
    }

    this.isAddingLogic.set(false);
    input.value = '';
  }

  removeBusinessLogic(id: string) {
    this.http.delete<{ id: string, title: string, content: string }[]>(`/api/business-logic/${id}`).subscribe({
      next: (list) => this.businessLogicEntries.set(list),
      error: () => this.msg.error('ลบ Business Logic ไม่สำเร็จ')
    });
  }

  loadUsage() {
    this.http.get<any[]>('/api/models/usage').subscribe({
      next: (data) => this.availableModels.set(data),
      error: () => {
        this.availableModels.set([
          { model: 'gemini-3.6-flash', remaining: 15, max: 15, resetAt: Date.now() + 60000, lockedUntil: null },
          { model: 'gemini-3.5-flash', remaining: 15, max: 15, resetAt: Date.now() + 60000, lockedUntil: null },
          { model: 'gemini-2.5-flash', remaining: 15, max: 15, resetAt: Date.now() + 60000, lockedUntil: null },
          { model: 'gemini-3.1-flash-lite', remaining: 15, max: 15, resetAt: Date.now() + 60000, lockedUntil: null },
          { model: 'groq-llama-3.3-70b', remaining: 60, max: 60, resetAt: Date.now() + 60000, lockedUntil: null },
          { model: 'deepseek-r1', remaining: 60, max: 60, resetAt: Date.now() + 60000, lockedUntil: null }
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
        model: this.modelPrefControl.value || 'gemini-3.6-flash',
        language: this.langPrefControl.value || 'th'
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
                 await this.hydrateMermaidSections(sections);
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
                await this.hydrateMermaidSections(sections);
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
        
        if (fullText.trim()) await this.finalizeLastMessage(fullText);

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

      // Keep whatever arrived, but stop showing "still generating" for a diagram that never closed.
      const partial = this.messages().at(-1);
      if (partial?.role === 'assistant' && partial.rawContent?.trim()) await this.finalizeLastMessage(partial.rawContent);
      
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
      this.saveCurrentChat();
    }
  }

  private static readonly SECTION_MAP: Record<string, {cls: string, numCls: string, dotCls: string, icon: string, label: string}> = {
    "📋 User Flow":       { cls: "section-flow",     numCls: "step-num-flow",     dotCls: "bullet-dot-flow",     icon: "file-text",     label: "User Flow" },
    "🗺️ Flow Diagram":   { cls: "section-diagram",   numCls: "step-num-diagram",  dotCls: "bullet-dot-diagram",  icon: "map",            label: "Flow Diagram" },
    "🔍 Flow Analysis":   { cls: "section-analysis",  numCls: "step-num-analysis", dotCls: "bullet-dot-analysis", icon: "lightbulb",      label: "Flow Analysis" },
    "⚖️ Pros & Cons":    { cls: "section-pros",      numCls: "step-num-pros",     dotCls: "bullet-dot-pros",     icon: "scale",          label: "Pros & Cons" },
    "⚠️ Technical Alert": { cls: "section-alert",     numCls: "step-num-alert",    dotCls: "bullet-dot-alert",    icon: "triangle-alert", label: "Technical Alert" },
    "📖 User Stories":    { cls: "section-stories",   numCls: "step-num-stories",  dotCls: "bullet-dot-stories",  icon: "book-open",      label: "User Stories" },
    "🔀 Alternative Use Cases": { cls: "section-alt",    numCls: "step-num-alt",      dotCls: "bullet-dot-alt",      icon: "split",          label: "Alternative Use Cases" },
    "🚧 Edge Cases & Error Handling": { cls: "section-edge", numCls: "step-num-edge", dotCls: "bullet-dot-edge",     icon: "shield-alert",   label: "Edge Cases & Error Handling" },
    "🎨 UI Components":   { cls: "section-ui",        numCls: "step-num-ui",       dotCls: "bullet-dot-ui",       icon: "palette",        label: "UI Components" },
  };

  private async finalizeLastMessage(fullText: string) {
    const sections = this.parseSections(fullText, true);
    await this.hydrateMermaidSections(sections);
    this.messages.update(msgs => {
      const next = [...msgs];
      next[next.length - 1] = { role: 'assistant', rawContent: fullText, sections };
      return next;
    });
  }

  /** `final` = the stream has ended (or died): an unclosed diagram fence will never complete. */
  parseSections(text: string, final = false): FlowSection[] {
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
          const match = content.match(/```(flow|json|mermaid)\s*\n([\s\S]*?)```/);
          if (match) {
            return {
              title: s.title, label: meta.label, icon: meta.icon, cls: meta.cls,
              diagramCode: match[2].trim(), diagramKind: match[1] === 'mermaid' ? 'mermaid' : 'flow'
            };
          }
          // Fence not closed yet: still streaming, or the stream ended before the diagram finished
          const note = final ? 'แผนภาพไม่สมบูรณ์ (การเชื่อมต่อถูกตัด) กรุณาลองส่งคำถามอีกครั้ง' : 'กำลังสร้างแผนภาพ...';
          return {
            title: s.title, label: meta.label, icon: meta.icon, cls: meta.cls,
            body: this.sanitizer.bypassSecurityTrustHtml(`<p style="margin:0;color:var(--gray-6)">${note}</p>`)
          };
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

  /** Renders any completed diagram sections to SVG in-place, caching by source so re-streamed/unchanged code is a no-op. */
  async hydrateMermaidSections(sections: FlowSection[]): Promise<void> {
    for (const section of sections) {
      if (!section.diagramCode) continue;

      const cacheKey = `${section.diagramKind}:${section.diagramCode}`;
      let entry = this.diagramCache.get(cacheKey);
      if (!entry) {
        try {
          let svgString: string;
          if (section.diagramKind === 'mermaid') {
            // Mermaid measures text at render time; wait for the web fonts or labels get clipped.
            await document.fonts?.ready;
            const themedCode = applyFlowTheme(section.diagramCode, this.isDarkMode());
            const { svg } = await mermaid.render(`mermaid-${this.mermaidIdCounter++}`, themedCode);
            svgString = this.sizeSvgFromViewBox(svg);
          } else {
            // Our own renderer: pure string output, no DOM measurement needed.
            svgString = flowJsonToSvg(section.diagramCode, this.isDarkMode());
          }
          entry = { html: this.sanitizer.bypassSecurityTrustHtml(svgString), size: this.parseSvgSize(svgString) };
        } catch (e) {
          entry = {
            html: this.sanitizer.bypassSecurityTrustHtml(`<p style="margin:0;color:var(--gray-6)">ไม่สามารถแสดงแผนภาพได้ (รูปแบบไม่ถูกต้อง)</p>`),
            size: null
          };
        }
        this.diagramCache.set(cacheKey, entry);
      }
      section.body = entry.html;
      section.diagramSize = entry.size;
    }
  }

  /** Reads the explicit pixel width/height from the root <svg> tag, if present. */
  private parseSvgSize(svgString: string): { w: number; h: number } | null {
    const tag = svgString.match(/^\s*<svg\b[^>]*>/)?.[0];
    if (!tag) return null;
    const w = parseFloat(tag.match(/\swidth="([\d.]+)"/)?.[1] ?? '');
    const h = parseFloat(tag.match(/\sheight="([\d.]+)"/)?.[1] ?? '');
    return w > 0 && h > 0 ? { w, h } : null;
  }

  /**
   * Mermaid emits `width="100%"` on the root <svg>, which is ambiguous inside a
   * shrink-to-fit container (our modal's zoomable stage) and can collapse to ~0
   * before the browser's next layout pass. Bake an explicit pixel width/height
   * from the viewBox so the SVG always has a definite intrinsic size.
   */
  private sizeSvgFromViewBox(svgString: string): string {
    const viewBoxMatch = svgString.match(/viewBox="[\d.\-]+\s+[\d.\-]+\s+([\d.]+)\s+([\d.]+)"/);
    if (!viewBoxMatch) return svgString;
    const [, width, height] = viewBoxMatch;

    // Mermaid's <svg> may carry width="100%" and no explicit height at all. Strip
    // whatever sizing attributes are present (there may be zero, one, or both) and
    // insert a definite pixel width/height so the box is never ambiguous.
    return svgString.replace(/^<svg\b[^>]*>/, openTag =>
      openTag
        .replace(/\s(width|height)="[^"]*"/g, '')
        .replace(/^<svg/, `<svg width="${width}" height="${height}"`)
    );
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

