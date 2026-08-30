import { EnableBankingProvider } from './enable-banking.provider';
import { EnableBankingClient } from './enable-banking.client';

/**
 * Paginazione dei movimenti: seguire `continuation_key` "fino a esaurimento"
 * presuppone che la banca prima o poi smetta di mandarne uno. Trade Republic
 * non lo fa — rimanda lo **stesso** cursore anche sull'ultima pagina — e senza
 * un freno il ciclo ri-scarica la stessa pagina fino al cap, moltiplicando ogni
 * movimento per 50. Le righe non hanno `entry_reference`, quindi il dedup a
 * valle le vede come movimenti distinti e la coda di revisione si riempie di
 * cloni. Questi test coprono i due modi in cui una banca può tenerci in loop:
 * cursore identico e cursore che cambia ma serve la stessa pagina.
 */
describe('EnableBankingProvider.fetchTransactions', () => {
  /** Una riga contabilizzata come la manda Trade Republic: nessun identificativo. */
  function bookedRow(amount: string) {
    return {
      status: 'BOOK',
      booking_date: '2026-08-26',
      value_date: null,
      entry_reference: null,
      transaction_amount: { amount, currency: 'EUR' },
      credit_debit_indicator: 'CRDT',
      remittance_information: null,
    };
  }

  function providerWith(pages: Record<string, unknown>[]) {
    const calls: (string | undefined)[] = [];
    let next = 0;
    const client = {
      listTransactions: jest.fn(
        (_uid: string, params: { continuationKey?: string } = {}) => {
          calls.push(params.continuationKey);
          const page = pages[Math.min(next, pages.length - 1)];
          next++;
          return Promise.resolve(page);
        },
      ),
    } as unknown as EnableBankingClient;
    return { provider: new EnableBankingProvider(client), client, calls };
  }

  it('scarica una sola volta un movimento quando la banca rimanda sempre lo stesso cursore', async () => {
    // Trade Republic: una pagina sola, un movimento, `continuation_key` fisso.
    const { provider, client } = providerWith([
      { transactions: [bookedRow('5000.000000')], continuation_key: 'ck-1' },
    ]);

    const res = await provider.fetchTransactions('acc-uid');

    expect(res.transactions).toHaveLength(1);
    expect(res.transactions[0].amount).toBe('5000.000000');
    // Il cursore non è avanzato: ci si ferma subito, senza bruciare 50 chiamate
    // alla banca (che pesano sui limiti PSD2).
    expect(client.listTransactions).toHaveBeenCalledTimes(2);
  });

  it('si ferma quando il cursore cambia ma la pagina è la stessa già vista', async () => {
    // Variante: cursore sempre nuovo, contenuto identico. Il cap sul cursore da
    // solo non basterebbe, serve riconoscere la pagina.
    let seq = 0;
    const client = {
      listTransactions: jest.fn(() =>
        Promise.resolve({
          transactions: [bookedRow('1000.000000')],
          continuation_key: `ck-${seq++}`,
        }),
      ),
    } as unknown as EnableBankingClient;
    const provider = new EnableBankingProvider(client);

    const res = await provider.fetchTransactions('acc-uid');

    expect(res.transactions).toHaveLength(1);
    expect(client.listTransactions).toHaveBeenCalledTimes(2);
  });

  it('segue la paginazione vera fino a esaurimento del cursore', async () => {
    // Il caso sano non deve regredire: pagine diverse, cursore che avanza e poi
    // sparisce.
    const { provider, calls } = providerWith([
      { transactions: [bookedRow('10.00')], continuation_key: 'ck-1' },
      { transactions: [bookedRow('20.00')], continuation_key: 'ck-2' },
      { transactions: [bookedRow('30.00')] },
    ]);

    const res = await provider.fetchTransactions('acc-uid');

    expect(res.transactions.map((t) => t.amount)).toEqual(['10.00', '20.00', '30.00']);
    expect(calls).toEqual([undefined, 'ck-1', 'ck-2']);
  });

  it('conta i non contabilizzati senza metterli tra i movimenti', async () => {
    const { provider } = providerWith([
      {
        transactions: [bookedRow('10.00'), { ...bookedRow('99.00'), status: 'PDNG' }],
      },
    ]);

    const res = await provider.fetchTransactions('acc-uid');

    expect(res.transactions).toHaveLength(1);
    expect(res.skippedPending).toBe(1);
    expect(res.statusCounts).toEqual({ BOOK: 1, PDNG: 1 });
  });
});
