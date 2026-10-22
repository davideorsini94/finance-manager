import {
  cleanPdfText,
  extractJsonObject,
  isUsefulExtraction,
  normalizeExtraction,
  parseBillDate,
  parseLocaleNumber,
  parseUtilityKind,
  unitFactor,
} from './bill-extraction';

describe('parseLocaleNumber', () => {
  it.each([
    [1234.56, 1234.56],
    ['1.234,56', 1234.56],
    ['1234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['€ 45,20', 45.2],
    ['45,20 euro', 45.2],
    ['1 234', 1234],
    ['1.234', 1234],
    ['1.234.567', 1234567],
    ['0.123', 0.123],
    ['-12,50', -12.5],
    ['12.5', 12.5],
  ])('%p → %p', (input, expected) => {
    expect(parseLocaleNumber(input)).toBeCloseTo(expected as number, 6);
  });

  it.each([['abc'], [''], [null], [undefined], [NaN], [Infinity], [{}], ['12a']])('%p → null', (input) => {
    expect(parseLocaleNumber(input)).toBeNull();
  });
});

describe('parseBillDate', () => {
  it.each([
    ['2026-03-05', '2026-03-05'],
    ['2026-3-5', '2026-03-05'],
    ['05/03/2026', '2026-03-05'],
    ['5-3-2026', '2026-03-05'],
    ['05.03.26', '2026-03-05'],
    ['2026-03-05T00:00:00Z', '2026-03-05'],
  ])('%p → %p', (input, expected) => {
    expect(parseBillDate(input)).toBe(expected);
  });

  it.each([['31/02/2026'], ['2026-13-01'], ['1999-12-31'], ['ieri'], [20260305], [null]])('%p → null', (input) => {
    expect(parseBillDate(input)).toBeNull();
  });
});

describe('parseUtilityKind', () => {
  it('riconosce i sinonimi italiani e inglesi', () => {
    expect(parseUtilityKind('Energia elettrica')).toBe('electricity');
    expect(parseUtilityKind('luce')).toBe('electricity');
    expect(parseUtilityKind('Gas naturale')).toBe('gas');
    expect(parseUtilityKind('Servizio idrico integrato')).toBe('water');
    expect(parseUtilityKind('water')).toBe('water');
    expect(parseUtilityKind('telefono')).toBeNull();
  });
});

describe('unitFactor', () => {
  it('converte nelle unità del servizio', () => {
    expect(unitFactor('electricity', 'kWh')).toBe(1);
    expect(unitFactor('electricity', 'MWh')).toBe(1000);
    expect(unitFactor('gas', 'Smc')).toBe(1);
    expect(unitFactor('gas', 'mc')).toBe(1);
    expect(unitFactor('water', 'm³')).toBe(1);
    expect(unitFactor('water', 'litri')).toBe(0.001);
    expect(unitFactor('water', undefined)).toBe(1);
  });

  it('rifiuta unità che non appartengono al servizio', () => {
    expect(unitFactor('gas', 'kWh')).toBeNull();
    expect(unitFactor('electricity', 'Smc')).toBeNull();
    expect(unitFactor('water', 'kWh')).toBeNull();
  });
});

describe('extractJsonObject', () => {
  it('estrae il JSON da recinti, testo attorno e blocchi <think>', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(extractJsonObject('Ecco:\n```json\n{"a":2}\n```\nfine')).toEqual({ a: 2 });
    expect(extractJsonObject('<think>{"no":true}</think> risposta {"a":3}')).toEqual({ a: 3 });
  });

  it('restituisce null se non c’è JSON valido', () => {
    expect(extractJsonObject('nessun dato')).toBeNull();
    expect(extractJsonObject('{rotto')).toBeNull();
  });
});

