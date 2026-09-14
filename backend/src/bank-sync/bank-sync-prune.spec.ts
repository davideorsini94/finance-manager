import { TransactionType } from '@prisma/client';
import { SyncEngineService } from './sync-engine.service';
import { signedAmountForType } from './bank-review.service';

/**
 * Due difetti visti in produzione sul conto Trade Republic, entrambi con la
 * stessa riga da 5.000 € del 26/08.
 */

describe('pruneIgnored: la riga ignorata è la lapide che impedisce il ritorno', () => {
  /** Il `where` che `pruneIgnored` passa a Prisma. */
  interface PruneWhere {
    linkId: string;
    status: string;
    effectiveDate: { lt: Date };
    dedupHash?: { notIn: string[] };
  }

  function build() {
    const deleteMany = jest.fn(async (_args: { where: PruneWhere }) => ({ count: 0 }));
    const prisma = { bankStagedTransaction: { deleteMany } };
    const service = new SyncEngineService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const prune = (cursor: Date | null, seen: Set<string>) =>
      (service as unknown as {
        pruneIgnored(link: { id: string }, cursor: Date | null, seen: Set<string>): Promise<void>;
      }).pruneIgnored({ id: 'link-tr' }, cursor, seen);
    const whereOfFirstCall = (): PruneWhere => {
      const call = deleteMany.mock.calls[0];
      if (!call) throw new Error('deleteMany non è stata chiamata');
      return call[0].where;
    };
    return { prune, deleteMany, whereOfFirstCall };
  }

  it('NON cancella una riga ignorata che la banca ha appena rimandato', async () => {
    // Trade Republic ignora `date_from` e continua a restituire il movimento
    // del 26/08 anche con il cursore al 11/09. Cancellare la riga ignorata
    // toglie l'unica memoria del "no" dell'utente (indice unico
    // link_id+dedup_hash), e il sync successivo la rimette in coda: è il ciclo
    // ignori → viene cancellata → torna.
    const { prune, whereOfFirstCall } = build();
    await prune(new Date('2026-09-11T00:00:00Z'), new Set(['hash-5000', 'hash-altro']));

    expect(whereOfFirstCall().dedupHash).toEqual({ notIn: ['hash-5000', 'hash-altro'] });
  });

  it('cancella comunque gli ignorati che la banca non manda più', async () => {
    // Banca che rispetta `date_from`: le righe vecchie non compaiono nel
    // fetch, quindi la pulizia continua a fare il suo lavoro.
    const { prune, whereOfFirstCall } = build();
    await prune(new Date('2026-09-11T00:00:00Z'), new Set(['hash-recente']));

    const where = whereOfFirstCall();
    expect(where.linkId).toBe('link-tr');
    expect(where.status).toBe('ignored');
    // Cutoff = cursore − 7 giorni di sovrapposizione.
    expect(where.effectiveDate.lt.toISOString().slice(0, 10)).toBe('2026-09-04');
  });

  it('con un fetch vuoto non vincola niente: nessun hash da preservare', async () => {
    const { prune, whereOfFirstCall } = build();
    await prune(new Date('2026-09-11T00:00:00Z'), new Set());

    expect(whereOfFirstCall().dedupHash).toBeUndefined();
  });

  it('senza cursore non cancella niente', async () => {
    const { prune, deleteMany } = build();
    await prune(null, new Set(['hash-x']));
    expect(deleteMany).not.toHaveBeenCalled();
  });
});

describe('signedAmountForType: forzare il tipo deve cambiare il segno', () => {
  it('forzata a uscita, un accredito della banca diventa negativo', () => {
    // È il caso della riga da +5.000 su Trade Republic: a schermo il frontend
    // mostra già −5.000, ma il movimento veniva creato con il segno grezzo
    // della banca e il saldo SALIVA di 5.000.
    expect(signedAmountForType(TransactionType.expense, 500000n)).toBe(-500000n);
  });

  it('forzata a entrata, un addebito della banca diventa positivo', () => {
    expect(signedAmountForType(TransactionType.income, -4259n)).toBe(4259n);
  });

  it('lascia stare il segno quando combacia già col tipo', () => {
    expect(signedAmountForType(TransactionType.expense, -4259n)).toBe(-4259n);
    expect(signedAmountForType(TransactionType.income, 500000n)).toBe(500000n);
  });
});
