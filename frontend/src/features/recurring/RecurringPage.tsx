import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Plus,
  Play,
  Pause,
  Trash2,
  Repeat,
  Pencil,
  ArrowLeftRight,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
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
import { AccountMultiSelect } from '@/components/shared/AccountMultiSelect';
import { eurosToCents } from '@/lib/utils/currency';
import { MoneyAmount } from '@/components/shared/MoneyAmount';
import { formatDate, todayIso } from '@/lib/utils/date';
import { sortByName } from '@/lib/utils/sort';
import { accountsApi } from '@/features/accounts/accountsApi';
import { categoriesApi } from '@/features/categories/categoriesApi';
import { recurringApi, type RecurrenceFreq, type RecurringRule } from './recurringApi';
import { useConfirm } from '@/components/shared/confirm';

const FREQUENCIES: { value: RecurrenceFreq; label: string }[] = [
  { value: 'daily', label: 'Giornaliera' },
  { value: 'weekly', label: 'Settimanale' },
  { value: 'biweekly', label: 'Quindicinale' },
  { value: 'monthly', label: 'Mensile' },
  { value: 'quarterly', label: 'Trimestrale' },
  { value: 'yearly', label: 'Annuale' },
];

type FormType = 'expense' | 'income' | 'transfer';

const schema = z
  .object({
    accountId: z.string().uuid({ message: 'Seleziona un conto' }),
    toAccountId: z.string().uuid().optional().or(z.literal('')),
    categoryId: z.string().uuid().optional().or(z.literal('')),
    type: z.enum(['expense', 'income', 'transfer']),
    amount: z.coerce.number().positive(),
    frequency: z.enum(['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']),
    startDate: z.string().min(1, 'Data inizio richiesta'),
    endDate: z.string().optional().or(z.literal('')),
    description: z.string().max(500).optional(),
  })
  .refine(
    (d) => d.type !== 'transfer' || (!!d.toAccountId && d.toAccountId !== d.accountId),
    {
      message: 'Per i giroconti serve un conto destinazione diverso',
      path: ['toAccountId'],
    },
  );

type FormValues = z.input<typeof schema>;

