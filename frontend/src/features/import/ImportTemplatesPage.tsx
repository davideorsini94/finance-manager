import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, FileSpreadsheet, Pencil, X, Save } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { api } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useConfirm } from '@/components/shared/confirm';

interface ColumnMap {
  date: number;
  amount: number;
  amountOut?: number;
  description?: number;
  reference?: number;
}

interface ImportTemplate {
  id: string;
  userId: string;
  name: string;
  bankName: string | null;
  delimiter: string;
  encoding: string;
  hasHeader: boolean;
  columnMap: ColumnMap;
  dateFormat: string | null;
  decimalSep: string;
  amountMode: 'single' | 'split';
  createdAt: string;
  updatedAt: string;
}

interface FormState {
  name: string;
  bankName: string;
  delimiter: string;
  encoding: string;
  hasHeader: boolean;
  decimalSep: string;
  dateFormat: string;
  amountMode: 'single' | 'split';
  colDate: number;
  colAmount: number;
  colAmountOut: string;
  colDescription: string;
  colReference: string;
}

const initialForm: FormState = {
  name: '',
  bankName: '',
  delimiter: ',',
  encoding: 'utf-8',
  hasHeader: true,
  decimalSep: ',',
  dateFormat: '',
  amountMode: 'single',
  colDate: 0,
  colAmount: 1,
  colAmountOut: '',
  colDescription: '2',
  colReference: '',
};

