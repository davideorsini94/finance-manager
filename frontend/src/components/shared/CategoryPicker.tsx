import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Plus, Search, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ColorPicker } from '@/components/shared/ColorPicker';
import { IconPicker } from '@/components/shared/IconPicker';
import { getIcon } from '@/components/shared/icon-pool';
import { categoriesApi } from '@/features/categories/categoriesApi';
import { cn } from '@/lib/utils/cn';
import { sortByName } from '@/lib/utils/sort';
import type { Category } from '@/types/domain';

interface Props {
  value: string | null;
  onChange: (id: string | null) => void;
  categories: Category[];
  placeholder?: string;
  /**
   * Se true (default), in fondo appare l'azione "+ Crea nuova categoria"
   * che apre un mini-dialog inline. Disabilitabile nei filtri di ricerca.
   */
  allowCreate?: boolean;
}

/**
 * Combobox di categorie con:
 *  - input di ricerca live (filtra padri e figli per nome contenuto)
 *  - rendering gerarchico a 2 livelli con indentazione
 *  - creazione al volo (con il nome cercato come default se non c'è match)
 *
 * Le categorie sono GENERICHE: lo stesso CategoryPicker viene usato per
 * entrate, uscite e giroconti. Niente filtro isIncome.
 */
export function CategoryPicker({
  value,
  onChange,
  categories,
  placeholder,
  allowCreate = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createInitialName, setCreateInitialName] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Focus automatico sull'input ricerca quando il popover si apre
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    } else {
      setQuery('');
    }
  }, [open]);

  const tree = useMemo(() => {
    const top = sortByName(categories.filter((c) => c.parentId === null));
    return top.map((p) => ({
      parent: p,
      children: sortByName(categories.filter((c) => c.parentId === p.id)),
    }));
  }, [categories]);

  const filteredTree = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tree;
    return tree.flatMap(({ parent, children }) => {
      const parentMatches = parent.name.toLowerCase().includes(q);
      const matchedChildren = children.filter((c) =>
        c.name.toLowerCase().includes(q),
      );
      if (!parentMatches && matchedChildren.length === 0) return [];
      // Se il padre matcha, mostriamo tutti i figli; se matcha solo un figlio,
      // mostriamo il padre come "header" (cliccabile comunque) e i soli figli match.
      return [{ parent, children: parentMatches ? children : matchedChildren }];
    });
  }, [tree, query]);

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === value) ?? null,
    [categories, value],
  );

  const handleSelect = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };

  const openCreate = () => {
    setCreateInitialName(query.trim());
    setCreateOpen(true);
    setOpen(false);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            {selectedCategory ? (
              <CategoryLabel category={selectedCategory} />
            ) : (
              <span className="text-muted-foreground">
                {placeholder ?? 'Seleziona categoria'}
              </span>
            )}
            <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] p-0"
          align="start"
          // Quando il picker è dentro un Radix Dialog (es. TransactionForm),
          // `react-remove-scroll` del Dialog blocca wheel/touch sugli elementi
          // portati fuori dal suo sottoalbero, rompendo lo scroll della lista.
          // Rendendo il contenuto inline il popover finisce nella zona
          // "allowed" e lo scroll torna a funzionare.
          disablePortal
        >
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cerca categoria…"
                className="pl-7 h-8 text-sm"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Pulisci ricerca"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <ul
            className="max-h-72 overflow-y-auto py-1"
            style={{ touchAction: 'pan-y' }}
          >
            {/* "Nessuna" — visibile solo quando non c'è una ricerca attiva */}
            {!query.trim() && (
              <li>
                <PickerItem
                  selected={value === null}
                  onSelect={() => handleSelect(null)}
                  text="— Nessuna —"
                  muted
                />
              </li>
            )}

            {filteredTree.length === 0 ? (
              <li className="text-xs text-muted-foreground text-center py-4">
                Nessuna corrispondenza
              </li>
            ) : (
              filteredTree.map(({ parent, children }) => (
                <Fragment key={parent.id}>
                  <li>
                    <PickerItem
                      category={parent}
                      selected={value === parent.id}
                      onSelect={() => handleSelect(parent.id)}
                    />
                  </li>
                  {children.map((c) => (
                    <li key={c.id}>
                      <PickerItem
                        category={c}
                        selected={value === c.id}
                        onSelect={() => handleSelect(c.id)}
                        indent
                      />
                    </li>
                  ))}
                </Fragment>
              ))
            )}
          </ul>

          {allowCreate && (
            <div className="border-t p-1">
              <button
                type="button"
                onClick={openCreate}
                className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-accent"
              >
                <Plus className="h-3.5 w-3.5" />
                {query.trim()
                  ? `Crea "${query.trim()}"`
                  : 'Crea nuova categoria'}
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {allowCreate && (
        <QuickCreateDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          initialName={createInitialName}
          allCategories={categories}
          onCreated={(id) => onChange(id)}
        />
      )}
    </>
  );
}

