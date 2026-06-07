import { useEffect, useMemo, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { File as FileIcon, ImageIcon, FileText, Trash2, Upload } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CategoryPicker } from '@/components/shared/CategoryPicker';
import { AttachmentUploader } from '@/components/shared/AttachmentUploader';
import { eurosToCents } from '@/lib/utils/currency';
import { todayIso } from '@/lib/utils/date';
import { sortByName } from '@/lib/utils/sort';
import { useAuth } from '@/features/auth/useAuth';
import type { Account, Category, Transaction } from '@/types/domain';
import { accountsApi } from '@/features/accounts/accountsApi';
import { categoriesApi } from '@/features/categories/categoriesApi';
import { transactionsApi } from './transactionsApi';
import { attachmentsApi } from './attachmentsApi';

const schema = z
  .object({
    type: z.enum(['expense', 'income', 'transfer']),
    accountId: z.string().uuid(),
    toAccountId: z.string().uuid().optional(),
    amount: z.coerce.number().positive(),
    transactionDate: z.string().min(1),
    arrivalDate: z.string().optional(),
    categoryId: z.string().uuid().optional().nullable(),
    description: z.string().max(500).optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine(
    (d) => d.type !== 'transfer' || (!!d.toAccountId && d.toAccountId !== d.accountId),
    { message: 'Conto destinazione richiesto e diverso', path: ['toAccountId'] },
  );

type FormValues = z.input<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction?: Transaction | null;
  /** Conto da preselezionare in creazione (es. filtro conto attivo nella
   *  lista movimenti). Ha priorità sul conto preferito dell'utente. */
  defaultAccountId?: string | null;
}

export function TransactionForm({ open, onOpenChange, transaction, defaultAccountId }: Props) {
  const isEdit = !!transaction;
  const isTransfer = transaction?.type === 'transfer' || !!transaction?.transferPairId;
  const queryClient = useQueryClient();
  const currentUser = useAuth((s) => s.user);
  const [createdId, setCreatedId] = useState<string | null>(null);
  /** File scelti dall'utente in fase di creazione, da uppare DOPO che la
   *  transazione è stata creata e ne abbiamo l'id. */
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingError, setPendingError] = useState<string | null>(null);

  const accountsQuery = useQuery({ queryKey: ['accounts'], queryFn: () => accountsApi.list() });
  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list(),
  });

  // NB: useMemo OBBLIGATORIO. `accounts` è nelle deps del useEffect sotto:
  // se ricreassimo l'array ad ogni render → loop infinito (#185).
  const accounts: Account[] = useMemo(
    () => sortByName(accountsQuery.data ?? []),
    [accountsQuery.data],
  );
  const categories: Category[] = categoriesQuery.data ?? [];

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: 'expense',
      accountId: '',
      // Empty al primo render: l'Input mostra il placeholder "0,00" invece
      // di uno "0" preimpostato che l'utente dovrebbe cancellare prima di
      // digitare. In edit mode il reset più sotto sovrascrive col valore reale.
      amount: '' as unknown as number,
      transactionDate: todayIso(),
    },
  });

  useEffect(() => {
    if (open) {
      setPendingFiles([]);
      setPendingError(null);
      if (transaction) {
        const absCents = Math.abs(Number(transaction.amountCents));
        const inferredType =
          transaction.type === 'transfer'
            ? 'transfer'
            : Number(transaction.amountCents) >= 0
              ? 'income'
              : 'expense';
        reset({
          type: inferredType,
          accountId: transaction.accountId,
          amount: absCents / 100,
          transactionDate: transaction.transactionDate.slice(0, 10),
          categoryId: transaction.categoryId,
          description: transaction.description ?? '',
          notes: transaction.notes ?? '',
        });
        setCreatedId(transaction.id);
      } else {
        // In creazione la priorità è: 1) conto passato dal chiamante (es.
        // filtro conto attivo nella lista movimenti), 2) "conto preferito"
        // dell'utente loggato (campo `favoriteAccountId` su /users/me),
        // 3) primo conto disponibile. I primi due valgono solo se il conto
        // è ancora accessibile (es. non archiviato).
        const isAccessible = (id?: string | null): id is string =>
          !!id && accounts.some((a) => a.id === id);
        const fav = currentUser?.favoriteAccountId;
        const initialAccountId = isAccessible(defaultAccountId)
          ? defaultAccountId
          : isAccessible(fav)
            ? fav
            : (accounts[0]?.id ?? '');
        reset({
          type: 'expense',
          accountId: initialAccountId,
          amount: '' as unknown as number,
          transactionDate: todayIso(),
          categoryId: null,
          description: '',
          notes: '',
        });
        setCreatedId(null);
      }
    }
  }, [open, transaction, reset, accounts, currentUser?.favoriteAccountId, defaultAccountId]);

  const type = watch('type');
  const accountId = watch('accountId');
  const toAccountId = watch('toAccountId');

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const cents = eurosToCents(Number(values.amount));
      if (values.type === 'transfer') {
        if (isEdit) throw new Error('Edit transfer not yet supported, please delete and recreate.');
        const result = await transactionsApi.createTransfer({
          fromAccountId: values.accountId,
          toAccountId: values.toAccountId!,
          amountCents: cents,
          date: values.transactionDate,
          arrivalDate: values.arrivalDate || undefined,
          description: values.description || undefined,
          categoryId: values.categoryId ?? undefined,
        });
        return result.from;
      }
      const payload = {
        amountCents: cents,
        type: values.type as 'income' | 'expense',
        categoryId: values.categoryId ?? undefined,
        description: values.description || undefined,
        notes: values.notes || undefined,
        transactionDate: values.transactionDate,
      };
      if (isEdit && transaction) {
        return transactionsApi.update(transaction.id, payload);
      }
      return transactionsApi.create({ ...payload, accountId: values.accountId });
    },
    onSuccess: async (created) => {
      setCreatedId(created.id);
      // Se in fase di creazione l'utente ha aggiunto file, uppali ora
      // (uno alla volta, sequenziali per non saturare la connessione).
      if (!isEdit && pendingFiles.length > 0 && created.id) {
        for (const f of pendingFiles) {
          try {
            await attachmentsApi.upload(created.id, f);
          } catch (e) {
            setPendingError(`Upload "${f.name}" fallito: ${(e as Error).message}`);
          }
        }
        void queryClient.invalidateQueries({ queryKey: ['attachments', created.id] });
      }
      // refetchType: 'all' rifette subito tutte le query (anche quelle non
      // più montate). Combinato con `staleTime: 0` su AccountsPage e
      // DashboardPage, questo basta per garantire dati freschi ovunque.
      // NB: NON usare `removeQueries` qui — produce loop di re-render
      // perché TransactionForm ha un observer attivo su ['accounts'].
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['transactions'], refetchType: 'all' }),
        queryClient.invalidateQueries({ queryKey: ['accounts'], refetchType: 'all' }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'], refetchType: 'all' }),
        queryClient.invalidateQueries({ queryKey: ['recurring'], refetchType: 'all' }),
        queryClient.invalidateQueries({ queryKey: ['budgets'], refetchType: 'all' }),
        queryClient.invalidateQueries({ queryKey: ['goals'], refetchType: 'all' }),
      ]);
      // Se c'è stato un errore di upload, lascia la modale aperta così
      // l'utente vede l'errore e può ritentare.
      if (!pendingError) onOpenChange(false);
    },
  });

  const onSubmit = handleSubmit((values) => mutation.mutate(values));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] w-full max-w-xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{isEdit ? 'Modifica movimento' : 'Nuovo movimento'}</DialogTitle>
          <DialogDescription>
            Entrata, uscita o giroconto tra conti gestiti.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select
              value={type}
              onValueChange={(v) => setValue('type', v as FormValues['type'])}
              disabled={isEdit}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Uscita</SelectItem>
                <SelectItem value="income">Entrata</SelectItem>
                <SelectItem value="transfer">Giroconto</SelectItem>
              </SelectContent>
            </Select>
            {isTransfer && isEdit && (
              <p className="text-xs text-muted-foreground">
                I giroconti vanno eliminati e ricreati per modifiche.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Conto {type === 'transfer' ? 'sorgente' : ''}</Label>
              <Select
                value={accountId}
                onValueChange={(v) => setValue('accountId', v)}
                disabled={isEdit}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona conto" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount">Importo (€)</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0,00"
                {...register('amount')}
                aria-invalid={!!errors.amount}
              />
            </div>
          </div>

          {type === 'transfer' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Conto destinazione</Label>
                <Select
                  value={toAccountId ?? ''}
                  onValueChange={(v) => setValue('toAccountId', v, { shouldValidate: true })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleziona conto" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts
                      .filter((a) => a.id !== accountId)
                      .map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {errors.toAccountId && (
                  <p className="text-xs text-destructive">{errors.toAccountId.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="arrivalDate">Data arrivo (opz.)</Label>
                <Input id="arrivalDate" type="date" {...register('arrivalDate')} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="transactionDate">Data</Label>
              <Input
                id="transactionDate"
                type="date"
                {...register('transactionDate')}
                aria-invalid={!!errors.transactionDate}
              />
            </div>
            <div className="space-y-2">
              <Label>Categoria{type === 'transfer' ? ' (opz.)' : ''}</Label>
              {/* Categorie generiche: lo stesso picker mostra tutte le
                  categorie indipendentemente dal tipo di movimento. */}
              <CategoryPicker
                value={watch('categoryId') ?? null}
                onChange={(v) => setValue('categoryId', v)}
                categories={categories}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descrizione</Label>
            <Input id="description" {...register('description')} />
          </div>

          {type !== 'transfer' && (
            <div className="space-y-2">
              <Label htmlFor="notes">Note</Label>
              <Textarea id="notes" rows={3} {...register('notes')} />
            </div>
          )}

          {/* Allegati: in modifica usiamo AttachmentUploader (server side);
              in creazione raccogliamo i file localmente e li uppiamo dopo
              che la transazione è stata creata, dentro la stessa onSuccess. */}
          {type !== 'transfer' && (
            <div className="space-y-2">
              <Label>Allegati</Label>
              {isEdit && createdId ? (
                <AttachmentUploader transactionId={createdId} />
              ) : (
                <PendingAttachmentsField
                  files={pendingFiles}
                  onChange={setPendingFiles}
                  uploading={mutation.isPending}
                />
              )}
              {pendingError && (
                <p className="text-xs text-destructive">{pendingError}</p>
              )}
            </div>
          )}

          {mutation.isError && (
            <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
          )}
          </div>

          <DialogFooter className="border-t bg-background px-6 py-3 sm:space-x-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Chiudi
            </Button>
            <Button type="submit" disabled={isSubmitting || mutation.isPending}>
              {createdId ? 'Aggiorna' : 'Crea'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------ */
/* Allegati pendenti — selezionati dall'utente in fase di creazione, uppati */
/* dopo che la transazione è stata creata (riusiamo `attachmentsApi.upload` */
/* con il nuovo transactionId). Stessa UI/regole di AttachmentUploader      */
/* (drag&drop, immagini+pdf, max 10 MB).                                    */
/* ------------------------------------------------------------------------ */

interface PendingAttachmentsFieldProps {
  files: File[];
  onChange: (files: File[]) => void;
  uploading?: boolean;
}

const PENDING_ACCEPT = {
  'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif'],
  'application/pdf': ['.pdf'],
};

function PendingAttachmentsField({ files, onChange, uploading }: PendingAttachmentsFieldProps) {
  const onDrop = (accepted: File[]) => {
    if (accepted.length === 0) return;
    // De-duplica per nome+size+lastModified
    const key = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;
    const seen = new Set(files.map(key));
    const merged = [...files];
    for (const f of accepted) {
      if (!seen.has(key(f))) merged.push(f);
    }
    onChange(merged);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: PENDING_ACCEPT,
    maxSize: 10 * 1024 * 1024,
    disabled: uploading,
  });

  const remove = (idx: number) => onChange(files.filter((_, i) => i !== idx));

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed p-4 text-sm transition ${
          isDragActive
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/40'
        }`}
      >
        <input {...getInputProps()} />
        <Upload className="h-5 w-5 mb-2" />
        <p>Trascina file qui o clicca per scegliere</p>
        <p className="text-xs">Immagini o PDF, max 10 MB · uppati al salvataggio</p>
      </div>

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((f, i) => {
            const isImage = f.type.startsWith('image/');
            const isPdf = f.type === 'application/pdf';
            const Icon = isImage ? ImageIcon : isPdf ? FileText : FileIcon;
            return (
              <li key={`${f.name}-${i}`} className="flex items-center gap-3 rounded-md border p-2">
                <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm">{f.name}</p>
                  <p className="text-xs text-muted-foreground">{(f.size / 1024).toFixed(1)} KB</p>
                </div>
                {!uploading && (
                  <Button
                    size="icon"
                    variant="ghost"
                    type="button"
                    onClick={() => remove(i)}
                    aria-label="Rimuovi"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
