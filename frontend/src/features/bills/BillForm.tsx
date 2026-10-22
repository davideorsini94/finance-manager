import { cloneElement, isValidElement, useEffect, useId, useState, type ReactElement } from 'react';
import { useForm, useWatch, type UseFormRegister } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, FileText, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
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
import { useConfirm } from '@/components/shared/confirm';
import { cn } from '@/lib/utils/cn';
import { UTILITIES, type UtilityKind } from './analytics';
import { parseDecimal, toCents } from './numbers';
import { billsApi, type Household, type SaveBillInput, type UtilityBill } from './billsApi';
import { UTILITY_META, UtilityGlyph, utilColor } from './utilities';

/** Stessi limiti del backend (`dto/utility-bill.dto.ts`). */
const MAX_CONSUMPTION = 999_999;
const MAX_EURO = 100_000;

/** Messaggio d'errore di un numero, `null` se va bene (o è vuoto). */
function numberError(raw: string, kind: 'consumption' | 'money'): string | null {
  const n = parseDecimal(raw);
  if (n === null) return null;
  if (Number.isNaN(n)) return 'Numero non valido';
  if (kind === 'consumption') {
    if (n < 0) return 'Il consumo non può essere negativo';
    if (n > MAX_CONSUMPTION) return 'Consumo troppo alto';
    if (Math.round(n * 1000) / 1000 !== n) return 'Al massimo tre decimali';
    return null;
  }
  if (Math.abs(n) > MAX_EURO) return 'Importo troppo alto';
  return null;
}

// I campi dei servizi sono stringhe libere: i numeri si controllano nel
// `superRefine` SOLO per i servizi attivi, altrimenti un valore sbagliato in
// un servizio disattivato (e quindi nascosto) bloccherebbe il salvataggio
// senza nessun messaggio a schermo.
const lineSchema = z.object({
  enabled: z.boolean(),
  consumption: z.string(),
  cost: z.string(),
  energyPrice: z.string(),
  energyCost: z.string(),
  supplyCode: z.string().max(40),
  estimated: z.boolean(),
  ownPeriod: z.boolean(),
  periodStart: z.string(),
  periodEnd: z.string(),
});

const schema = z
  .object({
    provider: z.string().max(120),
    billNumber: z.string().max(80),
    issueDate: z.string(),
    dueDate: z.string(),
    periodStart: z.string().min(1, 'Indica l’inizio del periodo'),
    periodEnd: z.string().min(1, 'Indica la fine del periodo'),
    total: z.string(),
    notes: z.string().max(1000),
    /** '' = nessuna abitazione, NEW_HOUSEHOLD = nuova da indirizzo, altrimenti l'id. */
    household: z.string(),
    newHouseholdAddress: z.string().max(300),
    lines: z.object({ electricity: lineSchema, gas: lineSchema, water: lineSchema }),
  })
  .superRefine((v, ctx) => {
    if (v.household === NEW_HOUSEHOLD && !v.newHouseholdAddress.trim()) {
      ctx.addIssue({ code: 'custom', path: ['newHouseholdAddress'], message: 'Indica l’indirizzo dell’abitazione' });
    }
    const totalError = numberError(v.total, 'money');
    if (totalError) ctx.addIssue({ code: 'custom', path: ['total'], message: totalError });
    if (v.periodStart && v.periodEnd && v.periodStart > v.periodEnd) {
      ctx.addIssue({ code: 'custom', path: ['periodEnd'], message: 'La fine è prima dell’inizio' });
    }
    const enabled = UTILITIES.filter((u) => v.lines[u].enabled);
    if (enabled.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Scegli almeno un servizio' });
    }
    for (const u of enabled) {
      const l = v.lines[u];
      const consumptionError = numberError(l.consumption, 'consumption');
      const costError = numberError(l.cost, 'money');
      if (u !== 'water') {
        const priceN = parseDecimal(l.energyPrice);
        if (priceN !== null && (Number.isNaN(priceN) || priceN < 0 || priceN > 10)) {
          ctx.addIssue({ code: 'custom', path: ['lines', u, 'energyPrice'], message: 'Prezzo non valido' });
        }
        const energyCostError = numberError(l.energyCost, 'money');
        if (energyCostError) ctx.addIssue({ code: 'custom', path: ['lines', u, 'energyCost'], message: energyCostError });
      }
      if (consumptionError) ctx.addIssue({ code: 'custom', path: ['lines', u, 'consumption'], message: consumptionError });
      if (costError) ctx.addIssue({ code: 'custom', path: ['lines', u, 'cost'], message: costError });
      if (consumptionError || costError) continue;
      if (parseDecimal(l.consumption) === null && parseDecimal(l.cost) === null) {
        ctx.addIssue({ code: 'custom', path: ['lines', u, 'consumption'], message: 'Indica almeno consumo o costo' });
      }
      if (l.ownPeriod && (!l.periodStart || !l.periodEnd)) {
        ctx.addIssue({ code: 'custom', path: ['lines', u, 'periodEnd'], message: 'Indica inizio e fine' });
      } else if (l.ownPeriod && l.periodStart > l.periodEnd) {
        ctx.addIssue({ code: 'custom', path: ['lines', u, 'periodEnd'], message: 'La fine è prima dell’inizio' });
      }
    }
  });