// ============================================================================
// Sotto-componenti
// ============================================================================

interface PickerItemProps {
  category?: Category;
  selected: boolean;
  onSelect: () => void;
  indent?: boolean;
  text?: string;
  muted?: boolean;
}

function PickerItem({
  category,
  selected,
  onSelect,
  indent,
  text,
  muted,
}: PickerItemProps) {
  const Icon = category ? getIcon(category.icon) : null;
  const tint = category?.color ?? undefined;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
        selected && 'bg-accent font-medium',
        indent && 'pl-8',
        muted && 'text-muted-foreground',
      )}
    >
      {category && Icon && (
        <span
          className="flex h-5 w-5 items-center justify-center rounded shrink-0"
          style={{
            backgroundColor: tint ? `${tint}26` : 'hsl(var(--muted))',
            color: tint ?? 'hsl(var(--muted-foreground))',
          }}
        >
          <Icon className="h-3 w-3" />
        </span>
      )}
      <span className="flex-1 truncate">{category?.name ?? text}</span>
      {selected && <Check className="h-4 w-4 text-primary shrink-0" />}
    </button>
  );
}

function CategoryLabel({ category }: { category: Category }) {
  const Icon = getIcon(category.icon);
  const tint = category.color ?? undefined;
  return (
    <span className="inline-flex items-center gap-2 truncate">
      <span
        className="flex h-5 w-5 items-center justify-center rounded shrink-0"
        style={{
          backgroundColor: tint ? `${tint}26` : 'hsl(var(--muted))',
          color: tint ?? 'hsl(var(--muted-foreground))',
        }}
      >
        <Icon className="h-3 w-3" />
      </span>
      <span className="truncate">{category.name}</span>
    </span>
  );
}

// ============================================================================
// Quick create dialog
// ============================================================================

interface QuickCreateProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  allCategories: Category[];
  onCreated: (newCategoryId: string) => void;
}

function QuickCreateDialog({
  open,
  onOpenChange,
  initialName = '',
  allCategories,
  onCreated,
}: QuickCreateProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [icon, setIcon] = useState<string | null>(null);
  const [parentId, setParentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pre-popola il nome quando viene aperto (es. con la query del search)
  useEffect(() => {
    if (open) {
      setName(initialName);
      setColor(null);
      setIcon(null);
      setParentId(null);
      setError(null);
    }
  }, [open, initialName]);

  // Categorie root: candidate per essere la madre della nuova categoria.
  const parentCandidates = useMemo(
    () => sortByName(allCategories.filter((c) => c.parentId === null)),
    [allCategories],
  );

  const create = useMutation({
    mutationFn: () =>
      categoriesApi.create({
        name: name.trim(),
        color: color ?? undefined,
        icon: icon ?? undefined,
        parentId: parentId ?? undefined,
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
      onCreated(created.id);
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Il nome è obbligatorio');
      return;
    }
    create.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nuova categoria</DialogTitle>
          <DialogDescription>
            Crea al volo una categoria. Verrà selezionata automaticamente.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="qcat-name">Nome</Label>
            <Input
              id="qcat-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="es. Spesa, Stipendio, Benzina…"
              maxLength={80}
            />
          </div>

          <div className="space-y-2">
            <Label>Categoria madre (opz.)</Label>
            <Select
              value={parentId ?? 'none'}
              onValueChange={(v) => setParentId(v === 'none' ? null : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Nessuna (sarà top-level)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Nessuna (top-level) —</SelectItem>
                {parentCandidates.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Se scegli una madre, la nuova categoria sarà una sotto-categoria
              (max 2 livelli).
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Colore</Label>
              <ColorPicker value={color} onChange={setColor} />
            </div>
            <div className="space-y-2">
              <Label>Icona</Label>
              <IconPicker value={icon} onChange={setIcon} color={color} />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Annulla
            </Button>
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              {create.isPending ? 'Creazione…' : 'Crea e seleziona'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
