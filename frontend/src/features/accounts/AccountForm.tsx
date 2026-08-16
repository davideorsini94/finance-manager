import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { ColorPicker } from '@/components/shared/ColorPicker';
import { IconPicker } from '@/components/shared/IconPicker';
import { useConfirm } from '@/components/shared/confirm';
import { eurosToCents, centsToNumber, formatCents } from '@/lib/utils/currency';
import { sortByName } from '@/lib/utils/sort';
import type { Account, AccountType } from '@/types/domain';
import { accountsApi } from './accountsApi';

const schema = z
  .object({
    name: z.string().min(1).max(100),
    type: z.enum(['checking', 'credit_card', 'cash']),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().or(z.literal('')),
    icon: z.string().max(50).optional(),
    initialBalance: z.coerce.number().optional(),
    paymentAccountId: z.string().uuid().optional(),
    billingDay: z.coerce.number().int().min(1).max(28).optional(),
  })
  .refine((d) => d.type !== 'credit_card' || !!d.paymentAccountId, {
    message: 'Carta di credito richiede conto di pagamento',
    path: ['paymentAccountId'],
  });

type FormValues = z.input<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account?: Account | null;
  paymentCandidates: Account[];
}

export function AccountForm({ open, onOpenChange, account, paymentCandidates }: Props) {
  const isEdit = !!account;
  const queryClient = useQueryClient();
  const confirm = useConfirm();

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
      name: '',
      type: 'checking',
      color: '',
      icon: '',
      initialBalance: '' as unknown as number,
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        name: account?.name ?? '',
        type: (account?.type ?? 'checking') as AccountType,
        color: account?.color ?? '',
        icon: account?.icon ?? '',
        initialBalance: account
          ? centsToNumber(account.balanceCents)
          : ('' as unknown as number),
        paymentAccountId: account?.paymentAccountId ?? undefined,
        billingDay: account?.billingDay ?? undefined,
      });
    }
  }, [open, account, reset]);

  const type = watch('type');

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = {
        name: values.name,
        color: values.color || undefined,
        icon: values.icon || undefined,
        paymentAccountId: values.type === 'credit_card' ? values.paymentAccountId : undefined,
        billingDay: values.type === 'credit_card' ? values.billingDay ?? 15 : undefined,
      };
      if (isEdit && account) {
        // Includi `balanceCents` solo se il valore digitato differisce dal
        // saldo corrente del conto. Così evitiamo race condition: se mentre
        // la modale era aperta sono arrivate transazioni, il saldo nuovo
        // non viene "schiacciato" indietro a quello vecchio caricato in form.
        const desiredCents = eurosToCents(Number(values.initialBalance ?? 0));
        const currentCents = Number(account.balanceCents);
        const update: typeof payload & { balanceCents?: number } = { ...payload };
        if (desiredCents !== currentCents) {
          update.balanceCents = desiredCents;
        }
        return accountsApi.update(account.id, update);
      }
      return accountsApi.create({
        ...payload,
        type: values.type as AccountType,
        initialBalanceCents: eurosToCents(Number(values.initialBalance ?? 0)),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
      // Anche la dashboard mostra i saldi: invalida pure quella così l'utente
      // vede il valore aggiornato senza dover ricaricare la pagina.
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onOpenChange(false);
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    // Sovrascrivere il saldo è irreversibile: il valore precedente non è
    // conservato da nessuna parte e i movimenti non vengono toccati (il
    // saldo smette semplicemente di derivare da essi). Si chiede conferma
    // solo quando cambia davvero; in creazione è un saldo iniziale, non
    // una sovrascrittura, quindi non serve.
    if (isEdit && account) {
      const desiredCents = eurosToCents(Number(values.initialBalance ?? 0));
      const currentCents = Number(account.balanceCents);
      if (desiredCents !== currentCents) {
        const ok = await confirm({
          title: 'Sovrascrivere il saldo del conto?',
          description: `Il saldo passerà da ${formatCents(currentCents)} a ${formatCents(desiredCents)}. Il valore precedente non viene conservato e i movimenti restano invariati.`,
          confirmLabel: 'Sovrascrivi',
          destructive: true,
        });
        if (!ok) return;
      }
    }
    mutation.mutate(values);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifica conto' : 'Nuovo conto'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Aggiorna i dati del conto.' : 'Aggiungi un conto corrente, carta o contanti.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nome</Label>
            <Input id="name" autoFocus {...register('name')} aria-invalid={!!errors.name} />
          </div>

          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select
              value={type}
              onValueChange={(v) => setValue('type', v as AccountType, { shouldValidate: true })}
              disabled={isEdit}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="checking">Conto corrente</SelectItem>
                <SelectItem value="credit_card">Carta di credito</SelectItem>
                <SelectItem value="cash">Contanti</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {type === 'credit_card' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2 col-span-2">
                <Label>Conto di pagamento</Label>
                <Select
                  value={watch('paymentAccountId') ?? ''}
                  onValueChange={(v) => setValue('paymentAccountId', v, { shouldValidate: true })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleziona conto da addebitare" />
                  </SelectTrigger>
                  <SelectContent>
                    {sortByName(paymentCandidates).map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.paymentAccountId && (
                  <p className="text-xs text-destructive">{errors.paymentAccountId.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="billingDay">Giorno addebito</Label>
                <Input
                  id="billingDay"
                  type="number"
                  min={1}
                  max={28}
                  defaultValue={15}
                  {...register('billingDay')}
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="initialBalance">
              {isEdit ? 'Saldo (€)' : 'Saldo iniziale (€)'}
            </Label>
            <Input
              id="initialBalance"
              type="number"
              step="0.01"
              placeholder="0,00"
              {...register('initialBalance')}
            />
            {isEdit && (
              <p className="text-[11px] text-muted-foreground">
                Corregge direttamente il saldo del conto. Non viene generata
                una transazione di rettifica: usalo solo se il saldo iniziale
                era stato impostato in modo errato.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Colore</Label>
              <ColorPicker
                value={watch('color') || null}
                onChange={(c) => setValue('color', c ?? '', { shouldDirty: true })}
              />
            </div>
            <div className="space-y-2">
              <Label>Icona</Label>
              <IconPicker
                value={watch('icon') || null}
                onChange={(i) => setValue('icon', i ?? '', { shouldDirty: true })}
                color={watch('color') || null}
              />
            </div>
          </div>

          {mutation.isError && (
            <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Annulla
            </Button>
            <Button type="submit" disabled={isSubmitting || mutation.isPending}>
              {isEdit ? 'Salva' : 'Crea'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
