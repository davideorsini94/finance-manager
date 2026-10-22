import {
  correctedPeriod,
  findBilledPeriod,
  cleanPdfText,
  findEnergyPrices,
  plausibleEnergyPrice,
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
    expect(r.supplyAddress).toBeNull();
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

  it('legge l’indirizzo di fornitura', () => {
    expect(normalizeExtraction({ supplyAddress: ' Via Nilde Iotti 11,\n42015 Correggio ' }).supplyAddress).toBe(
      'Via Nilde Iotti 11, 42015 Correggio',
    );
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

describe('materia prima', () => {
  it('normalizza prezzo e spesa della materia prima solo per luce e gas', () => {
    const r = normalizeExtraction({
      services: [
        { type: 'electricity', consumption: 175.62, energyUnitPrice: '0,177488', energyCost: '31,17' },
        { type: 'gas', consumption: 19.84, energyUnitPrice: 0.661144, energyCost: 13.12 },
        { type: 'water', consumption: 20, energyUnitPrice: 1.2, energyCost: 10 },
      ],
    });
    expect(r.lines[0]).toMatchObject({ energyUnitPrice: 0.177488, energyCostCents: 3117 });
    expect(r.lines[1]).toMatchObject({ energyUnitPrice: 0.661144, energyCostCents: 1312 });
    expect(r.lines[2]).toMatchObject({ energyUnitPrice: null, energyCostCents: null });
  });

  it('scarta prezzi implausibili', () => {
    expect(plausibleEnergyPrice('electricity', 31.17)).toBeNull();
    expect(plausibleEnergyPrice('gas', 0.001)).toBeNull();
    expect(plausibleEnergyPrice('water', 0.5)).toBeNull();
  });

  it('legge le righe vere senza LLM (testo con etichette attaccate ai numeri)', () => {
    const text = [
      '175,62 kWh x0,222528 €/kWh + 39,08 €',
      'di cui spesa per la vendita energia elettrica0,177488 €/kWh+ 31,17 €',
      'di cui spesa per la rete e gli oneri generali di sistema0,045041 €/kWh+ 7,91 €',
      '19,84 Smc x0,867248 €/Smc + 17,21 €',
      'di cui spesa per la vendita gas naturale0,661144 €/Smc+ 13,12 €',
      'PSBIL * PCS/0,03852 01/05/2026 - 31/05/2026: 0,524950 €/Smc',
    ].join('\n');
    expect(findEnergyPrices(text)).toEqual({
      electricity: { energyUnitPrice: 0.177488, energyCostCents: 3117 },
      gas: { energyUnitPrice: 0.661144, energyCostCents: 1312 },
    });
  });

  it('legge il formato meno recente (solo la spesa)', () => {
    expect(findEnergyPrices('Spesa per la materia energia € 61,22\nSpesa per la materia gas naturale € 38,21')).toEqual({
      electricity: { energyUnitPrice: null, energyCostCents: 6122 },
      gas: { energyUnitPrice: null, energyCostCents: 3821 },
    });
  });

  it('non scambia un consumo o un anno per la spesa', () => {
    expect(findEnergyPrices('di cui spesa per la vendita energia elettrica 0,12 €/kWh 250 kWh consumati')).toEqual({
      electricity: { energyUnitPrice: 0.12, energyCostCents: null },
    });
    expect(findEnergyPrices('Spesa per la materia energia 2.025 kWh')).toEqual({});
  });

  it('niente materia prima se la voce non c’è', () => {
    expect(findEnergyPrices('Totale da pagare € 63,73\nConsumo 28 mc')).toEqual({});
  });
});

describe('findBilledPeriod / correctedPeriod', () => {
  // Righe reali di una fattura NeN del 01/10/2026 (testo estratto dal PDF).
  const nenSettembre = [
    'Costi di generazione F1 (R)01/08/2026 - 31/08/2026€/kWh0,096364-2-0,1910',
    'Prezzo energia F301/09/2026 - 30/09/2026€/kWh0,10600020,2110',
    'Quota fissa di vendita Luce01/09/2026 - 30/09/2026€/cliente/mese0,312329309,3710',
    'Trasporto quote fisse01/09/2026 - 30/09/2026€/cliente/mese1,92000011,9210',
    'Trasporto quote variabili (R)01/08/2026 - 31/08/2026€/kWh0,01473020,0310',
  ].join('\n');
  // Fattura del 01/09: storno e riaddebito delle quote di luglio, quote di agosto.
  const nenAgosto = [
    '01/07/2026 - 31/07/2026€/cliente/mese0,312329319,6810',
    '01/07/2026 - 31/07/2026€/cliente/mese0,312329-31-9,6810',
    'Quota fissa di vendita Luce01/08/2026 - 31/08/2026€/cliente/mese0,312329319,6810',
    'Trasporto quote potenza01/08/2026 - 31/08/2026€/kW/mese2,0144736,0012,0910',
  ].join('\n');
  // Conguaglio Accendi: quote fisse di quattro mesi già fatturati in parte.
  const conguaglio = ['04', '05', '06', '07']
    .map((m) => `Costi distribuzione01/${m}/2026 - ${m === '04' || m === '06' ? 30 : 31}/${m}/2026Effettivo€/cliente/mese5,7699991,00€5,7722%`)
    .join('\n');

  it('legge il mese delle quote fisse, ignorando rettifiche (R) e storni', () => {
    expect(findBilledPeriod(nenSettembre)).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(findBilledPeriod(nenAgosto)).toEqual({ start: '2026-08-01', end: '2026-08-31' });
    expect(findBilledPeriod(conguaglio)).toEqual({ start: '2026-04-01', end: '2026-07-31' });
  });

  it('null senza quote fisse mensili intere e consecutive', () => {
    expect(findBilledPeriod('Acquedotto Quota Fissa01/06/2026 - 30/06/2026€/unità/anno22,4678311,001,8710%')).toBeNull();
    expect(findBilledPeriod('Quota fissa01/08/2026 - 01/08/2026€/cliente/mese0,31232910,3110')).toBeNull();
    expect(
      findBilledPeriod(
        ['01/06/2026 - 30/06/2026€/cliente/mese1,00000011,0010', '01/08/2026 - 31/08/2026€/cliente/mese1,00000011,0010'].join('\n'),
      ),
    ).toBeNull();
  });

  it('corregge periodi allargati o sfasati, non allarga quelli più corti', () => {
    const sep = findBilledPeriod(nenSettembre);
    expect(correctedPeriod('2026-08-01', '2026-09-30', sep)).toEqual(sep);
    expect(correctedPeriod('2026-08-01', '2026-08-31', sep)).toEqual(sep);
    expect(correctedPeriod(null, null, sep)).toEqual(sep);
    expect(correctedPeriod('2026-09-01', '2026-09-30', sep)).toBeNull();
    expect(correctedPeriod('2026-07-01', '2026-07-31', findBilledPeriod(conguaglio))).toBeNull();
    expect(correctedPeriod('2026-07-01', '2026-07-31', null)).toBeNull();
  });
});
