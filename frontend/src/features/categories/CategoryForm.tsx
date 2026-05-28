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
import type { Category } from '@/types/domain';
import { categoriesApi } from './categoriesApi';
import { sortByName } from '@/lib/utils/sort';

const schema = z.object({
  name: z.string().min(1).max(80),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().or(z.literal('')),
  icon: z.string().max(50).optional(),
  parentId: z.string().uuid().optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category?: Category | null;
  candidates: Category[];
}

export function CategoryForm({ open, onOpenChange, category, candidates }: Props) {
  const isEdit = !!category;
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', color: '', icon: '', parentId: '' },
  });

  useEffect(() => {
    if (open) {
      reset({
        name: category?.name ?? '',
        color: category?.color ?? '',
        icon: category?.icon ?? '',
        parentId: category?.parentId ?? '',
      });
    }
  }, [open, category, reset]);

  // Quando l'utente seleziona/cambia il parent in fase di CREAZIONE,
  // proponiamo come default il colore del parent (l'utente può comunque
  // sovrascriverlo). In modifica non tocchiamo il colore esistente.
  const watchedParentId = watch('parentId');
  useEffect(() => {
    if (isEdit) return;
    if (!watchedParentId) return;
    const parent = candidates.find((c) => c.id === watchedParentId);
    if (parent?.color) {
      setValue('color', parent.color, { shouldDirty: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedParentId, isEdit, candidates]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        name: values.name,
        color: values.color || undefined,
        icon: values.icon || undefined,
        parentId: values.parentId || undefined,
      };
      if (isEdit && category) {
        return categoriesApi.update(category.id, {
          ...payload,
          parentId: values.parentId || null,
        });
      }
      return categoriesApi.create(payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
      onOpenChange(false);
    },
  });

  const topLevel = candidates.filter((c) => c.parentId === null && c.id !== category?.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifica categoria' : 'Nuova categoria'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nome</Label>
            <Input id="name" autoFocus {...register('name')} aria-invalid={!!errors.name} />
          </div>

          <div className="space-y-2">
            <Label>Categoria padre</Label>
            <Select
              value={watch('parentId') || 'none'}
              onValueChange={(v) => setValue('parentId', v === 'none' ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Nessuna (top-level)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nessuna</SelectItem>
                {sortByName(topLevel).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
