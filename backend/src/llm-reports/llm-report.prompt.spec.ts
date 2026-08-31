import { buildReportPrompt, formatEuro, type ReportSnapshot } from './llm-report.prompt';

const snapshot: ReportSnapshot = {
  scope: 'monthly',
  label: 'luglio 2026',
  previousLabel: 'giugno 2026',
  accountsLabel: 'tutti i conti',
  totals: { incomeCents: '250000', expenseCents: '-180000', netCents: '70000', txCount: 42 },
  previousTotals: { incomeCents: '250000', expenseCents: '-150000', netCents: '100000', txCount: 38 },
  series: [
    { label: '01', incomeCents: '0', expenseCents: '-5000' },
    { label: '02', incomeCents: '250000', expenseCents: '-1000' },
  ],
  expenseTree: [
    {
      categoryIds: ['c1'],
      categoryName: 'Casa',
      color: null,
      amountCents: '90000',
      count: 5,
      children: [
        {
          categoryIds: ['c2'],
          categoryName: 'Affitto',
          color: null,
          amountCents: '80000',
          count: 1,
          children: [],
        },
      ],
    },
  ],
  incomeTree: [
    {
      categoryIds: ['c3'],
      categoryName: 'Stipendio',
      color: null,
      amountCents: '250000',
      count: 1,
      children: [],
    },
  ],
  topExpenses: [
    { date: '2026-07-02', description: 'Affitto luglio', amountCents: '-80000', categoryName: 'Affitto' },
    { date: '2026-07-15', description: null, amountCents: '-12000', categoryName: null },
  ],
};

describe('formatEuro', () => {
  it('converte i centesimi in euro con due decimali', () => {
    expect(formatEuro('250000')).toBe('2500.00 €');
  });

  it('mostra le uscite in valore assoluto', () => {
    expect(formatEuro('-180000')).toBe('1800.00 €');
  });

  it('regge importi oltre il limite di Number senza perdere precisione', () => {
    expect(formatEuro('900719925474099100')).toBe('9007199254740991.00 €');
  });
});

describe('buildReportPrompt', () => {
  const prompt = buildReportPrompt(snapshot);

  it('dice al modello di che periodo e di quali conti si tratta', () => {
    expect(prompt).toContain('luglio 2026');
    expect(prompt).toContain('tutti i conti');
  });

  it('include totali del periodo e del periodo precedente per il confronto', () => {
    expect(prompt).toContain('2500.00 €');
    expect(prompt).toContain('1800.00 €');
    expect(prompt).toContain('giugno 2026');
  });

  it('include le categorie di uscita con le sottocategorie', () => {
    expect(prompt).toContain('Casa');
    expect(prompt).toContain('Affitto');
  });

  it('include le entrate per categoria', () => {
    expect(prompt).toContain('Stipendio');
  });

  it('include i movimenti più grandi, con un segnaposto se manca la descrizione', () => {
    expect(prompt).toContain('Affitto luglio');
    expect(prompt).toContain('(senza descrizione)');
  });

  it('non passa al modello gli id interni', () => {
    expect(prompt).not.toContain('c1');
    expect(prompt).not.toContain('c3');
  });

  it('chiede le sezioni previste, in italiano e in markdown', () => {
    for (const section of [
      'Sintesi',
      'Andamento',
      'Dove sono finiti i soldi',
      'Cosa mi ha colpito',
      'Consigli',
    ]) {
      expect(prompt).toContain(section);
    }
    expect(prompt.toLowerCase()).toContain('markdown');
  });

  it('vieta immagini e link, che il frontend dovrebbe poi neutralizzare', () => {
    expect(prompt.toLowerCase()).toContain('nessun link');
  });
});

describe('buildReportPrompt con un prompt di base personalizzato', () => {
  const custom = 'Scrivi come un commercialista brontolone e parla solo di risparmio.';
  const prompt = buildReportPrompt(snapshot, custom);

  it('usa il testo dell_utente come apertura', () => {
    expect(prompt.startsWith(custom)).toBe(true);
  });

  it('non lascia in giro l_apertura predefinita', () => {
    expect(prompt).not.toContain("Sei l'assistente finanziario");
  });

  it('mantiene comunque i dati del periodo', () => {
    expect(prompt).toContain('luglio 2026');
    expect(prompt).toContain('2500.00 €');
    expect(prompt).toContain('Affitto luglio');
  });

  it('mantiene le regole non negoziabili di formato e di verità', () => {
    expect(prompt.toLowerCase()).toContain('markdown');
    expect(prompt.toLowerCase()).toContain('nessun link');
    expect(prompt).toContain('non inventare');
  });

  it('un prompt vuoto o di soli spazi equivale a nessun prompt', () => {
    expect(buildReportPrompt(snapshot, '   ')).toBe(buildReportPrompt(snapshot));
    expect(buildReportPrompt(snapshot, '')).toBe(buildReportPrompt(snapshot));
  });
});
