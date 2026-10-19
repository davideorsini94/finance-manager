import { useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, CheckCircle2, X, Sparkles, Save } from 'lucide-react';
import { authFetch } from '@/lib/auth-fetch';
import { useConfirm } from '@/components/shared/confirm';
import { sortByName } from '@/lib/utils/sort';

type Step = 'upload' | 'mapping' | 'preview' | 'done';

interface BatchRow {
  id: string;
  rowIndex: number;
  raw: string[];
  parsedDate: string | null;
  parsedAmount: string | null;
  parsedDescription: string | null;
  status: 'pending' | 'ready' | 'duplicate' | 'imported' | 'skipped' | 'error';
  errorMessage: string | null;
  suggestedCategory: { id: string; name: string } | null;
  finalCategory: { id: string; name: string } | null;
  suggestedConfidence: number | null;
  duplicateOf: { id: string; description: string | null; transactionDate: string } | null;
}

interface Batch {
  id: string;
  filename: string;
  rowCount: number;
  duplicateCount: number;
  status: string;
  account: { id: string; name: string };
  rows: BatchRow[];
}

interface Account { id: string; name: string }
interface Category { id: string; name: string; type: string }
interface Template {
  id: string; name: string; bankName: string | null;
  delimiter: string; columnMap: Record<string, number>; decimalSep: string;
}