export function RecurringPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringRule | null>(null);
  const [accountIds, setAccountIds] = useState<string[]>([]);

  const rulesQuery = useQuery({ queryKey: ['recurring'], queryFn: () => recurringApi.list() });
  const accountsQuery = useQuery({ queryKey: ['accounts'], queryFn: () => accountsApi.list() });
  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list(),
  });

  const accounts = sortByName(accountsQuery.data ?? []);
  const accountById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts],
  );
  const categories = categoriesQuery.data ?? [];
  const allRules = rulesQuery.data ?? [];
  // Filtro client-side: una regola "passa" se il suo conto sorgente o
  // destinazione (per giroconti) è tra quelli selezionati. Filtro vuoto =
  // tutte le regole.
  const rules = useMemo(() => {
    if (accountIds.length === 0) return allRules;
    const filterSet = new Set(accountIds);
    return allRules.filter(
      (r) => filterSet.has(r.account.id) || (r.toAccount && filterSet.has(r.toAccount.id)),
    );
  }, [allRules, accountIds]);

  const create = useMutation({
    mutationFn: (input: Parameters<typeof recurringApi.create>[0]) => recurringApi.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recurring'] });
      setFormOpen(false);
    },
  });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof recurringApi.update>[1] }) =>
      recurringApi.update(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recurring'] });
      setFormOpen(false);
      setEditing(null);
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      recurringApi.update(id, { isActive }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['recurring'] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => recurringApi.remove(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['recurring'] }),
  });
  const runNow = useMutation({
    mutationFn: () => recurringApi.runNow(),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['recurring'] });
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
      alert(`Generate ${r.generated} transazioni`);
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      accountId: '',
      toAccountId: '',
      categoryId: '',
      type: 'expense',
      amount: '' as unknown as number,
      frequency: 'monthly',
      startDate: todayIso(),
      endDate: '',
      description: '',
    },
  });

  // Quando cambia rule in editing o si apre la modale: ricarica i campi.
  useEffect(() => {
    if (!formOpen) return;
    if (editing) {
      reset({
        accountId: editing.accountId,
        toAccountId: editing.toAccountId ?? '',
        categoryId: editing.categoryId ?? '',
        type: editing.type as FormType,
        amount: Number(editing.amountCents) / 100,
        frequency: editing.frequency,
        startDate: editing.startDate.slice(0, 10),
        endDate: editing.endDate ? editing.endDate.slice(0, 10) : '',
        description: editing.description ?? '',
      });
    } else {
      reset({
        accountId: accounts[0]?.id ?? '',
        toAccountId: '',
        categoryId: '',
        type: 'expense',
        amount: '' as unknown as number,
        frequency: 'monthly',
        startDate: todayIso(),
        endDate: '',
        description: '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formOpen, editing]);

  const type = watch('type') as FormType;
  const accountId = watch('accountId');
  const toAccountId = watch('toAccountId');
  const startDate = watch('startDate');
  const endDate = watch('endDate');

  const onSubmit = handleSubmit((values) => {
    const payload = {
      accountId: values.accountId,
      toAccountId:
        values.type === 'transfer' ? (values.toAccountId || undefined) : undefined,
      // La categoria è opzionale anche per i giroconti: se passata, viene
      // applicata a entrambe le transazioni paired in `executeTransfer`.
      categoryId: values.categoryId || undefined,
      amountCents: eurosToCents(Number(values.amount)),
      type: values.type,
      description: values.description || undefined,
      frequency: values.frequency as RecurrenceFreq,
      startDate: values.startDate,
      endDate: values.endDate || undefined,
    };
    if (editing) {
      update.mutate({
        id: editing.id,
        data: {
          accountId: payload.accountId,
          toAccountId: values.type === 'transfer' ? payload.toAccountId : null,
          categoryId: payload.categoryId ?? null,
          amountCents: payload.amountCents,
          type: payload.type,
          description: payload.description,
          frequency: payload.frequency,
          startDate: payload.startDate,
          endDate: payload.endDate ?? null,
        },
      });
    } else {
      create.mutate(payload);
    }
  });

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (r: RecurringRule) => {
    setEditing(r);
    setFormOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Movimenti ricorrenti</h1>
        <div className="flex flex-wrap items-center gap-2">
          <AccountMultiSelect
            accounts={accounts}
            value={accountIds}
            onChange={setAccountIds}
          />
          <Button
            variant="outline"
            onClick={async () => {
              // Genera in blocco TUTTI i movimenti scaduti di TUTTE le regole:
              // per disfarli vanno cancellati uno per uno.
              const ok = await confirm({
                title: 'Eseguire ora le ricorrenze?',
                description:
                  'Verranno generati tutti i movimenti ricorrenti scaduti fino a oggi: entreranno nei tuoi movimenti e aggiorneranno i saldi. Per annullarli dovrai cancellarli uno per uno.',
                confirmLabel: 'Esegui',
              });
              if (!ok) return;
              runNow.mutate();
            }}
            disabled={runNow.isPending}
          >
            <Repeat className="h-4 w-4 mr-2" /> Esegui ora
          </Button>
          <Button onClick={openNew}>
            <Plus className="h-4 w-4 mr-2" /> Nuova
          </Button>
        </div>
      </div>

      {rules.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nessuna regola ricorrente. Aggiungi stipendio, affitto, abbonamenti, giroconti
            automatici verso il conto risparmio…
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rules.map((r) => {
            const freq = FREQUENCIES.find((f) => f.value === r.frequency)?.label ?? r.frequency;
            const isTransfer = r.type === 'transfer';
            const tone = isTransfer
              ? 'text-muted-foreground'
              : r.type === 'income'
                ? 'text-emerald-600'
                : 'text-red-600';
            const Icon = isTransfer
              ? ArrowLeftRight
              : r.type === 'income'
                ? ArrowUpRight
                : ArrowDownRight;
            const toAccountName = r.toAccount?.name;
            // Colore della card = colore del conto sorgente. Se non c'è
            // (utente non ha scelto colore), nessuna tinta. Stessa
            // convenzione visiva delle card della pagina Conti.
            const account = accountById.get(r.account.id);
            const tint = account?.color ?? undefined;
            const cardStyle = tint
              ? { backgroundColor: `${tint}24`, borderColor: `${tint}80` }
              : undefined;
            return (
              <Card key={r.id} className="border-l-4 transition-colors" style={cardStyle}>
                <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <div
                      className={`shrink-0 rounded-full p-1.5 ${tone}`}
                      style={{
                        backgroundColor: tint ? `${tint}33` : 'hsl(var(--muted))',
                      }}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">
                        {r.description || 'Senza descrizione'}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">
                        {r.account.name}
                        {isTransfer && toAccountName ? ` → ${toAccountName}` : ''} · {freq}
                      </p>
                    </div>
                  </div>
                  <Badge variant={r.isActive ? 'success' : 'secondary'}>
                    {r.isActive ? 'Attiva' : 'Sospesa'}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className={`text-2xl font-semibold tabular-nums ${tone}`}>
                    {isTransfer ? '↹ ' : r.type === 'income' ? '+' : '−'}
                    <MoneyAmount cents={r.amountCents} size="row" colored />
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Prossima esecuzione: {formatDate(r.nextRunDate)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
                      <Pencil className="h-3.5 w-3.5 mr-1.5" /> Modifica
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggle.mutate({ id: r.id, isActive: !r.isActive })}
                    >
                      {r.isActive ? (
                        <>
                          <Pause className="h-3.5 w-3.5 mr-1.5" /> Sospendi
                        </>
                      ) : (
                        <>
                          <Play className="h-3.5 w-3.5 mr-1.5" /> Riprendi
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        const ok = await confirm({
                          title: 'Eliminare la regola ricorrente?',
                          description:
                            r.description ||
                            'Le transazioni già generate dalla regola restano nei movimenti. Solo la regola viene rimossa.',
                          confirmLabel: 'Elimina',
                          destructive: true,
                        });
                        if (ok) remove.mutate(r.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Elimina
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o);
          if (!o) setEditing(null);
        }}
      >
        <DialogContent className="flex max-h-[90dvh] w-full max-w-xl flex-col gap-0 p-0">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle>
              {editing ? 'Modifica regola ricorrente' : 'Nuova regola ricorrente'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select
                    value={type}
                    onValueChange={(v) => {
                      setValue('type', v as FormType);
                      if (v === 'transfer') {
                        setValue('categoryId', '');
                      } else {
                        setValue('toAccountId', '');
                      }
                    }}
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
                </div>
                <div className="space-y-2">
                  <Label>Frequenza</Label>
                  <Select
                    value={watch('frequency')}
                    onValueChange={(v) => setValue('frequency', v as RecurrenceFreq)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FREQUENCIES.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>{type === 'transfer' ? 'Conto sorgente' : 'Conto'}</Label>
                  <Select
                    value={accountId || ''}
                    onValueChange={(v) => setValue('accountId', v, { shouldValidate: true })}
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
                  {errors.accountId && (
                    <p className="text-xs text-destructive">{errors.accountId.message}</p>
                  )}
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
                <div className="space-y-2">
                  <Label>Conto destinazione</Label>
                  <Select
                    value={toAccountId || ''}
                    onValueChange={(v) => setValue('toAccountId', v, { shouldValidate: true })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleziona conto destinazione" />
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
              )}

              <div className="space-y-2">
                <Label>Categoria{type === 'transfer' ? ' (opz.)' : ''}</Label>
                <CategoryPicker
                  value={watch('categoryId') || null}
                  onChange={(v) => setValue('categoryId', v ?? '')}
                  categories={categories}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="startDate">Inizio</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={startDate ?? ''}
                    onChange={(e) =>
                      setValue('startDate', e.target.value, { shouldValidate: true })
                    }
                    aria-invalid={!!errors.startDate}
                  />
                  {errors.startDate && (
                    <p className="text-xs text-destructive">{errors.startDate.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endDate">Fine (opz.)</Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={endDate ?? ''}
                    onChange={(e) => setValue('endDate', e.target.value)}
                    min={startDate || undefined}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Descrizione</Label>
                <Input id="description" {...register('description')} />
              </div>

              {(create.isError || update.isError) && (
                <p className="text-sm text-destructive">
                  {((create.error ?? update.error) as Error | undefined)?.message}
                </p>
              )}
            </div>

            <DialogFooter className="border-t bg-background px-6 py-3 sm:space-x-2">
              <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>
                Annulla
              </Button>
              <Button type="submit" disabled={create.isPending || update.isPending}>
                {editing ? 'Salva modifiche' : 'Crea'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
