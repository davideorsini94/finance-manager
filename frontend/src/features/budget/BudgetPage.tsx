import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils/cn';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CategoryPicker } from '@/components/shared/CategoryPicker';
import { categoriesApi } from '@/features/categories/categoriesApi';
import { eurosToCents } from '@/lib/utils/currency';
import { MoneyAmount } from '@/components/shared/MoneyAmount';
import { budgetApi } from './budgetApi';
import { useConfirm } from '@/components/shared/confirm';

const schema = z.object({
  categoryId: z.string().uuid({ message: 'Categoria richiesta' }),
  limit: z.coerce.number().positive(),
});

type FormValues = z.input<typeof schema>;

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function BudgetPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [month, setMonth] = useState(currentMonth());
  const [formOpen, setFormOpen] = useState(false);

  const budgetsQuery = useQuery({
    queryKey: ['budgets', month],
    queryFn: () => budgetApi.list(month),
  });
  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => budgetApi.remove(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['budgets'] }),
  });

  const create = useMutation({
    mutationFn: (input: { categoryId: string; limitCents: number }) =>
      budgetApi.create({ ...input, month }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['budgets'] });
      setFormOpen(false);
    },
  });

  const {
    handleSubmit,
    register,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { categoryId: '', limit: '' as unknown as number } });

  const onSubmit = handleSubmit((values) => {
    create.mutate({
      categoryId: values.categoryId,
      limitCents: eurosToCents(Number(values.limit)),
    });
  });

  // Le categorie ora sono generiche (no più isIncome): mostriamo tutte
  // nel picker del budget, l'utente sceglie quella su cui vuole il limite.
  const allCategories = categoriesQuery.data ?? [];
  const items = budgetsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Budget</h1>
        <div className="flex items-center gap-2">
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value || currentMonth())}
            className="w-40"
          />
          <Button
            onClick={() => {
              reset({ categoryId: '', limit: '' as unknown as number });
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" /> Nuovo
          </Button>
        </div>
      </div>

      {budgetsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Caricamento…</p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nessun budget definito per questo mese.
          </CardContent>
        </Card>
      ) : (
        <div className="fm-stagger grid gap-3 md:grid-cols-2">
          {items.map((b) => {
            const limit = Number(b.limitCents);
            const spent = Number(b.spentCents);
            const pct = limit > 0 ? (spent / limit) * 100 : 0;
            // Token di tema, non emerald/amber di Tailwind: il verde è il colore
            // delle entrate e quello fisso ignorava il tema (→ Design System).
            const over = pct >= 100;
            const tone = over
              ? 'bg-[hsl(var(--neg))]'
              : pct >= 80
                ? 'bg-[hsl(var(--warn))]'
                : 'bg-[hsl(var(--pos))]';
            const remaining = limit - spent;
            return (
              <Card key={b.id} className="fm-card-in">
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-1 pt-4">
                  <CardTitle className="flex min-w-0 items-center gap-2 text-base font-medium">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: b.category.color ?? 'hsl(var(--muted-foreground))' }}
                    />
                    <span className="truncate">{b.category.name}</span>
                  </CardTitle>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="-mr-2 h-9 w-9 text-muted-foreground"
                    aria-label="Elimina"
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Eliminare il budget di "${b.category.name}"?`,
                        description: 'Le transazioni associate non vengono toccate.',
                        confirmLabel: 'Elimina',
                        destructive: true,
                      });
                      if (ok) remove.mutate(b.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardHeader>
                <CardContent className="space-y-2.5 pb-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-2xl font-semibold tracking-tight">
                      <MoneyAmount cents={spent} size="row" />
                    </span>
                    <span
                      className={cn(
                        'text-sm font-medium tabular-nums',
                        over ? 'text-[hsl(var(--neg))]' : 'text-muted-foreground',
                      )}
                    >
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                  <Progress value={Math.min(100, pct)} indicatorClassName={tone} />
                  <p className="text-xs text-muted-foreground">
                    {over ? (
                      <>
                        Sforato di{' '}
                        <MoneyAmount cents={-remaining} className="text-[hsl(var(--neg))]" />{' '}
                        su <MoneyAmount cents={limit} />
                      </>
                    ) : (
                      <>
                        Restano <MoneyAmount cents={remaining} className="text-foreground" /> su{' '}
                        <MoneyAmount cents={limit} />
                      </>
                    )}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuovo budget per {month}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Categoria</Label>
              <CategoryPicker
                value={watch('categoryId') || null}
                onChange={(v) => setValue('categoryId', v ?? '', { shouldValidate: true })}
                categories={allCategories}
              />
              {errors.categoryId && (
                <p className="text-xs text-destructive">{errors.categoryId.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="limit">Limite mensile (€)</Label>
              <Input
                id="limit"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0,00"
                {...register('limit')}
                aria-invalid={!!errors.limit}
              />
            </div>
            {create.isError && (
              <p className="text-sm text-destructive">{(create.error as Error).message}</p>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>
                Annulla
              </Button>
              <Button type="submit" disabled={create.isPending}>
                Crea
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

