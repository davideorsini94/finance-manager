import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  EmptyLlmResponseError,
  QUOTA_COOLDOWN_MS,
  isFallbackWorthy,
  isQuotaError,
} from './llm-fallback';

/** Errore modellato come quelli veri di `opencode.client.ts` (status nel testo). */
function gatewayError(status: number, detail = 'boom'): Error {
  return new ServiceUnavailableException(
    `Il modello "x" non è utilizzabile su OpenCode (HTTP ${status}: ${detail}).`,
  );
}

describe('isFallbackWorthy', () => {
  it('ripiega su timeout e problemi di rete', () => {
    expect(isFallbackWorthy(new ServiceUnavailableException('OpenCode non raggiungibile.'))).toBe(
      true,
    );
    expect(
      isFallbackWorthy(
        new ServiceUnavailableException(
          'OpenCode non risponde (connessione in timeout): riprova tra qualche secondo.',
        ),
      ),
    ).toBe(true);
    const aborted = new Error('The operation was aborted due to timeout');
    aborted.name = 'TimeoutError';
    expect(isFallbackWorthy(aborted)).toBe(true);
    expect(isFallbackWorthy(new TypeError('fetch failed'))).toBe(true);
  });

  it('ripiega sugli errori del gateway che non dipendono da noi', () => {
    for (const status of [500, 502, 503, 429, 402, 403]) {
      expect(isFallbackWorthy(gatewayError(status))).toBe(true);
    }
  });

  it('ripiega sul 400 "modello non servito"', () => {
    expect(isFallbackWorthy(gatewayError(400, 'Unsupported model'))).toBe(true);
  });

  it('ripiega su una risposta vuota', () => {
    expect(isFallbackWorthy(new EmptyLlmResponseError('gpt-x'))).toBe(true);
  });

  it('NON ripiega su errori nostri: richiesta malformata, risorsa mancante, bug', () => {
    expect(isFallbackWorthy(new BadRequestException('Il report mensile richiede il mese.'))).toBe(
      false,
    );
    expect(isFallbackWorthy(new NotFoundException('Sessione non trovata'))).toBe(false);
    expect(isFallbackWorthy(new InternalServerErrorException('bug'))).toBe(false);
    expect(isFallbackWorthy(new TypeError("Cannot read properties of undefined"))).toBe(false);
  });
});

describe('isQuotaError', () => {
  it('riconosce limite raggiunto e credito esaurito', () => {
    expect(isQuotaError(gatewayError(429, 'Rate limit exceeded'))).toBe(true);
    expect(isQuotaError(gatewayError(402, 'Insufficient credits'))).toBe(true);
    expect(isQuotaError(new ServiceUnavailableException('quota exceeded for this workspace'))).toBe(
      true,
    );
  });

  it('un 500 non è un problema di quota', () => {
    expect(isQuotaError(gatewayError(500))).toBe(false);
    expect(isQuotaError(new EmptyLlmResponseError('gpt-x'))).toBe(false);
  });
});

describe('QUOTA_COOLDOWN_MS', () => {
  it('è di 15 minuti', () => {
    expect(QUOTA_COOLDOWN_MS).toBe(15 * 60_000);
  });
});

describe('EmptyLlmResponseError', () => {
  it('nomina il modello, così il messaggio è utile anche a schermo', () => {
    expect(new EmptyLlmResponseError('gpt-5.6-luna').message).toContain('gpt-5.6-luna');
  });
});