export function ImportWizard() {
  // `confirm` qui sotto è la funzione che esegue l'import: l'hook prende un
  // nome diverso per non ombreggiarla.
  const askConfirm = useConfirm();
  const [step, setStep] = useState<Step>('upload');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);

  const [accountId, setAccountId] = useState<string>('');
  const [templateId, setTemplateId] = useState<string>('');
  const [csvText, setCsvText] = useState<string>('');
  const [filename, setFilename] = useState<string>('');
  const [delimiter, setDelimiter] = useState<string>(',');
  const [hasHeader, setHasHeader] = useState(true);
  const [decimalSep, setDecimalSep] = useState<string>(',');
  const [columnMap, setColumnMap] = useState({ date: 0, amount: 1, description: 2 });

  const [batchId, setBatchId] = useState<string | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [polling, setPolling] = useState(false);

  const [saveTemplate, setSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');

  // Carica accounts/categories/templates
  useEffect(() => {
    void (async () => {
      const [a, c, t] = await Promise.all([
        authFetch('/api/accounts').then((r) => r.json()),
        authFetch('/api/categories').then((r) => r.json()),
        authFetch('/api/imports/templates').then((r) => r.json()),
      ]);
      setAccounts(a);
      setCategories(c);
      setTemplates(t);
      if (a.length > 0) setAccountId(a[0].id);
    })();
  }, []);

  // Polling per stato batch
  useEffect(() => {
    if (!batchId || !polling) return;
    const i = setInterval(async () => {
      const res = await authFetch(`/api/imports/batches/${batchId}`);
      if (!res.ok) return;
      const b: Batch = await res.json();
      setBatch(b);
      if (b.status === 'ready' || b.status === 'failed') {
        setPolling(false);
        setStep('preview');
      }
    }, 1500);
    return () => clearInterval(i);
  }, [batchId, polling]);

  const onDrop = (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFilename(f.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      setCsvText(text);
      // auto-detect delimiter
      const sample = text.slice(0, 4000);
      const c = (sample.match(/,/g) ?? []).length;
      const s = (sample.match(/;/g) ?? []).length;
      const t = (sample.match(/\t/g) ?? []).length;
      setDelimiter(t > c && t > s ? '\t' : s > c ? ';' : ',');
      setStep('mapping');
    };
    reader.readAsText(f);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'text/csv': ['.csv'], 'text/plain': ['.txt'] },
    multiple: false,
    onDrop,
  });

  const previewLines = csvText.split('\n').slice(0, 5).map((l) => l.split(delimiter));

  const startImport = async () => {
    const res = await authFetch('/api/imports/batches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId,
        filename,
        rawCsv: csvText,
        templateId: templateId || undefined,
        delimiter,
        hasHeader,
        decimalSep,
        columnMap,
      }),
    });
    if (!res.ok) return;
    const { batchId: id } = await res.json();
    setBatchId(id);
    setPolling(true);
  };

  const updateRow = (rowId: string, finalCategoryId: string | null) => {
    if (!batch) return;
    setBatch({
      ...batch,
      rows: batch.rows.map((r) =>
        r.id === rowId
          ? {
              ...r,
              finalCategory: finalCategoryId ? categories.find((c) => c.id === finalCategoryId) ? { id: finalCategoryId, name: categories.find((c) => c.id === finalCategoryId)!.name } : null : null,
            }
          : r,
      ),
    });
  };

  const toggleSkip = (rowId: string) => {
    if (!batch) return;
    setBatch({
      ...batch,
      rows: batch.rows.map((r) =>
        r.id === rowId ? { ...r, status: r.status === 'skipped' ? 'ready' : 'skipped' } : r,
      ),
    });
  };

  const confirm = async () => {
    if (!batchId || !batch) return;
    const rows = batch.rows.map((r) => ({
      rowId: r.id,
      finalCategoryId: r.finalCategory?.id,
      skip: r.status === 'skipped' || r.status === 'duplicate',
    }));

    // Crea movimenti reali in blocco: per disfarli vanno cancellati a mano.
    const toImport = rows.filter((r) => !r.skip).length;
    const ok = await askConfirm({
      title: `Importare ${toImport} ${toImport === 1 ? 'movimento' : 'movimenti'}?`,
      description:
        'Entreranno nei tuoi movimenti e aggiorneranno i saldi dei conti. Per annullarli dovrai cancellarli uno per uno.',
      confirmLabel: 'Importa',
    });
    if (!ok) return;
    await authFetch(`/api/imports/batches/${batchId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows,
        saveAsTemplate: saveTemplate && templateName.length > 0,
        templateName,
      }),
    });
    setStep('done');
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Titolo come le altre pagine; il padding lo dà già il contenitore
          dell'AppShell (qui c'era un p-6 in più che stringeva tutto su mobile). */}
      <h1 className="fm-large-title">Importa CSV</h1>
      <Stepper step={step} />

      {step === 'upload' && (
        <UploadStep
          accounts={accounts}
          accountId={accountId}
          setAccountId={setAccountId}
          templates={templates}
          templateId={templateId}
          setTemplateId={setTemplateId}
          getRootProps={getRootProps}
          getInputProps={getInputProps}
          isDragActive={isDragActive}
        />
      )}

      {step === 'mapping' && (
        <MappingStep
          filename={filename}
          previewLines={previewLines}
          delimiter={delimiter}
          setDelimiter={setDelimiter}
          hasHeader={hasHeader}
          setHasHeader={setHasHeader}
          decimalSep={decimalSep}
          setDecimalSep={setDecimalSep}
          columnMap={columnMap}
          setColumnMap={setColumnMap}
          onBack={() => setStep('upload')}
          onNext={() => { void startImport(); setStep('preview'); }}
          analyzing={polling}
        />
      )}

      {step === 'preview' && (
        <PreviewStep
          batch={batch}
          analyzing={polling}
          categories={categories}
          updateRow={updateRow}
          toggleSkip={toggleSkip}
          saveTemplate={saveTemplate}
          setSaveTemplate={setSaveTemplate}
          templateName={templateName}
          setTemplateName={setTemplateName}
          onConfirm={confirm}
          onBack={() => setStep('mapping')}
        />
      )}

      {step === 'done' && batch && (
        <div className="rounded-lg border border-[hsl(var(--pos)/0.3)] bg-[hsl(var(--pos-soft))] p-8 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-[hsl(var(--pos))]" />
          <h3 className="mt-4 text-lg font-semibold">Import completato</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {batch.rows.filter((r) => r.status === 'ready').length} transazioni importate su {batch.account.name}
          </p>
          <button
            type="button"
            onClick={() => { setStep('upload'); setBatchId(null); setBatch(null); setCsvText(''); }}
            className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Nuovo import
          </button>
        </div>
      )}
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: 'upload', label: '1. Carica file' },
    { id: 'mapping', label: '2. Mappa colonne' },
    { id: 'preview', label: '3. Verifica' },
    { id: 'done', label: '4. Fatto' },
  ];
  const idx = steps.findIndex((s) => s.id === step);
  return (
    // Su mobile le quattro etichette affiancate sforavano di ~90px: lì si
    // mostra l'etichetta solo del passo attivo, da sm tutte.
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {steps.map((s, i) => (
        <li key={s.id} className="flex items-center gap-2">
          <span
            className={
              i <= idx
                ? 'flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground'
                : 'flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground'
            }
          >
            {i < idx ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
          </span>
          <span
            className={
              i === idx ? 'font-medium' : 'hidden text-muted-foreground sm:inline'
            }
          >
            {s.label.replace(/^\d\.\s*/, '')}
          </span>
          {i < steps.length - 1 && <span className="mx-0.5 text-muted-foreground/50">→</span>}
        </li>
      ))}
    </ol>
  );
}

function UploadStep(props: {
  accounts: Account[];
  accountId: string;
  setAccountId: (id: string) => void;
  templates: Template[];
  templateId: string;
  setTemplateId: (id: string) => void;
  getRootProps: () => Record<string, unknown>;
  getInputProps: () => Record<string, unknown>;
  isDragActive: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Conto di destinazione</span>
          <select
            value={props.accountId}
            onChange={(e) => props.setAccountId(e.target.value)}
            className="fm-glass-field h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {sortByName(props.accounts).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Template (opzionale)</span>
          <select
            value={props.templateId}
            onChange={(e) => props.setTemplateId(e.target.value)}
            className="fm-glass-field h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">— nessuno —</option>
            {props.templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}{t.bankName ? ` (${t.bankName})` : ''}</option>
            ))}
          </select>
        </label>
      </div>

      <div
        {...props.getRootProps()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition ${
          props.isDragActive
            ? 'border-primary bg-accent'
            : 'border-input bg-muted/50 hover:border-input'
        }`}
      >
        <input {...props.getInputProps()} />
        <Upload className="h-10 w-10 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">
          {props.isDragActive ? 'Rilascia qui il file' : 'Trascina un CSV o clicca per scegliere'}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">.csv, .txt — fino a 10 MB</p>
      </div>
    </div>
  );
}

