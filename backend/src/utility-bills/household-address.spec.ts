import { addressesMatch, findSupplyAddress, householdName, isMeterCode, parseAddress } from './household-address';

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
      number: '14a',
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
    // Con CAP su entrambi: uguali in modo rigoroso.
    const withCap = variants.slice(1);
    for (const a of withCap) for (const b of withCap) expect(addressesMatch(parseAddress(a), parseAddress(b))).toBe(true);
    // La variante senza CAP né città combacia solo in modalità permissiva
    // (usata quando c'è un'unica abitazione candidata).
    for (const b of withCap) expect(addressesMatch(parseAddress(variants[0]), parseAddress(b), { lenient: true })).toBe(true);
  });

  it('capisce i numeri nel nome della via e gli esponenti del civico', () => {
    expect(parseAddress('Via 4 Novembre 12, 42015 Correggio')).toMatchObject({ street: ['4', 'novembre'], number: '12' });
    expect(parseAddress('Via 1° Maggio 5')).toMatchObject({ street: ['1', 'maggio'], number: '5' });
    expect(parseAddress('Strada Statale 9 km 12')).toMatchObject({ number: 'km12' });
    expect(parseAddress('Via dei Mille 10 bis')).toMatchObject({ number: '10bis' });
    expect(parseAddress('Via Roma 1 int. 3, Milano')).toMatchObject({ number: '1', city: 'milano' });
  });

  it('distingue civici, CAP, città e vie diverse', () => {
    const base = parseAddress('Via Nilde Iotti 11 42015 Correggio');
    expect(addressesMatch(base, parseAddress('Via Nilde Iotti 13 42015 Correggio'))).toBe(false);
    expect(addressesMatch(base, parseAddress('Via Nilde Iotti 11 40127 Bologna'))).toBe(false);
    expect(addressesMatch(base, parseAddress('Via Roma 11 42015 Correggio'))).toBe(false);
    expect(addressesMatch(base, parseAddress('Piazza Nilde Iotti 11 42015 Correggio'))).toBe(false);
    expect(addressesMatch(parseAddress('Via Iotti 11 Correggio'), parseAddress('Via Iotti 11 Bologna'))).toBe(false);
    expect(addressesMatch(parseAddress('Via Roma 14/A Milano'), parseAddress('Via Roma 14/B Milano'))).toBe(false);
    expect(addressesMatch(parseAddress('Via Roma 14/A Milano'), parseAddress('Via Roma 14A Milano'))).toBe(true);
    expect(addressesMatch(parseAddress('Via dei Mille 10 bis Roma'), parseAddress('Via dei Mille 10 Roma'))).toBe(false);
    expect(addressesMatch(parseAddress('SS 9 km 12 Imola'), parseAddress('SS 9 km 40 Imola'))).toBe(false);
    expect(addressesMatch(parseAddress('Via Roma 1 int. 3, Milano'), parseAddress('Via Roma 1 Milano'))).toBe(true);
    expect(addressesMatch(parseAddress('Via Emilia 3 Reggio Emilia'), parseAddress("Via Emilia 3 Reggio nell'Emilia"))).toBe(true);
  });

  it('senza CAP né città su un lato non unisce, se non in modalità permissiva', () => {
    const bare = parseAddress('VIA NILDE IOTTI 11');
    const milano = parseAddress('Via Iotti 11 Milano');
    expect(addressesMatch(bare, milano)).toBe(false);
    expect(addressesMatch(bare, milano, { lenient: true })).toBe(true);
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

  it('la sede ripetuta nel piè di pagina non batte l’indirizzo del cliente', () => {
    const text = [
      'Intestatario Mario Rossi',
      'Via Nilde Iotti 11 42015 Correggio RE',
      'Via Molino Rosso 8 40026 Imola',
      'Via Molino Rosso 8 40026 Imola',
      'Via Molino Rosso 8 40026 Imola',
      'Fornitura in Via Nilde Iotti 11',
    ].join('\n');
    expect(findSupplyAddress(text)).toBe('Via Nilde Iotti 11 42015 Correggio RE');
  });

  it('trova anche Località con l’accento e le vie con numeri nel nome', () => {
    expect(findSupplyAddress('Indirizzo di fornitura: Località Boschetto 4, 42015 Correggio')).toBe(
      'Località Boschetto 4, 42015 Correggio',
    );
    expect(findSupplyAddress('Punto di fornitura Via 4 Novembre 12 42015 Correggio')).toBe('Via 4 Novembre 12 42015 Correggio');
  });

  it('null se non c’è nessun indirizzo con civico', () => {
    expect(findSupplyAddress('Totale da pagare 45,00\nScadenza 12/05/2026')).toBeNull();
  });
});

describe('isMeterCode', () => {
  it('riconosce solo POD e PDR', () => {
    expect(isMeterCode('IT001E48117852')).toBe(true);
    expect(isMeterCode('15441000220069')).toBe(true);
    expect(isMeterCode('0803502010696309')).toBe(false); // codice acqua: non è un contatore univoco
    expect(isMeterCode('812736455')).toBe(false);
  });
});

describe('householdName', () => {
  it('produce un nome leggibile', () => {
    expect(householdName('VIA NILDE IOTTI 11 - 42015 CORREGGIO RE')).toBe('Via Nilde Iotti 11, Correggio');
    expect(householdName('p.zza garibaldi n. 3a')).toBe('Piazza Garibaldi 3A');
    expect(householdName('Via Roma 1 int. 3, Milano')).toBe('Via Roma 1, Milano');
  });
});
