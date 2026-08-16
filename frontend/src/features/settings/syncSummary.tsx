import { useTranslation } from 'react-i18next';
import { HTTPError } from 'ky';
import { AlertCircle, RefreshCw } from 'lucide-react';
import type { SyncResult } from './bankSyncApi';

/**
 * Riepilogo ed errori del sync bancario: condivisi tra `BankConnectionsCard`
 * (Impostazioni) e `BankReviewPage` (pulsante "Sincronizza ora" in header),
 * così l'esito ha lo stesso aspetto ovunque si avvii una sincronizzazione.
 */

/** Messaggio per un fallimento di sync: dedicato per la quota esaurita (429). */
export function syncErrorMessage(e: unknown): string {
  if (e instanceof HTTPError && e.response.status === 429) {
    return (
      e.message ||
      'Hai raggiunto il limite di sincronizzazioni manuali per oggi. Riprova domani, oppure attendi il prossimo sync automatico.'
    );
  }
  return e instanceof Error ? e.message : 'Errore durante la sincronizzazione.';
}

/** Riepilogo inline dopo un sync (manuale, tutta la card, un singolo conto o dalla revisione). */
export function SyncSummaryPanel({
  summary,
  onDismiss,
}: {
  summary: { results: SyncResult[]; quotaRemaining: number };
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const { results, quotaRemaining } = summary;

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-medium">
          <RefreshCw className="h-4 w-4" /> Risultato sincronizzazione
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Chiudi
        </button>
      </div>

      {results.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nessun conto con sincronizzazione attiva da aggiornare.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {results.map((r) => (
            <li
              key={r.linkId}
              className="flex flex-wrap items-center justify-between gap-2 rounded bg-background/60 px-2 py-1.5"
            >
              <span className="min-w-0 truncate font-medium">{r.accountName}</span>
              {r.error ? (
                <span className="flex items-center gap-1 text-xs text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {r.error}
                </span>
              ) : (
                <span className="flex flex-col items-end gap-0.5 text-right">
                  <span className="text-xs text-muted-foreground">
                    {t('bankSync.summary.fetched', { count: r.fetched })} · {r.staged} nuov
                    {r.staged === 1 ? 'o' : 'i'} · {r.duplicates} duplicat
                    {r.duplicates === 1 ? 'o' : 'i'}
                    {r.skippedCurrency > 0 && ` · ${r.skippedCurrency} valuta diversa`}
                  </span>
                  {!!r.skippedPending && (
                    <span
                      className="text-xs text-amber-600 dark:text-amber-400"
                      title={t('bankSync.summary.skippedPendingHint')}
                    >
                      {t('bankSync.summary.skippedPending', { count: r.skippedPending })}
                    </span>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        {quotaRemaining > 0
          ? `${quotaRemaining} sincronizzazion${quotaRemaining === 1 ? 'e' : 'i'} manual${
              quotaRemaining === 1 ? 'e' : 'i'
            } rimast${quotaRemaining === 1 ? 'a' : 'e'} oggi.`
          : 'Nessuna sincronizzazione manuale rimasta per oggi: riprova domani (i sync automatici continuano a funzionare).'}
      </p>
    </div>
  );
}
