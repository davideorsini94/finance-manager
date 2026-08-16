import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import { Upload, ArrowRight, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CategoryPicker } from '@/components/shared/CategoryPicker';
import { accountsApi } from '@/features/accounts/accountsApi';
import { sortByName } from '@/lib/utils/sort';
import { categoriesApi } from '@/features/categories/categoriesApi';
import { formatCents } from '@/lib/utils/currency';
import { formatDate } from '@/lib/utils/date';
import { importApi, type ConfirmRow, type ImportBatch } from './importApi';
import { useConfirm } from '@/components/shared/confirm';

type Step = 'upload' | 'review' | 'done';

export function ImportPage() {
  const queryClient = useQueryClient();
  const askConfirm = useConfirm();
  const [step, setStep] = useState<Step>('upload');
  const [accountId, setAccountId] = useState<string>('');
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [decisions, setDecisions] = useState<Record<number, ConfirmRow>>({});
  const [uploadError, setUploadError] = useState<string | null>(null);

  const accountsQuery = useQuery({ queryKey: ['accounts'], queryFn: () => accountsApi.list() });
  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list(),
  });

  const upload = useMutation({
    mutationFn: ({ file, accountId: aId }: { file: File; accountId: string }) =>
      importApi.upload(aId, file),
    onSuccess: (b) => {
      setBatch(b);
      const initial: Record<number, ConfirmRow> = {};
      for (const row of b.rawPreview) {
        initial[row.index] = {
          index: row.index,
          accepted: !row.duplicate,
          categoryId: row.suggestedCategoryId ?? null,
        };
      }
      setDecisions(initial);
      setStep('review');
      setUploadError(null);
    },
    onError: (e) => setUploadError((e as Error).message),
  });

  const confirm = useMutation({
    mutationFn: () =>
      importApi.confirm(batch!.id, Object.values(decisions)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setStep('done');
    },
  });

  const reject = useMutation({
    mutationFn: () => importApi.reject(batch!.id),
    onSuccess: () => {
      setBatch(null);
      setStep('upload');
    },
  });

  const onDrop = (files: File[]) => {
    if (!accountId || files.length === 0) return;
    upload.mutate({ file: files[0], accountId });
  };

  const dropzone = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'application/x-ofx': ['.ofx', '.qfx'],
      'application/octet-stream': ['.ofx', '.qfx', '.csv'],
    },
    maxSize: 5 * 1024 * 1024,
    multiple: false,
    disabled: !accountId || upload.isPending,
  });

  if (step === 'done') {
    return (
      <div className="space-y-6 max-w-xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Check className="h-5 w-5 text-emerald-500" />
              Import completato
            </CardTitle>
            <CardDescription>I movimenti sono stati creati.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => {
                setBatch(null);
                setDecisions({});
                setStep('upload');
              }}
            >
              Nuovo import
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 'review' && batch) {
    const acceptedCount = Object.values(decisions).filter((d) => d.accepted).length;
    // Le categorie sono generiche (no più income/expense): una sola lista
    // viene mostrata dal CategoryPicker indipendentemente dal segno della riga.
    const allCategories = categoriesQuery.data ?? [];

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Conferma import</h1>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={async () => {
                const ok = await askConfirm({
                  title: 'Annullare l\'import?',
                  description: 'Le righe parsate verranno scartate e nessun movimento sarà creato.',
                  confirmLabel: 'Annulla import',
                  destructive: true,
                });
                if (ok) reject.mutate();
              }}
              disabled={reject.isPending}
            >
              <X className="h-4 w-4 mr-2" /> Annulla
            </Button>
            <Button
              onClick={async () => {
                const ok = await askConfirm({
                  title: `Importare ${acceptedCount} ${acceptedCount === 1 ? 'movimento' : 'movimenti'}?`,
                  description:
                    'Entreranno nei tuoi movimenti e aggiorneranno i saldi dei conti. Per annullarli dovrai cancellarli uno per uno.',
                  confirmLabel: 'Importa',
                });
                if (!ok) return;
                confirm.mutate();
              }}
              disabled={confirm.isPending || acceptedCount === 0}
            >
              <Check className="h-4 w-4 mr-2" /> Importa {acceptedCount}
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-2 w-8"></th>
                  <th className="p-2">Data</th>
                  <th className="p-2">Descrizione</th>
                  <th className="p-2">Importo</th>
                  <th className="p-2">Categoria suggerita</th>
                </tr>
              </thead>
              <tbody>
                {batch.rawPreview.map((row) => {
                  const dec = decisions[row.index];
                  const isIncome = row.amountCents >= 0;
                  return (
                    <tr key={row.index} className="border-t">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={dec?.accepted ?? false}
                          onChange={(e) =>
                            setDecisions((s) => ({
                              ...s,
                              [row.index]: { ...s[row.index], accepted: e.target.checked },
                            }))
                          }
                        />
                      </td>
                      <td className="p-2 whitespace-nowrap">{formatDate(row.date)}</td>
                      <td className="p-2 max-w-xs">
                        <p className="truncate">{row.description}</p>
                        {row.duplicate && (
                          <Badge variant="outline" className="mt-0.5">
                            Possibile duplicato
                          </Badge>
                        )}
                      </td>
                      <td
                        className={`p-2 font-semibold tabular-nums whitespace-nowrap ${
                          isIncome ? 'text-emerald-600' : 'text-red-600'
                        }`}
                      >
                        {formatCents(row.amountCents)}
                      </td>
                      <td className="p-2 min-w-[200px]">
                        <CategoryPicker
                          value={dec?.categoryId ?? null}
                          onChange={(v) =>
                            setDecisions((s) => ({
                              ...s,
                              [row.index]: { ...s[row.index], categoryId: v },
                            }))
                          }
                          categories={allCategories}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
        {confirm.isError && (
          <p className="text-sm text-destructive">{(confirm.error as Error).message}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Importa movimenti</h1>
        <p className="text-sm text-muted-foreground">
          Carica un estratto conto in formato CSV o OFX. L'AI suggerirà la categoria, tu confermi.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Conto di destinazione</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger>
              <SelectValue placeholder="Seleziona conto" />
            </SelectTrigger>
            <SelectContent>
              {sortByName(accountsQuery.data ?? []).map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. File da importare</CardTitle>
          <CardDescription>CSV o OFX/QFX, max 5 MB</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            {...dropzone.getRootProps()}
            className={`flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-8 text-sm transition ${
              dropzone.isDragActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
            } ${!accountId ? 'opacity-50' : 'cursor-pointer hover:bg-accent/40'}`}
          >
            <input {...dropzone.getInputProps()} />
            <Upload className="h-6 w-6" />
            {!accountId ? (
              <p>Seleziona prima un conto</p>
            ) : upload.isPending ? (
              <p>Analisi in corso… (l'AI sta suggerendo le categorie)</p>
            ) : (
              <p>Trascina il file qui o clicca per scegliere</p>
            )}
          </div>
          {uploadError && <p className="mt-2 text-sm text-destructive">{uploadError}</p>}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
        <ArrowRight className="h-3 w-3" />
        Dopo il caricamento potrai rivedere e confermare ogni movimento prima dell'import.
      </p>
    </div>
  );
}
