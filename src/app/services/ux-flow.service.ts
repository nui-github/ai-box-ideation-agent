import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { MOCK_PROMPTS, MOCK_INFO_TEXTS, UxFlowPrompt } from '../mock-data/ux-flow.mock';

@Injectable({
  providedIn: 'root'
})
export class UxFlowService {
  getPrompts(): Observable<UxFlowPrompt[]> {
    return of(MOCK_PROMPTS);
  }

  getInfoTexts(): Observable<Record<string, { title: string, text: string }>> {
    return of(MOCK_INFO_TEXTS);
  }
}
