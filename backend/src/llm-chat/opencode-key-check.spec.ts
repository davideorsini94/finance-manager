import { keyIsAuthenticated } from './opencode.client';

/**
 * La validità di una API key OpenCode non deve dipendere dalla salute di un
 * modello: il gateway elenca modelli che poi risponde 500/503/400/403, e
 * legarci la chiave la faceva dichiarare "non valida" quando era perfetta.
 */
describe('keyIsAuthenticated', () => {
  it('considera non valida la chiave solo su 401 (entrambe le fonti)', () => {
    expect(keyIsAuthenticated('usage', 401)).toBe(false);
    expect(keyIsAuthenticated('chat', 401)).toBe(false);
  });

  it('accetta la chiave quando il gateway risponde 200', () => {
    expect(keyIsAuthenticated('usage', 200)).toBe(true);
    expect(keyIsAuthenticated('chat', 200)).toBe(true);
  });

  it('accetta la chiave con credito esaurito (402) o rate limit (429)', () => {
    for (const status of [402, 429]) {
      expect(keyIsAuthenticated('usage', status)).toBe(true);
      expect(keyIsAuthenticated('chat', status)).toBe(true);
    }
  });

  it('accetta la chiave quando è il gateway a essere rotto (500, 503)', () => {
    for (const status of [500, 503]) {
      expect(keyIsAuthenticated('chat', status)).toBe(true);
    }
  });

  it('accetta la chiave quando è il modello a non essere supportato (400)', () => {
    expect(keyIsAuthenticated('chat', 400)).toBe(true);
  });

  it('interpreta il 403 in base alla fonte: opt-in del modello su chat, rifiuto su usage', () => {
    // Su chat/completions il 403 è del modello a opt-in (es. i "-contributor"):
    // la chiave ha superato l'autenticazione.
    expect(keyIsAuthenticated('chat', 403)).toBe(true);
    // Su un endpoint senza modelli di mezzo, il 403 riguarda la chiave.
    expect(keyIsAuthenticated('usage', 403)).toBe(false);
  });

  it('non si pronuncia se non c\'è stata risposta (rete, DNS, timeout)', () => {
    expect(keyIsAuthenticated('usage', 0)).toBeNull();
    expect(keyIsAuthenticated('chat', 0)).toBeNull();
  });
});