export function ImportTemplatesPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ImportTemplate | null>(null);
  const [form, setForm] = useState<FormState>(initialForm);
  const [error, setError] = useState<string | null>(null);

  const templatesQuery = useQuery({
    queryKey: ['import-templates'],
    queryFn: () => api.get('imports/templates').json<ImportTemplate[]>(),
  });

  const create = useMutation({
    mutationFn: (payload: unknown) =>
      api.post('imports/templates', { json: payload }).json<ImportTemplate>(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['import-templates'] });
      setOpen(false);
    },
    onError: (e) => setError((e as Error).message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`imports/templates/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['import-templates'] }),
  });

  const startCreate = () => {
    setEditing(null);
    setForm(initialForm);
    setError(null);
    setOpen(true);
  };

  const startEdit = (tpl: ImportTemplate) => {
    setEditing(tpl);
    setForm({
      name: tpl.name,
      bankName: tpl.bankName ?? '',
      delimiter: tpl.delimiter,
      encoding: tpl.encoding,
      hasHeader: tpl.hasHeader,
      decimalSep: tpl.decimalSep,
      dateFormat: tpl.dateFormat ?? '',
      amountMode: tpl.amountMode,
      colDate: tpl.columnMap.date,
      colAmount: tpl.columnMap.amount,
      colAmountOut: tpl.columnMap.amountOut?.toString() ?? '',
      colDescription: tpl.columnMap.description?.toString() ?? '',
      colReference: tpl.columnMap.reference?.toString() ?? '',
    });
    setError(null);
    setOpen(true);
  };

  const submit = async () => {
    setError(null);
    if (!form.name.trim()) {
      setError('Il nome è obbligatorio');
      return;
    }
    const columnMap: ColumnMap = {
      date: Number(form.colDate),
      amount: Number(form.colAmount),
    };
    if (form.colAmountOut) columnMap.amountOut = Number(form.colAmountOut);
    if (form.colDescription) columnMap.description = Number(form.colDescription);
    if (form.colReference) columnMap.reference = Number(form.colReference);

    const payload = {
      name: form.name.trim(),
      bankName: form.bankName.trim() || undefined,
      delimiter: form.delimiter,
      encoding: form.encoding,
      hasHeader: form.hasHeader,
      decimalSep: form.decimalSep,
      dateFormat: form.dateFormat || undefined,
      amountMode: form.amountMode,
      columnMap,
    };
    if (editing) {
      // No PATCH endpoint: ricrea sostituendo. Per ora cancella + crea —
      // quindi se la create fallisce il template è perso, e l'utente deve
      // saperlo prima di iniziare.
      const ok = await confirm({
        title: `Salvare le modifiche a "${editing.name}"?`,
        description:
          'Il template viene ricreato da zero: se il salvataggio fallisce, la versione attuale va persa.',
        confirmLabel: 'Salva',
      });
      if (!ok) return;
      await api.delete(`imports/templates/${editing.id}`).catch(() => undefined);
    }
    create.mutate(payload);
  };

  const askDelete = async (tpl: ImportTemplate) => {
    const ok = await confirm({
      title: `Eliminare il template "${tpl.name}"?`,
      description: 'Eventuali batch import che lo riferivano restano invariati.',
      confirmLabel: 'Elimina',
      destructive: true,
    });
    if (ok) remove.mutate(tpl.id);
  };

  const templates = templatesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Template di import CSV</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Salva il mapping delle colonne del tuo estratto conto per riusarlo nel{' '}
            <Link to="/import/wizard" className="text-primary underline">
              wizard di import
            </Link>
            .
          </p>
        </div>
        <Button onClick={startCreate}>
          <Plus className="h-4 w-4 mr-2" /> Nuovo template
        </Button>
      </div>

      {templatesQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Caricamento…</p>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">Nessun template salvato</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Crea il primo template oppure spunta "Salva come template" alla fine del wizard di
              import per memorizzare il mapping di una banca.
            </p>
            <Button className="mt-4" onClick={startCreate}>
              <Plus className="h-4 w-4 mr-2" /> Crea template
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((tpl) => (
            <Card key={tpl.id}>
              <CardHeader>
                <CardTitle className="text-base">{tpl.name}</CardTitle>
                {tpl.bankName && <CardDescription>{tpl.bankName}</CardDescription>}
              </CardHeader>
              <CardContent>
                <dl className="space-y-1 text-xs text-muted-foreground">
                  <div className="flex justify-between gap-2">
                    <dt>Delimitatore</dt>
                    <dd className="font-mono">"{tpl.delimiter}"</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Decimale</dt>
                    <dd className="font-mono">"{tpl.decimalSep}"</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Header</dt>
                    <dd>{tpl.hasHeader ? 'Sì' : 'No'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Importo</dt>
                    <dd>{tpl.amountMode === 'split' ? 'Entrate/Uscite separate' : 'Singola colonna'}</dd>
                  </div>
                  {tpl.dateFormat && (
                    <div className="flex justify-between gap-2">
                      <dt>Formato data</dt>
                      <dd className="font-mono">{tpl.dateFormat}</dd>
                    </div>
                  )}
                  <div className="mt-2 border-t pt-2">
                    <dt className="mb-1 font-medium text-foreground">Mapping colonne</dt>
                    <dd className="grid grid-cols-2 gap-x-2">
                      <span>Data:</span>
                      <span className="text-right font-mono">{tpl.columnMap.date}</span>
                      <span>Importo:</span>
                      <span className="text-right font-mono">{tpl.columnMap.amount}</span>
                      {tpl.columnMap.amountOut !== undefined && (
                        <>
                          <span>Uscite:</span>
                          <span className="text-right font-mono">{tpl.columnMap.amountOut}</span>
                        </>
                      )}
                      {tpl.columnMap.description !== undefined && (
                        <>
                          <span>Descrizione:</span>
                          <span className="text-right font-mono">{tpl.columnMap.description}</span>
                        </>
                      )}
                    </dd>
                  </div>
                </dl>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => startEdit(tpl)}>
                    <Pencil className="h-3.5 w-3.5 mr-1.5" /> Modifica
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => askDelete(tpl)}>
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Elimina
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Modifica template' : 'Nuovo template'}</DialogTitle>
            <DialogDescription>
              Indica il mapping del tuo estratto conto. Le colonne sono indicizzate da 0.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="tpl-name">Nome*</Label>
                <Input
                  id="tpl-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="es. Intesa estratto conto"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tpl-bank">Banca (opz.)</Label>
                <Input
                  id="tpl-bank"
                  value={form.bankName}
                  onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
                  placeholder="es. Intesa Sanpaolo"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Delimitatore</Label>
                <Select
                  value={form.delimiter}
                  onValueChange={(v) => setForm((f) => ({ ...f, delimiter: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value=",">Virgola (,)</SelectItem>
                    <SelectItem value=";">Punto e virgola (;)</SelectItem>
                    <SelectItem value="\t">Tab</SelectItem>
                    <SelectItem value="|">Pipe (|)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Separatore decimale</Label>
                <Select
                  value={form.decimalSep}
                  onValueChange={(v) => setForm((f) => ({ ...f, decimalSep: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value=",">Virgola (1,23)</SelectItem>
                    <SelectItem value=".">Punto (1.23)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Encoding</Label>
                <Select
                  value={form.encoding}
                  onValueChange={(v) => setForm((f) => ({ ...f, encoding: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="utf-8">UTF-8</SelectItem>
                    <SelectItem value="iso-8859-1">ISO-8859-1 (Latin-1)</SelectItem>
                    <SelectItem value="windows-1252">Windows-1252</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Modalità importo</Label>
                <Select
                  value={form.amountMode}
                  onValueChange={(v) => setForm((f) => ({ ...f, amountMode: v as 'single' | 'split' }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">Singola colonna (segnata)</SelectItem>
                    <SelectItem value="split">Entrate/Uscite separate</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tpl-date-fmt">Formato data (opz.)</Label>
                <Input
                  id="tpl-date-fmt"
                  value={form.dateFormat}
                  onChange={(e) => setForm((f) => ({ ...f, dateFormat: e.target.value }))}
                  placeholder="DD/MM/YYYY"
                />
              </div>
            </div>

            <div className="rounded-md border p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Mapping colonne (indice da 0)
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <NumField
                  id="col-date"
                  label="Data*"
                  value={form.colDate}
                  onChange={(v) => setForm((f) => ({ ...f, colDate: v }))}
                />
                <NumField
                  id="col-amount"
                  label="Importo*"
                  value={form.colAmount}
                  onChange={(v) => setForm((f) => ({ ...f, colAmount: v }))}
                />
                <OptNumField
                  id="col-amount-out"
                  label="Uscite (per modalità split)"
                  value={form.colAmountOut}
                  onChange={(v) => setForm((f) => ({ ...f, colAmountOut: v }))}
                />
                <OptNumField
                  id="col-description"
                  label="Descrizione"
                  value={form.colDescription}
                  onChange={(v) => setForm((f) => ({ ...f, colDescription: v }))}
                />
                <OptNumField
                  id="col-reference"
                  label="Riferimento"
                  value={form.colReference}
                  onChange={(v) => setForm((f) => ({ ...f, colReference: v }))}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.hasHeader}
                onChange={(e) => setForm((f) => ({ ...f, hasHeader: e.target.checked }))}
              />
              Il file ha una riga di intestazione (saltarla in import)
            </label>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              <X className="h-4 w-4 mr-2" /> Annulla
            </Button>
            <Button type="button" onClick={submit} disabled={create.isPending}>
              <Save className="h-4 w-4 mr-2" /> {editing ? 'Salva modifiche' : 'Crea template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NumField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function OptNumField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="—"
      />
    </div>
  );
}