function MappingStep(props: {
  filename: string;
  previewLines: string[][];
  delimiter: string;
  setDelimiter: (d: string) => void;
  hasHeader: boolean;
  setHasHeader: (b: boolean) => void;
  decimalSep: string;
  setDecimalSep: (s: string) => void;
  columnMap: { date: number; amount: number; description: number };
  setColumnMap: (m: { date: number; amount: number; description: number }) => void;
  onBack: () => void;
  onNext: () => void;
  analyzing: boolean;
}) {
  const cols = props.previewLines[0]?.length ?? 0;
  const cm = props.columnMap;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <FileText className="h-4 w-4" /> <span className="font-medium">{props.filename}</span>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">Delimiter</span>
          <select
            value={props.delimiter}
            onChange={(e) => props.setDelimiter(e.target.value)}
            className="fm-glass-field h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value=",">Virgola ,</option>
            <option value=";">Punto e virgola ;</option>
            <option value="\t">Tab</option>
            <option value="|">Pipe |</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground">Decimale</span>
          <select
            value={props.decimalSep}
            onChange={(e) => props.setDecimalSep(e.target.value)}
            className="fm-glass-field h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value=",">Virgola (1.234,56)</option>
            <option value=".">Punto (1,234.56)</option>
          </select>
        </label>
        <label className="flex items-center gap-2 pt-6 text-sm">
          <input
            type="checkbox"
            checked={props.hasHeader}
            onChange={(e) => props.setHasHeader(e.target.checked)}
          />
          <span>Prima riga è intestazione</span>
        </label>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              {Array.from({ length: cols }).map((_, i) => (
                <th key={i} className="px-3 py-2 text-left font-medium text-muted-foreground">
                  Colonna {i}
                  <select
                    value={cm.date === i ? 'date' : cm.amount === i ? 'amount' : cm.description === i ? 'description' : ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      const next = { ...cm };
                      // sgombera i conflitti
                      if (next.date === i) next.date = -1;
                      if (next.amount === i) next.amount = -1;
                      if (next.description === i) next.description = -1;
                      if (v === 'date') next.date = i;
                      if (v === 'amount') next.amount = i;
                      if (v === 'description') next.description = i;
                      props.setColumnMap(next);
                    }}
                    className="mt-1 w-full rounded border border-input bg-background px-1 py-0.5 text-xs"
                  >
                    <option value="">— ignora —</option>
                    <option value="date">📅 Data</option>
                    <option value="amount">💰 Importo</option>
                    <option value="description">📝 Descrizione</option>
                  </select>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {props.previewLines.slice(props.hasHeader ? 1 : 0).slice(0, 4).map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} className="whitespace-nowrap px-3 py-2 font-mono">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between pt-4">
        <button type="button" onClick={props.onBack} className="rounded-md border border-input px-4 py-2 text-sm">
          Indietro
        </button>
        <button
          type="button"
          onClick={props.onNext}
          disabled={cm.date < 0 || cm.amount < 0}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" /> Analizza con AI
        </button>
      </div>
    </div>
  );
}

function PreviewStep(props: {
  batch: Batch | null;
  analyzing: boolean;
  categories: Category[];
  updateRow: (rowId: string, finalCategoryId: string | null) => void;
  toggleSkip: (rowId: string) => void;
  saveTemplate: boolean;
  setSaveTemplate: (b: boolean) => void;
  templateName: string;
  setTemplateName: (s: string) => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  if (!props.batch || props.analyzing) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Sparkles className="h-10 w-10 animate-pulse text-primary" />
        <div className="mt-4 text-sm font-medium">Analisi in corso…</div>
        <div className="mt-1 text-xs text-muted-foreground">Parsing CSV, rilevamento duplicati, categorizzazione AI</div>
      </div>
    );
  }
  const b = props.batch;
  const toImport = b.rows.filter((r) => r.status === 'ready' || r.status === 'pending').length;
  const dups = b.rows.filter((r) => r.status === 'duplicate').length;
  const errs = b.rows.filter((r) => r.status === 'error').length;
  void b.rows.filter((r) => r.status === 'skipped').length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <Stat label="Totale righe" value={b.rowCount} />
        <Stat label="Da importare" value={toImport} tone="success" />
        <Stat label="Duplicati" value={dups} tone="warning" />
        <Stat label="Errori" value={errs} tone="error" />
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Stato</th>
              <th className="px-3 py-2 text-left">Data</th>
              <th className="px-3 py-2 text-right">Importo</th>
              <th className="px-3 py-2 text-left">Descrizione</th>
              <th className="px-3 py-2 text-left">Categoria (AI)</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {b.rows.map((r) => <Row key={r.id} r={r} categories={props.categories} updateRow={props.updateRow} toggleSkip={props.toggleSkip} />)}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3 rounded-md border border-dashed border-input p-3 text-sm">
        <Save className="h-4 w-4 text-muted-foreground" />
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={props.saveTemplate} onChange={(e) => props.setSaveTemplate(e.target.checked)} />
          <span>Salva mappatura come template</span>
        </label>
        {props.saveTemplate && (
          <input
            type="text"
            placeholder="Nome template (es. Intesa SP)"
            value={props.templateName}
            onChange={(e) => props.setTemplateName(e.target.value)}
            className="flex-1 rounded border border-input bg-background px-2 py-1 text-sm"
          />
        )}
      </div>

      <div className="flex justify-between pt-2">
        <button type="button" onClick={props.onBack} className="rounded-md border border-input px-4 py-2 text-sm">
          Indietro
        </button>
        <button
          type="button"
          onClick={props.onConfirm}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Importa {toImport} transazioni
        </button>
      </div>
    </div>
  );
}

