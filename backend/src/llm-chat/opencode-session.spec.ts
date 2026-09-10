import type { ConfigService } from '@nestjs/config';
import { OpencodeClient, opencodeSessionHeader } from './opencode.client';

/**
 * Il gateway Go rifiuta `chat/completions` senza l'header
 * `x-opencode-session` (400 MissingSessionID): senza di esso NESSUN modello
 * risponde, quindi l'header non è un'ottimizzazione ma un requisito, e deve
 * essere presente su tutte e tre le chiamate (probe, streaming, non-stream).
 */
describe('header x-opencode-session', () => {
  const client = new OpencodeClient({ get: () => undefined } as unknown as ConfigService);
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  /** Header della n-esima chiamata a fetch. */
  function sentHeaders(call = 0): Record<string, string> {
    return fetchMock.mock.calls[call][1].headers as Record<string, string>;
  }

  it('deriva un valore stabile dall\'id di conversazione', () => {
    // Stabile: il gateway lo usa per routing e prompt caching, quindi due
    // round della stessa conversazione devono mandare lo stesso valore.
    expect(opencodeSessionHeader('abc-123')).toBe(opencodeSessionHeader('abc-123'));
    expect(opencodeSessionHeader('abc-123')).toContain('abc-123');
  });

  it('genera un valore anche senza id, invece di omettere l\'header', () => {
    // Un chiamante che non ha una conversazione (probe, categorizzazione) non
    // deve poter produrre una richiesta senza header: sarebbe un 400.
    expect(opencodeSessionHeader()).toMatch(/\S/);
    expect(opencodeSessionHeader('')).toMatch(/\S/);
    expect(opencodeSessionHeader('   ')).toMatch(/\S/);
  });

  it('lo manda su probeModel', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await client.probeModel('go', 'sk-test', 'deepseek-v4-flash');
    expect(sentHeaders()['x-opencode-session']).toMatch(/\S/);
  });

  it('lo manda su chat (non-stream) usando l\'id passato dal chiamante', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });
    await client.chat('go', 'sk-test', { model: 'deepseek-v4-flash', messages: [] }, 'report-2026-09');
    expect(sentHeaders()['x-opencode-session']).toBe(opencodeSessionHeader('report-2026-09'));
  });

  it('lo manda su streamChat usando l\'id della sessione di chat', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) },
    });
    const stream = client.streamChat(
      'go',
      'sk-test',
      { model: 'deepseek-v4-flash', messages: [] },
      'sessione-42',
    );
    for await (const _ of stream) {
      // consuma lo stream (vuoto): serve solo a far partire la fetch
    }
    expect(sentHeaders()['x-opencode-session']).toBe(opencodeSessionHeader('sessione-42'));
  });
});
