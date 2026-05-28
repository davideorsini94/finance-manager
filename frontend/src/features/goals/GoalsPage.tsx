import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, Trophy, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
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
import { eurosToCents, formatCents, centsToNumber } from '@/lib/utils/currency';
import { sortByName } from '@/lib/utils/sort';
import { formatDate } from '@/lib/utils/date';
import { accountsApi } from '@/features/accounts/accountsApi';
import { goalsApi, type Goal } from './goalsApi';
import { useConfirm } from '@/components/shared/confirm';

const schema = z.object({
  name: z.string().min(1).max(100),
  target: z.coerce.number().positive(),
  current: z.coerce.number().min(0),
  deadline: z.string().optional(),
  accountId: z.string().uuid().optional().or(z.literal('')),
});

type FormValues = z.input<typeof schema>;

export function GoalsPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);

  const goalsQuery = useQuery({ queryKey: ['goals'], queryFn: () => goalsApi.list() });
  const accountsQuery = useQuery({ queryKey: ['accounts'], queryFn: () => accountsApi.list() });

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        name: values.name,
        targetCents: eurosToCents(Number(values.target)),
        currentCents: eurosToCents(Number(values.current ?? 0)),
        deadline: values.deadline || undefined,
        accountId: values.accountId || undefined,
      };
      if (editing) return goalsApi.update(editing.id, payload);
      return goalsApi.create(payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['goals'] });
      setFormOpen(false);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => goalsApi.remove(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['goals'] }),
  });

  const toggleComplete = useMutation({
    mutationFn: ({ id, isCompleted }: { id: string; isCompleted: boolean }) =>
      goalsApi.update(id, { isCompleted }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['goals'] }),
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
      name: '',
      target: '' as unknown as number,
      current: '' as unknown as number,
      deadline: '',
      accountId: '',
    },
  });

  const openForm = (goal?: Goal) => {
    setEditing(goal ?? null);
    reset({
      name: goal?.name ?? '',
      target: goal ? centsToNumber(goal.targetCents) : ('' as unknown as number),
      current: goal ? centsToNumber(goal.currentCents) : ('' as unknown as number),
      deadline: goal?.deadline ? goal.deadline.slice(0, 10) : '',
      accountId: goal?.accountId ?? '',
    });
    setFormOpen(true);
  };

  const goals = goalsQuery.data ?? [];
  const accounts = sortByName(accountsQuery.data ?? []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Obiettivi di risparmio</h1>
        <Button onClick={() => openForm()}>
          <Plus className="h-4 w-4 mr-2" /> Nuovo
        </Button>
      </div>

      {goals.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nessun obiettivo ancora. Es: vacanza, fondo emergenze, nuova auto…
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {goals.map((g) => {
            const target = Number(g.targetCents);
            const current = Number(g.currentCents);
            const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
            return (
              <Card key={g.id} className={g.isCompleted ? 'opacity-70' : ''}>
                <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-amber-500" />
                    {g.name}
                  </CardTitle>
                  {g.isCompleted && <Badge variant="success">Completato</Badge>}
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-semibold">{formatCents(current)}</span>
                    <span className="text-muted-foreground">/ {formatCents(target)}</span>
                  </div>
                  <Progress value={pct} />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{pct.toFixed(0)}%</span>
                    {g.deadline && <span>Scadenza: {formatDate(g.deadline)}</span>}
                  </div>
                  {g.account && (
                    <p className="text-xs text-muted-foreground">Conto: {g.account.name}</p>
                  )}
                  <div className="flex gap-1 pt-2">
                    <Button size="sm" variant="outline" onClick={() => openForm(g)}>
                      <Pencil className="h-3.5 w-3.5 mr-1.5" /> Modifica
                    </Button>
                    {!g.isCompleted && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleComplete.mutate({ id: g.id, isCompleted: true })}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Completa
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Elimina"
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Eliminare l'obiettivo "${g.name}"?`,
                          confirmLabel: 'Elimina',
                          destructive: true,
                        });
                        if (ok) remove.mutate(g.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Modifica obiettivo' : 'Nuovo obiettivo'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome</Label>
              <Input id="name" autoFocus {...register('name')} aria-invalid={!!errors.name} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="target">Obiettivo (€)</Label>
                <Input id="target" type="number" step="0.01" min="0.01" placeholder="0,00" {...register('target')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="current">Già accantonato (€)</Label>
                <Input id="current" type="number" step="0.01" min="0" placeholder="0,00" {...register('current')} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="deadline">Scadenza (opz.)</Label>
                <Input id="deadline" type="date" {...register('deadline')} />
              </div>
              <div className="space-y-2">
                <Label>Conto di riferimento</Label>
                <Select
                  value={watch('accountId') || 'none'}
                  onValueChange={(v) => setValue('accountId', v === 'none' ? '' : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Nessuno" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nessuno</SelectItem>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {save.isError && (
              <p className="text-sm text-destructive">{(save.error as Error).message}</p>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>
                Annulla
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {editing ? 'Salva' : 'Crea'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