function Row(props: { r: BatchRow; categories: Category[]; updateRow: (rowId: string, finalCategoryId: string | null) => void; toggleSkip: (rowId: string) => void }) {
  const r = props.r;
  const amount = r.parsedAmount ? Number(r.parsedAmount) / 100 : null;
  const isNeg = amount !== null && amount < 0;
  const conf = r.suggestedConfidence ?? 0;
  return (
    <tr className={r.status === 'skipped' ? 'opacity-40' : r.status === 'duplicate' ? 'bg-[hsl(var(--warn-soft)/0.5)]' : r.status === 'error' ? 'bg-[hsl(var(--neg-soft)/0.5)]' : ''}>
      <td className="px-3 py-2">
        <StatusBadge status={r.status} />
      </td>
      <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">
        {r.parsedDate ? new Date(r.parsedDate).toLocaleDateString('it-IT') : '—'}
      </td>
      <td className={`px-3 py-2 text-right font-mono ${isNeg ? 'text-[hsl(var(--neg))]' : 'text-[hsl(var(--pos))]'}`}>
        {amount !== null ? new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(amount) : '—'}
      </td>
      <td className="max-w-xs truncate px-3 py-2">{r.parsedDescription ?? '—'}</td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <select
            value={r.finalCategory?.id ?? ''}
            onChange={(e) => props.updateRow(r.id, e.target.value || null)}
            className="rounded border border-input bg-background px-1.5 py-1 text-xs"
          >
            <option value="">— scegli —</option>
            {sortByName(props.categories).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {r.suggestedCategory && conf > 0 && (
            <span title={`Confidence ${(conf * 100).toFixed(0)}%`} className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${conf >= 0.7 ? 'bg-[hsl(var(--pos-soft))] text-[hsl(var(--pos))]' : conf >= 0.4 ? 'bg-[hsl(var(--warn-soft))] text-[hsl(var(--warn))]' : 'bg-muted text-muted-foreground'}`}>
              <Sparkles className="h-2.5 w-2.5" /> {(conf * 100).toFixed(0)}%
            </span>
          )}
        </div>
        {r.duplicateOf && (
          <div className="mt-1 text-[10px] text-[hsl(var(--warn))]">
            Duplicato di: {r.duplicateOf.description} ({new Date(r.duplicateOf.transactionDate).toLocaleDateString('it-IT')})
          </div>
        )}
        {r.errorMessage && <div className="mt-1 text-[10px] text-[hsl(var(--neg))]">{r.errorMessage}</div>}
      </td>
      <td className="px-3 py-2 text-right">
        <button type="button" onClick={() => props.toggleSkip(r.id)} className="text-muted-foreground hover:text-[hsl(var(--neg))]" title={r.status === 'skipped' ? 'Reincludi' : 'Salta'}>
          <X className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: BatchRow['status'] }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    pending: { label: 'pending', cls: 'bg-muted text-muted-foreground' },
    ready: { label: '✓ pronta', cls: 'bg-[hsl(var(--pos-soft))] text-[hsl(var(--pos))]' },
    duplicate: { label: '⚠ duplicato', cls: 'bg-[hsl(var(--warn-soft))] text-[hsl(var(--warn))]' },
    imported: { label: 'importata', cls: 'bg-accent text-accent-foreground' },
    skipped: { label: 'saltata', cls: 'bg-muted text-muted-foreground' },
    error: { label: '✕ errore', cls: 'bg-[hsl(var(--neg-soft))] text-[hsl(var(--neg))]' },
  };
  const c = cfg[status] ?? cfg.pending;
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${c.cls}`}>{c.label}</span>;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'warning' | 'error' }) {
  const toneCls = tone === 'success' ? 'text-[hsl(var(--pos))]' : tone === 'warning' ? 'text-[hsl(var(--warn))]' : tone === 'error' ? 'text-[hsl(var(--neg))]' : '';
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneCls}`}>{value}</div>
    </div>
  );
}
