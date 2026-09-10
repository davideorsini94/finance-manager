import { pickReplacementModel } from './opencode-catalog';

/**
 * Quando il modello attivo non è più servito dal gateway, l'app ne sceglie un
 * altro da sé: l'ordine deve essere **deterministico**, altrimenti lo stesso
 * guasto porta a modelli diversi e non si capisce più cosa sta rispondendo.
 */
describe('pickReplacementModel', () => {
  it('preferisce il modello consigliato dal catalogo', () => {
    expect(pickReplacementModel(['glm-5.2', 'deepseek-v4-flash', 'kimi-k2.5'])).toBe(
      'deepseek-v4-flash',
    );
  });

  it('senza consigliato prende la qualità migliore, a pari qualità il più economico', () => {
    // deepseek-v4-pro (eccellente) batte glm-5.2 (molto buona).
    expect(pickReplacementModel(['glm-5.2', 'deepseek-v4-pro'])).toBe('deepseek-v4-pro');
    // qwen3.5-plus (0.2 in input) batte gemini-3-flash (0.5), pari qualità.
    expect(pickReplacementModel(['gemini-3-flash', 'qwen3.5-plus'])).toBe('qwen3.5-plus');
  });

  it('senza metadati ripiega sul primo id in ordine alfabetico', () => {
    // Modelli nuovi del gateway, fuori dalla mappa dei metadati: la scelta
    // resta prevedibile invece di dipendere dall'ordine del gateway.
    expect(pickReplacementModel(['omen-alpha', 'kimi-k3', 'longcat-2.0'])).toBe('kimi-k3');
  });

  it('preferisce comunque un modello con metadati a uno senza', () => {
    expect(pickReplacementModel(['aaa-modello-ignoto', 'deepseek-v4-pro'])).toBe('deepseek-v4-pro');
  });

  it('senza nessun modello funzionante non inventa niente', () => {
    expect(pickReplacementModel([])).toBeNull();
  });
});