type FormValues = z.infer<typeof schema>;

const NEW_HOUSEHOLD = '__new';
type LineValues = FormValues['lines']['electricity'];

const fmtNumber = (n: number | null, decimals = 3) =>
  n === null ? '' : new Intl.NumberFormat('it-IT', { maximumFractionDigits: decimals, useGrouping: false }).format(n);

function toFormValues(bill: UtilityBill | null, households: Household[]): FormValues {
  // Nuova bolletta a mano con una sola abitazione: è quasi certamente quella.
  const household = bill ? (bill.householdId ?? '') : households.length === 1 ? households[0].id : '';
  const line = (u: UtilityKind): LineValues => {
    const l = bill?.lines.find((x) => x.utility === u);
    return {
      enabled: !!l,
      consumption: fmtNumber(l?.consumption ?? null),
      cost: l?.costCents == null ? '' : fmtNumber(l.costCents / 100, 2),
      energyPrice: fmtNumber(l?.energyUnitPrice ?? null, 6),
      energyCost: l?.energyCostCents == null ? '' : fmtNumber(l.energyCostCents / 100, 2),
      supplyCode: l?.supplyCode ?? '',
      estimated: l?.estimated ?? false,
      ownPeriod: !!(l?.periodStart && l?.periodEnd),
      periodStart: l?.periodStart ?? '',
      periodEnd: l?.periodEnd ?? '',
    };
  };
  return {
    provider: bill?.provider ?? '',
    billNumber: bill?.billNumber ?? '',
    issueDate: bill?.issueDate ?? '',
    dueDate: bill?.dueDate ?? '',
    periodStart: bill?.periodStart ?? '',
    periodEnd: bill?.periodEnd ?? '',
    total: bill?.totalCents == null ? '' : fmtNumber(bill.totalCents / 100, 2),
    notes: bill?.notes ?? '',
    household,
    newHouseholdAddress: bill?.supplyAddress ?? '',
    lines: { electricity: line('electricity'), gas: line('gas'), water: line('water') },
  };
}

const cents = (v: string) => {
  const n = parseDecimal(v);
  return n === null || Number.isNaN(n) ? null : toCents(n);
};

function toInput(v: FormValues): SaveBillInput {
  const blank = (s: string) => (s.trim() ? s.trim() : null);
  return {
    provider: blank(v.provider),
    billNumber: blank(v.billNumber),
    issueDate: blank(v.issueDate),
    dueDate: blank(v.dueDate),
    periodStart: v.periodStart,
    periodEnd: v.periodEnd,
    totalCents: cents(v.total),
    notes: blank(v.notes),
    ...(v.household === NEW_HOUSEHOLD
      ? { newHouseholdAddress: v.newHouseholdAddress.trim() }
      : { householdId: v.household || null }),
    lines: UTILITIES.filter((u) => v.lines[u].enabled).map((u) => {
      const l = v.lines[u];
      const consumption = parseDecimal(l.consumption);
      return {
        utility: u,
        consumption: consumption === null || Number.isNaN(consumption) ? null : consumption,
        costCents: cents(l.cost),
        periodStart: l.ownPeriod ? l.periodStart || null : null,
        periodEnd: l.ownPeriod ? l.periodEnd || null : null,
        supplyCode: blank(l.supplyCode),
        estimated: l.estimated,
        ...(u === 'water'
          ? { energyCostCents: null, energyUnitPrice: null }
          : {
              energyCostCents: cents(l.energyCost),
              energyUnitPrice: (() => {
                const n = parseDecimal(l.energyPrice);
                return n === null || Number.isNaN(n) ? null : Math.round(n * 1_000_000) / 1_000_000;
              })(),
            }),
      };
    }),
  };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = nuova bolletta inserita a mano. */
  bill: UtilityBill | null;
  /** Abitazioni esistenti, per scegliere dove va la bolletta. */
  households: Household[];
  onShowPdf?: (bill: UtilityBill) => void;
}

