import {
  STALE_LOCK_MS,
  buildAccountsKey,
  buildFingerprint,
  buildPeriodKey,
  isStaleLock,
  periodLabel,
  periodRange,
  previousPeriodRange,
} from './llm-report.keys';

describe('llm-report.keys', () => {
  describe('buildAccountsKey', () => {
    it('usa "all" quando non ci sono conti selezionati', () => {
      expect(buildAccountsKey()).toBe('all');
      expect(buildAccountsKey([])).toBe('all');
    });

    it("non dipende dall'ordine di selezione", () => {
      const a = '11111111-1111-4111-8111-111111111111';
      const b = '22222222-2222-4222-8222-222222222222';
      expect(buildAccountsKey([a, b])).toBe(buildAccountsKey([b, a]));
    });

    it('distingue selezioni diverse', () => {
      const a = '11111111-1111-4111-8111-111111111111';
      const b = '22222222-2222-4222-8222-222222222222';
      expect(buildAccountsKey([a])).not.toBe(buildAccountsKey([a, b]));
      expect(buildAccountsKey([a])).not.toBe('all');
    });

    it('ignora i duplicati', () => {
      const a = '11111111-1111-4111-8111-111111111111';
      expect(buildAccountsKey([a, a])).toBe(buildAccountsKey([a]));
    });
  });

  describe('buildPeriodKey', () => {
    it('anno per lo scope annuale', () => {
      expect(buildPeriodKey('annual', 2026)).toBe('2026');
    });

    it('anno-mese con lo zero davanti per il mensile', () => {
      expect(buildPeriodKey('monthly', 2026, 7)).toBe('2026-07');
      expect(buildPeriodKey('monthly', 2026, 12)).toBe('2026-12');
    });

    it('rifiuta il mensile senza mese', () => {
      expect(() => buildPeriodKey('monthly', 2026)).toThrow();
    });
  });

  describe('periodRange', () => {
    it("copre tutto l'anno", () => {
      const { from, to } = periodRange('annual', 2026);
      expect(from.toISOString().slice(0, 10)).toBe('2026-01-01');
      expect(to.toISOString().slice(0, 10)).toBe('2026-12-31');
    });

    it("finisce sull'ultimo giorno del mese, bisestili inclusi", () => {
      expect(periodRange('monthly', 2024, 2).to.toISOString().slice(0, 10)).toBe('2024-02-29');
      expect(periodRange('monthly', 2026, 2).to.toISOString().slice(0, 10)).toBe('2026-02-28');
      expect(periodRange('monthly', 2026, 7).to.toISOString().slice(0, 10)).toBe('2026-07-31');
    });
  });

  describe('previousPeriodRange', () => {
    it("anno precedente per l'annuale", () => {
      const { from, to } = previousPeriodRange('annual', 2026);
      expect(from.toISOString().slice(0, 10)).toBe('2025-01-01');
      expect(to.toISOString().slice(0, 10)).toBe('2025-12-31');
    });

    it("mese precedente, scavallando l'anno a gennaio", () => {
      const { from, to } = previousPeriodRange('monthly', 2026, 1);
      expect(from.toISOString().slice(0, 10)).toBe('2025-12-01');
      expect(to.toISOString().slice(0, 10)).toBe('2025-12-31');
    });
  });

  describe('periodLabel', () => {
    it('etichette leggibili in italiano', () => {
      expect(periodLabel('annual', 2026)).toBe('anno 2026');
      expect(periodLabel('monthly', 2026, 7)).toBe('luglio 2026');
    });
  });

  describe('buildFingerprint', () => {
    it('cambia se cambiano totali o numero di movimenti', () => {
      const base = { incomeCents: '1000', expenseCents: '-500', txCount: 3 };
      expect(buildFingerprint(base)).toBe(buildFingerprint({ ...base }));
      expect(buildFingerprint(base)).not.toBe(buildFingerprint({ ...base, txCount: 4 }));
      expect(buildFingerprint(base)).not.toBe(buildFingerprint({ ...base, expenseCents: '-600' }));
    });
  });

  describe('isStaleLock', () => {
    const now = new Date('2026-08-31T12:00:00Z');

    it('un job appena partito è vivo', () => {
      expect(isStaleLock(new Date(now.getTime() - 60_000), now)).toBe(false);
    });

    it('oltre la finestra è considerato morto', () => {
      expect(isStaleLock(new Date(now.getTime() - STALE_LOCK_MS - 1000), now)).toBe(true);
    });
  });
});
