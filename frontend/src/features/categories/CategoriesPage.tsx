import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getIcon } from '@/components/shared/icon-pool';
import type { Category } from '@/types/domain';
import { categoriesApi } from './categoriesApi';
import { CategoryForm } from './CategoryForm';
import { useConfirm } from '@/components/shared/confirm';
import { sortByName } from '@/lib/utils/sort';

export function CategoriesPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);

  const askDelete = async (cat: Category) => {
    const ok = await confirm({
      title: `Eliminare la categoria "${cat.name}"?`,
      description:
        'Le transazioni associate non verranno cancellate ma rimarranno senza categoria. Eventuali sottocategorie diventano root.',
      confirmLabel: 'Elimina',
      destructive: true,
    });
    if (ok) remove.mutate(cat.id);
  };

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => categoriesApi.remove(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['categories'] }),
  });

  const data = categoriesQuery.data ?? [];
  // Le categorie ora sono GENERICHE (valgono sia entrate sia uscite),
  // quindi mostriamo una singola lista gerarchica ordinata alfabeticamente.
  const roots = sortByName(data.filter((c) => c.parentId === null));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Categorie</h1>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" /> Nuova categoria
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tutte le categorie</CardTitle>
        </CardHeader>
        <CardContent>
          {roots.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nessuna categoria. Crea la prima per organizzare i tuoi movimenti.
            </p>
          ) : (
            <ul className="space-y-1">
              {roots.map((parent) => (
                <li key={parent.id}>
                  <CategoryRow
                    category={parent}
                    onEdit={(c) => {
                      setEditing(c);
                      setFormOpen(true);
                    }}
                    onDelete={() => askDelete(parent)}
                  />
                  <ul className="ml-6 mt-1 space-y-1">
                    {sortByName(data.filter((c) => c.parentId === parent.id)).map((child) => (
                      <li key={child.id}>
                        <CategoryRow
                          category={child}
                          onEdit={(c) => {
                            setEditing(c);
                            setFormOpen(true);
                          }}
                          onDelete={() => askDelete(child)}
                        />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <CategoryForm
        open={formOpen}
        onOpenChange={setFormOpen}
        category={editing}
        candidates={data}
      />
    </div>
  );
}

interface RowProps {
  category: Category;
  onEdit: (c: Category) => void;
  onDelete: (id: string) => void;
}

function CategoryRow({ category, onEdit, onDelete }: RowProps) {
  const Icon = getIcon(category.icon);
  const tint = category.color ?? undefined;
  return (
    <div className="flex items-center justify-between rounded-md border bg-card px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-md shrink-0"
          style={{
            backgroundColor: tint ? `${tint}1f` : 'hsl(var(--muted))',
            color: tint ?? 'hsl(var(--muted-foreground))',
          }}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="truncate text-sm">{category.name}</span>
      </div>
      <div className="flex items-center gap-1">
        <Button size="icon" variant="ghost" onClick={() => onEdit(category)} aria-label="Modifica">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => onDelete(category.id)}
          aria-label="Elimina"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
