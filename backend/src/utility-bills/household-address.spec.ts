import { addressesMatch, findSupplyAddress, householdName, parseAddress } from './household-address';

describe('parseAddress', () => {
  it('separa via, civico, CAP e città', () => {
    expect(parseAddress('VIA NILDE IOTTI 11 - 42015 CORREGGIO RE')).toEqual({
      street: ['nilde', 'iotti'],
      kind: 'via',
      number: '11',
      cap: '42015',
      city: 'correggio',
    });
    expect(parseAddress('Via dei Ciliegi, 14/A 00135 Roma (RM)')).toMatchObject({
      street: ['ciliegi'],
      number: '14',
      cap: '00135',
    });
    expect(parseAddress('P.zza Garibaldi n. 3')).toMatchObject({ kind: 'piazza', street: ['garibaldi'], number: '3' });
  });

  it('non inventa indirizzi', () => {
    expect(parseAddress('')).toBeNull();
    expect(parseAddress(null)).toBeNull();
    expect(parseAddress('11 42015')).toBeNull();
  });
});

describe('addressesMatch', () => {
  const variants = [
    'VIA NILDE IOTTI 11',
    'Via Nilde Iotti 11 42015 Correggio RE',
    'VIA IOTTI N. 11 - 42015 Correggio RE',
    'VIA NILDE IOTTI 11 - 42015 CORREGGIO RE',
  ];
  it('riconosce come uguali le varianti viste nelle bollette reali', () => {
    for (const a of variants) for (const b of variants) expect(addressesMatch(parseAddress(a), parseAddress(b))).toBe(true);
  });

  it('distingue civici, CAP, città e vie diverse', () => {
    const base = parseAddress('Via Nilde Iotti 11 42015 Correggio');
    expect(addressesMatch(base, parseAddress('Via Nilde Iotti 13 42015 Correggio'))).toBe(false);
    expect(addressesMatch(base, parseAddress('Via Nilde Iotti 11 40127 Bologna'))).toBe(false);
    expect(addressesMatch(base, parseAddress('Via Roma 11 42015 Correggio'))).toBe(false);
    expect(addressesMatch(base, parseAddress('Piazza Nilde Iotti 11 42015 Correggio'))).toBe(false);
    expect(addressesMatch(parseAddress('Via Iotti 11 Correggio'), parseAddress('Via Iotti 11 Bologna'))).toBe(false);
  });

  it('senza civico non unisce', () => {
    expect(addressesMatch(parseAddress('Via Roma'), parseAddress('Via Roma'))).toBe(false);
  });
});

describe('findSupplyAddress', () => {
  it('preferisce l’indirizzo di fornitura alla sede del fornitore', () => {
    const text = [
      'Accendi Luce & Gas',
      'Indirizzo di fatturazioneVia Nilde Iotti 11',
      'Via Trattati Comunitari Europei 1957-2007, n. 13 40127 Bologna',
      'VIA NILDE IOTTI 11 - 42015 CORREGGIO RE',
      'Indirizzo di fornitura: VIA NILDE IOTTI 11 - 42015 CORREGGIO RE',
    ].join('\n');
    expect(findSupplyAddress(text)).toBe('VIA NILDE IOTTI 11 - 42015 CORREGGIO RE');
  });

  it('senza etichetta sceglie l’indirizzo che si ripete', () => {
    const text = [
      'Sede: Via Trattati Comunitari Europei 13 40127 Bologna',
      'VIA NILDE IOTTI 11',
      'Mario Rossi',
      'Via Nilde Iotti 11 42015 Correggio RE',
    ].join('\n');
    expect(findSupplyAddress(text)).toBe('Via Nilde Iotti 11 42015 Correggio RE');
  });

  it('trova l’indirizzo attaccato all’etichetta (testo estratto senza spazi)', () => {
    const text = 'Punto di fornitura (pdf): 0803502010696309\nIndirizzoVIA IOTTI N. 11   - 42015 Correggio RE';
    expect(findSupplyAddress(text)).toBe('VIA IOTTI N. 11 - 42015 Correggio RE');
  });

  it('null se non c’è nessun indirizzo con civico', () => {
    expect(findSupplyAddress('Totale da pagare 45,00\nScadenza 12/05/2026')).toBeNull();
  });
});

describe('householdName', () => {
  it('produce un nome leggibile', () => {
    expect(householdName('VIA NILDE IOTTI 11 - 42015 CORREGGIO RE')).toBe('Via Nilde Iotti 11, Correggio');
    expect(householdName('p.zza garibaldi n. 3a')).toBe('Piazza Garibaldi 3A');
  });
});