export function BillForm({ open, onOpenChange, bill, households, onShowPdf }: Props) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    control,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: toFormValues(bill, households) });

  // Riapertura o bolletta diversa: si riparte dai suoi dati.
  useEffect(() => {
    if (open) {
      reset(toFormValues(bill, households));
      setServerError(null);
    }
    // `households` fuori dalle dipendenze di proposito: un ricaricamento
    // dell'elenco a form aperto non deve cancellare quello che si sta scrivendo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bill, reset]);

  const lines = useWatch({ control, name: 'lines' });
  const household = useWatch({ control, name: 'household' });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['utility-bills'], refetchType: 'all' });

  const save = useMutation({
    mutationFn: (input: SaveBillInput) => (bill ? billsApi.save(bill.id, input) : billsApi.create(input)),
    onSuccess: async () => {
      await invalidate();
      onOpenChange(false);
    },
    onError: (e: Error) => setServerError(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => billsApi.remove(id),
    onSuccess: async () => {
      await invalidate();
      onOpenChange(false);
    },
    onError: (e: Error) => setServerError(e.message),
  });

  const reextract = useMutation({
    mutationFn: (id: string) => billsApi.reextract(id),
    onSuccess: async () => {
      await invalidate();
      onOpenChange(false);
    },
    onError: (e: Error) => setServerError(e.message),
  });

  const onSubmit = handleSubmit((v) => save.mutate(toInput(v)));

  const onDelete = async () => {
    if (!bill) return;
    const ok = await confirm({
      title: 'Eliminare questa bolletta?',
      description: bill.hasFile
        ? 'Spariscono i dati e il PDF caricato. L’operazione non si può annullare.'
        : 'Spariscono i dati della bolletta. L’operazione non si può annullare.',
      confirmLabel: 'Elimina',
      destructive: true,
    });
    if (ok) remove.mutate(bill.id);
  };

  const status = bill?.status;
  const title = !bill ? 'Nuova bolletta' : status === 'confirmed' ? 'Modifica bolletta' : 'Verifica bolletta';
  const busy = save.isPending || remove.isPending || reextract.isPending;
  const linesError = (errors.lines as { message?: string } | undefined)?.message;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[92dvh] w-full max-w-xl flex-col gap-0 p-0"
        // Come il form dei movimenti: non si perde una compilazione con un tocco fuori.
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {!bill
              ? 'Inserisci i dati letti dalla bolletta.'
              : status === 'confirmed'
                ? 'I dati confermati entrano nei grafici.'
                : 'Controlla i dati e salva: da quel momento entrano nei grafici.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-6 py-5">
            {bill && status === 'review' && bill.extractionModel && (
              <Notice tone="info" icon={Sparkles}>
                Letta automaticamente da {modelLabel(bill.extractionModel)}. Controlla i valori prima di salvare.
              </Notice>
            )}
            {bill && status === 'failed' && (
              <Notice tone="warn" icon={AlertTriangle}>
                <span className="block">
                  {bill.extractionError ?? 'Non sono riuscito a leggere la bolletta.'}
                </span>
                {bill.hasFile ? (
                  <span className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => reextract.mutate(bill.id)}
                      disabled={busy}
                      className="h-8 rounded-full"
                    >
                      <RefreshCw className={cn('h-3.5 w-3.5', reextract.isPending && 'animate-spin')} />
                      Riprova la lettura
                    </Button>
                    <span className="text-xs text-muted-foreground">oppure inserisci i dati qui sotto</span>
                  </span>
                ) : (
                  <span className="mt-1 block">Inserisci i dati a mano.</span>
                )}
              </Notice>
            )}

            {/* Servizi presenti nella bolletta */}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Servizi in bolletta</legend>
              <div className="grid grid-cols-3 gap-2">
                {UTILITIES.map((u) => {
                  const on = lines?.[u]?.enabled;
                  return (
                    <button
                      key={u}
                      type="button"
                      role="checkbox"
                      aria-checked={!!on}
                      onClick={() => setValue(`lines.${u}.enabled`, !on, { shouldValidate: !!errors.lines })}
                      className={cn(
                        'fm-press flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 text-sm font-medium transition-[background-color,border-color] duration-150',
                        on ? 'border-transparent' : 'border-border bg-transparent text-muted-foreground',
                      )}
                      style={on ? { backgroundColor: utilColor(u, 0.12), boxShadow: `inset 0 0 0 1.5px ${utilColor(u, 0.6)}` } : undefined}
                    >
                      <span className={cn('transition-opacity', !on && 'opacity-40 grayscale')}>
                        <UtilityGlyph utility={u} size="sm" />
                      </span>
                      {UTILITY_META[u].label}
                    </button>
                  );
                })}
              </div>
              {linesError && <p className="text-xs text-destructive">{linesError}</p>}
            </fieldset>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Abitazione" className="col-span-2" error={errors.household?.message}>
                <select
                  className="fm-glass-field h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  {...register('household')}
                >
                  <option value="">Nessuna abitazione</option>
                  {households.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                  <option value={NEW_HOUSEHOLD}>Nuova abitazione…</option>
                </select>
              </Field>
              {household === NEW_HOUSEHOLD && (
                <Field label="Indirizzo della nuova abitazione" className="col-span-2" error={errors.newHouseholdAddress?.message}>
                  <Input placeholder="Es. Via Roma 12, 40100 Bologna" {...register('newHouseholdAddress')} />
                </Field>
              )}
              {bill?.supplyAddress && household !== NEW_HOUSEHOLD && (
                <p className="col-span-2 -mt-1.5 text-xs text-muted-foreground">
                  Indirizzo di fornitura letto: {bill.supplyAddress}
                </p>
              )}
              <Field label="Fornitore" className="col-span-2">
                <Input placeholder="Es. Enel Energia" {...register('provider')} />
              </Field>
              <Field label="Periodo dal" error={errors.periodStart?.message}>
                <Input type="date" {...register('periodStart')} />
              </Field>
              <Field label="al" error={errors.periodEnd?.message}>
                <Input type="date" {...register('periodEnd')} />
              </Field>
              <Field label="Totale da pagare" error={errors.total?.message}>
                <Input inputMode="decimal" placeholder="0,00" suffix="€" {...register('total')} />
              </Field>
              <Field label="Numero bolletta">
                <Input {...register('billNumber')} />
              </Field>
              <Field label="Emessa il">
                <Input type="date" {...register('issueDate')} />
              </Field>
              <Field label="Scadenza">
                <Input type="date" {...register('dueDate')} />
              </Field>
            </div>

            {UTILITIES.filter((u) => lines?.[u]?.enabled).map((u) => (
              <LineSection
                key={u}
                utility={u}
                register={register}
                ownPeriod={!!lines?.[u]?.ownPeriod}
                errors={(errors.lines as Record<string, Record<string, { message?: string }>> | undefined)?.[u]}
              />
            ))}

            <Field label="Note">
              <Textarea rows={2} {...register('notes')} />
            </Field>

            {serverError && <p className="text-sm text-destructive">{serverError}</p>}
          </div>

          <DialogFooter className="flex-row items-center gap-1.5 border-t bg-background/60 px-4 py-3 sm:gap-2 sm:space-x-0 sm:px-6">
            {bill && (
              <Button type="button" variant="ghost" size="icon" onClick={onDelete} disabled={busy} aria-label="Elimina bolletta">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            {bill?.hasFile && onShowPdf && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onShowPdf(bill)} aria-label="Vedi il PDF" className="px-2.5 sm:px-3">
                <FileText className="h-4 w-4" /> <span className="hidden sm:inline">PDF</span>
              </Button>
            )}
            {bill?.hasFile && (status === 'failed' || status === 'review') && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => reextract.mutate(bill.id)}
                disabled={busy}
                aria-label="Rileggi il PDF"
                className="px-2.5 sm:px-3"
              >
                <RefreshCw className={cn('h-4 w-4', reextract.isPending && 'animate-spin')} /> <span className="hidden sm:inline">Rileggi</span>
              </Button>
            )}
            <span className="flex-1" />
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="px-3">
              Chiudi
            </Button>
            <Button type="submit" disabled={busy}>
              <Check className="h-4 w-4" />
              {bill && status !== 'confirmed' ? 'Conferma' : 'Salva'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LineSection({
  utility,
  register,
  ownPeriod,
  errors,
}: {
  utility: UtilityKind;
  register: UseFormRegister<FormValues>;
  ownPeriod: boolean;
  errors?: Record<string, { message?: string }>;
}) {
  const meta = UTILITY_META[utility];
  return (
    <section
      className="space-y-3 rounded-2xl p-4"
      style={{ backgroundColor: utilColor(utility, 0.07), boxShadow: `inset 0 0 0 1px ${utilColor(utility, 0.18)}` }}
      aria-label={meta.label}
    >
      <header className="flex items-center gap-2.5">
        <UtilityGlyph utility={utility} size="sm" />
        <h3 className="text-[15px] font-semibold">{meta.label}</h3>
      </header>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Consumo" error={errors?.consumption?.message}>
          <Input inputMode="decimal" placeholder="0" suffix={meta.unit} {...register(`lines.${utility}.consumption`)} />
        </Field>
        <Field label="Costo" error={errors?.cost?.message}>
          <Input inputMode="decimal" placeholder="0,00" suffix="€" {...register(`lines.${utility}.cost`)} />
        </Field>
        {utility !== 'water' && (
          <>
            <Field label="Materia prima" error={errors?.energyPrice?.message}>
              <Input inputMode="decimal" placeholder="0,000000" suffix={meta.priceUnit} {...register(`lines.${utility}.energyPrice`)} />
            </Field>
            <Field label="Spesa materia prima" error={errors?.energyCost?.message}>
              <Input inputMode="decimal" placeholder="0,00" suffix="€" {...register(`lines.${utility}.energyCost`)} />
            </Field>
          </>
        )}
        <Field label={meta.codeLabel} className="col-span-2">
          <Input autoCapitalize="characters" spellCheck={false} {...register(`lines.${utility}.supplyCode`)} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" {...register(`lines.${utility}.estimated`)} />
          Lettura stimata
        </label>
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" {...register(`lines.${utility}.ownPeriod`)} />
          Periodo diverso dalla bolletta
        </label>
      </div>
      {ownPeriod && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Dal">
            <Input type="date" {...register(`lines.${utility}.periodStart`)} />
          </Field>
          <Field label="Al" error={errors?.periodEnd?.message}>
            <Input type="date" {...register(`lines.${utility}.periodEnd`)} />
          </Field>
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  // Etichetta collegata al campo: nome accessibile per VoiceOver e, su
  // iPhone, toccare l'etichetta porta il fuoco nel campo.
  const id = useId();
  const errorId = `${id}-error`;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': error ? errorId : undefined,
      })
    : children;
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <Label htmlFor={id} className="text-[13px] text-muted-foreground">
        {label}
      </Label>
      {control}
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function Notice({
  tone,
  icon: Icon,
  children,
}: {
  tone: 'info' | 'warn';
  icon: typeof Sparkles;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex gap-2.5 rounded-xl px-3.5 py-3 text-sm',
        tone === 'info' ? 'bg-accent text-accent-foreground' : 'bg-[hsl(var(--warn-soft))] text-foreground',
      )}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', tone === 'warn' && 'text-[hsl(var(--warn))]')} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function modelLabel(model: string): string {
  const [provider, ...rest] = model.split(':');
  const name = rest.join(':');
  return provider === 'opencode' ? `OpenCode (${name})` : provider === 'ollama' ? `Ollama (${name}, modello locale)` : model;
}