describe('normalizeExtraction', () => {
  it('bolletta dual fuel luce + gas', () => {
    const r = normalizeExtraction({
      provider: '  Edison   Energia ',
      billNumber: 'F-2026/123',
      issueDate: '10/03/2026',
      dueDate: '2026-03-30',
      periodStart: '2026-01-01',
      periodEnd: '2026-02-28',
      total: '187,40',
      services: [
        { type: 'gas', consumption: '210,5', unit: 'Smc', cost: 120.1, supplyCode: 'pdr 0012-3456', estimated: true },
        { type: 'luce', consumption: 0.43, unit: 'MWh', cost: '67,30', supplyCode: 'IT001E12345678' },
      ],
    });
    expect(r.provider).toBe('Edison Energia');
    expect(r.issueDate).toBe('2026-03-10');
    expect(r.totalCents).toBe(18740);
    expect(r.lines.map((l) => l.utility)).toEqual(['electricity', 'gas']);
    expect(r.lines[0]).toMatchObject({ consumption: 430, costCents: 6730, supplyCode: 'IT001E12345678', estimated: false });
    expect(r.lines[1]).toMatchObject({ consumption: 210.5, costCents: 12010, supplyCode: 'PDR00123456', estimated: true });
  });

  it('tre servizi insieme', () => {
    const r = normalizeExtraction({
      services: [
        { type: 'water', consumption: 30, unit: 'm3', cost: 50 },
        { type: 'electricity', consumption: 300, unit: 'kWh', cost: 80 },
        { type: 'gas', consumption: 100, unit: 'Smc', cost: 90 },
      ],
    });
    expect(r.lines.map((l) => l.utility)).toEqual(['electricity', 'gas', 'water']);
  });

  it('un solo servizio senza costo prende il totale', () => {
    const r = normalizeExtraction({ total: 45.2, services: [{ type: 'water', consumption: 18, unit: 'mc' }] });
    expect(r.lines[0].costCents).toBe(4520);
  });

  it('con più servizi il totale non viene copiato su nessuno', () => {
    const r = normalizeExtraction({
      total: 100,
      services: [{ type: 'electricity', consumption: 10 }, { type: 'gas', consumption: 5 }],
    });
    expect(r.lines.every((l) => l.costCents === null)).toBe(true);
  });

  it('scarta servizi sconosciuti, duplicati e consumi con unità sbagliata', () => {
    const r = normalizeExtraction({
      services: [
        { type: 'telefono', consumption: 1 },
        { type: 'gas', consumption: 1500, unit: 'kWh', cost: 30 },
        { type: 'gas', consumption: 99, unit: 'Smc', cost: 1 },
        'stringa',
        null,
      ],
    });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ utility: 'gas', consumption: null, costCents: 3000 });
  });

  it('scambia un periodo invertito e omette il periodo di riga uguale a quello della bolletta', () => {
    const r = normalizeExtraction({
      periodStart: '2026-02-28',
      periodEnd: '2026-01-01',
      services: [
        { type: 'electricity', periodStart: '2026-01-01', periodEnd: '2026-02-28' },
        { type: 'gas', periodStart: '2025-12-15', periodEnd: '2026-02-10' },
      ],
    });
    expect([r.periodStart, r.periodEnd]).toEqual(['2026-01-01', '2026-02-28']);
    expect(r.lines[0]).toMatchObject({ periodStart: null, periodEnd: null });
    expect(r.lines[1]).toMatchObject({ periodStart: '2025-12-15', periodEnd: '2026-02-10' });
  });

  it('tiene il periodo di riga come coppia anche se solo una data coincide con la bolletta', () => {
    const r = normalizeExtraction({
      periodStart: '2026-01-01',
      periodEnd: '2026-03-31',
      services: [
        { type: 'gas', periodStart: '2026-01-01', periodEnd: '2026-02-28' },
        { type: 'water', periodStart: '2026-01-15' },
      ],
    });
    expect(r.lines[0]).toMatchObject({ utility: 'gas', periodStart: '2026-01-01', periodEnd: '2026-02-28' });
    expect(r.lines[1]).toMatchObject({ utility: 'water', periodStart: null, periodEnd: null });
  });

  it('rifiuta importi e consumi implausibili', () => {
    const r = normalizeExtraction({
      total: 98765432,
      services: [{ type: 'electricity', consumption: -5, cost: 'abc' }],
    });
    expect(r.totalCents).toBeNull();
    expect(r.lines[0]).toMatchObject({ consumption: null, costCents: null });
  });

  it('accetta un totale negativo (bolletta a credito)', () => {
    expect(normalizeExtraction({ total: '-35,00' }).totalCents).toBe(-3500);
  });

  it('non lancia mai su input non validi', () => {
    for (const input of [null, undefined, 42, 'testo', [], { services: 'x' }]) {
      const r = normalizeExtraction(input);
      expect(r.lines).toEqual([]);
      expect(isUsefulExtraction(r)).toBe(false);
    }
  });

  it('pulisce testi con caratteri di controllo e segnaposto', () => {
    const r = normalizeExtraction({ provider: 'Enel\u0000\nEnergia', billNumber: 'N/A' });
    expect(r.provider).toBe('Enel Energia');
    expect(r.billNumber).toBeNull();
  });
});

describe('isUsefulExtraction', () => {
  it('basta un servizio con consumo o costo, o fornitore con periodo/totale', () => {
    expect(isUsefulExtraction(normalizeExtraction({ services: [{ type: 'gas', consumption: 3 }] }))).toBe(true);
    expect(isUsefulExtraction(normalizeExtraction({ provider: 'Acea', total: 10 }))).toBe(true);
    expect(isUsefulExtraction(normalizeExtraction({ provider: 'Acea' }))).toBe(false);
  });
});

describe('cleanPdfText', () => {
  it('toglie i caratteri di controllo, comprime gli spazi e tronca', () => {
    expect(cleanPdfText('a\u0000b\t\tc\n\n\n d', 100)).toBe('a b c\n d');
    expect(cleanPdfText('x'.repeat(50), 10)).toHaveLength(10);
  });
});
