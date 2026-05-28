import { Injectable, Logger } from '@nestjs/common';
import { Ollama } from 'ollama';
import { ConfigService } from '@nestjs/config';

interface SuggestionInput {
  description: string;
  amountCents: bigint;
  type: 'income' | 'expense';
  /** Lista categorie disponibili: id + nome (+ tipo) */
  categories: { id: string; name: string; type: 'income' | 'expense' | 'transfer' }[];
}

export interface CategorySuggestion {
  categoryId: string | null;
  confidence: number; // 0..1
  reason?: string;
}

/**
 * Suggerisce una categoria a partire dalla descrizione di una transazione,
 * usando Ollama (LLM locale). In batch: 1 chiamata per fino a 30 righe.
 * Fallback heuristic se Ollama non risponde / non disponibile.
 */
@Injectable()
export class CategoryAiService {
  private readonly logger = new Logger(CategoryAiService.name);
  private readonly ollama: Ollama | null;
  private readonly model: string | null;

  constructor(config: ConfigService) {
    const host = config.get<string>('OLLAMA_BASE_URL');
    const model = config.get<string>('OLLAMA_MODEL');
    if (host && model) {
      this.ollama = new Ollama({ host });
      this.model = model;
    } else {
      this.ollama = null;
      this.model = null;
    }
  }

  available(): boolean {
    return !!this.ollama && !!this.model;
  }

  async suggestBatch(inputs: SuggestionInput[]): Promise<CategorySuggestion[]> {
    if (inputs.length === 0) return [];
    if (!this.ollama || !this.model || !inputs[0].categories.length) {
      return inputs.map((i) => this.heuristic(i));
    }

    try {
      const categories = inputs[0].categories;
      const prompt = this.buildPrompt(inputs, categories);
      const res = await this.ollama.chat({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        format: 'json',
        options: { temperature: 0 },
      });
      const text = res.message?.content ?? '';
      return this.parseResponse(text, inputs, categories);
    } catch (e) {
      this.logger.warn(`AI suggest failed, falling back to heuristic: ${(e as Error).message}`);
      return inputs.map((i) => this.heuristic(i));
    }
  }

  private buildPrompt(inputs: SuggestionInput[], categories: SuggestionInput['categories']): string {
    const catList = categories.map((c) => `- ${c.id} | ${c.name} (${c.type})`).join('\n');
    const rows = inputs
      .map(
        (i, idx) =>
          `${idx + 1}. type=${i.type} amount=${(Number(i.amountCents) / 100).toFixed(2)}€ desc="${i.description.replace(/"/g, '\\"')}"`,
      )
      .join('\n');
    return [
      'Sei un classificatore di transazioni bancarie italiane. Per ogni riga sotto,',
      'scegli LA categoria più appropriata tra quelle disponibili. Rispondi SOLO con',
      'un oggetto JSON nel formato:',
      '{"items":[{"index":N,"categoryId":"<uuid|null>","confidence":<0..1>,"reason":"<breve>"}, ...]}',
      'Una entry per riga, nello stesso ordine.',
      'Se nessuna categoria è plausibile (confidence < 0.4), usa categoryId=null.',
      '',
      'Categorie disponibili:',
      catList,
      '',
      'Transazioni:',
      rows,
      '',
      'Rispondi con SOLO il JSON, senza testo prima o dopo.',
    ].join('\n');
  }

  private parseResponse(
    text: string,
    inputs: SuggestionInput[],
    categories: SuggestionInput['categories'],
  ): CategorySuggestion[] {
    const validIds = new Set(categories.map((c) => c.id));
    const fallback = (i: number) => this.heuristic(inputs[i]);
    type Item = {
      index: number;
      categoryId: string | null;
      confidence: number;
      reason?: string;
    };
    let items: Item[] | null = null;

    // Prova prima a parsare come oggetto { items: [...] }
    try {
      const parsed = JSON.parse(text) as { items?: Item[] } | Item[];
      if (Array.isArray(parsed)) items = parsed;
      else if (parsed && Array.isArray(parsed.items)) items = parsed.items;
    } catch {
      // Estrai array dal testo se Ollama ha aggiunto wrapper
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        try {
          items = JSON.parse(match[0]) as Item[];
        } catch {
          items = null;
        }
      }
    }

    if (!items) return inputs.map((_, i) => fallback(i));

    const byIndex = new Map(items.map((a) => [a.index - 1, a]));
    return inputs.map((_, i) => {
      const a = byIndex.get(i);
      if (!a) return fallback(i);
      const id = a.categoryId && validIds.has(a.categoryId) ? a.categoryId : null;
      return {
        categoryId: id,
        confidence: clamp01(a.confidence ?? 0),
        reason: a.reason,
      };
    });
  }

  /** Heuristic super-basico: keyword-match sul nome categoria. */
  private heuristic(input: SuggestionInput): CategorySuggestion {
    const desc = input.description.toLowerCase();
    let best: { id: string; score: number } | null = null;
    for (const c of input.categories) {
      if (c.type !== input.type && c.type !== 'transfer') continue;
      const tokens = c.name.toLowerCase().split(/\s+/);
      const score = tokens.reduce((s, t) => (desc.includes(t) ? s + 1 : s), 0) / tokens.length;
      if (score > 0 && (!best || score > best.score)) best = { id: c.id, score };
    }
    return best
      ? { categoryId: best.id, confidence: Math.min(0.6, best.score * 0.6), reason: 'rule-based' }
      : { categoryId: null, confidence: 0, reason: 'no match' };
  }
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
