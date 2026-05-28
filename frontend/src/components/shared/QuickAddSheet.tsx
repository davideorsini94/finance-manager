import { useEffect, useState } from 'react';
import { Plus, X, Calendar, FileText, Tag, Wallet } from 'lucide-react';
import { authFetch } from '@/lib/auth-fetch';

interface Account { id: string; name: string }
interface Category { id: string; name: string; type: string }

/**
 * Bottom sheet per quick-add transazione, ottimizzato mobile.
 * Apertura con FAB (floating action button) o da shortcut "/quick-add".
 */
export function QuickAddSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: () => void }) {
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    void Promise.all([
      authFetch('/api/accounts').then((r) => r.json()),
      authFetch('/api/categories').then((r) => r.json()),
    ]).then(([a, c]) => {
      setAccounts(a);
      setCategories(c);
      if (a[0]) setAccountId(a[0].id);
    });
  }, [open]);

  const filteredCats = categories.filter((c) => c.type === type || c.type === 'transfer');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !accountId) return;
    setSubmitting(true);
    try {
      const cents = Math.round(parseFloat(amount.replace(',', '.')) * 100);
      await authFetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId,
          categoryId: categoryId || undefined,
          type,
          amountCents: type === 'expense' ? -Math.abs(cents) : Math.abs(cents),
          transactionDate: date,
          description: description || undefined,
        }),
      });
      // Reset
      setAmount(''); setDescription(''); setCategoryId('');
      onCreated?.();
      onClose();
    } finally { setSubmitting(false); }
  };

  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 transition-opacity" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-white shadow-2xl dark:bg-slate-900 animate-[slideUp_0.25s_ease-out]" style={{ maxHeight: '92vh' }}>
        <div className="mx-auto my-2 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700" />

        <div className="flex items-center justify-between px-5 pb-3">
          <h2 className="text-lg font-semibold">Nuovo movimento</h2>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 overflow-y-auto px-5 pb-8" style={{ maxHeight: 'calc(92vh - 60px)' }}>
          {/* Type segmented */}
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            <button type="button" onClick={() => setType('expense')} className={`rounded-md py-2.5 text-sm font-medium transition ${type === 'expense' ? 'bg-rose-500 text-white' : 'text-slate-600 dark:text-slate-300'}`}>
              − Spesa
            </button>
            <button type="button" onClick={() => setType('income')} className={`rounded-md py-2.5 text-sm font-medium transition ${type === 'income' ? 'bg-emerald-500 text-white' : 'text-slate-600 dark:text-slate-300'}`}>
              + Entrata
            </button>
          </div>

          {/* Amount — grande, focus auto */}
          <div className="text-center">
            <div className={`mx-auto inline-flex items-baseline gap-2 ${type === 'expense' ? 'text-rose-600' : 'text-emerald-600'}`}>
              <span className="text-3xl font-light">€</span>
              <input
                type="text" inputMode="decimal" autoFocus
                placeholder="0,00" value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d,.]/g, ''))}
                className="w-48 border-0 bg-transparent p-0 text-center text-5xl font-semibold tracking-tight focus:outline-none focus:ring-0"
              />
            </div>
          </div>

          {/* Account */}
          <Field icon={<Wallet className="h-4 w-4" />} label="Conto">
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="w-full bg-transparent text-base focus:outline-none">
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>

          {/* Category */}
          <Field icon={<Tag className="h-4 w-4" />} label="Categoria">
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full bg-transparent text-base focus:outline-none">
              <option value="">— scegli —</option>
              {filteredCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>

          {/* Description */}
          <Field icon={<FileText className="h-4 w-4" />} label="Descrizione">
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="opzionale"
              className="w-full bg-transparent text-base placeholder:text-slate-400 focus:outline-none" />
          </Field>

          {/* Date */}
          <Field icon={<Calendar className="h-4 w-4" />} label="Data">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full bg-transparent text-base focus:outline-none" />
          </Field>

          <button type="submit" disabled={submitting || !amount || !accountId}
            className={`w-full rounded-lg py-3.5 text-base font-semibold text-white transition ${type === 'expense' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'} disabled:opacity-50`}>
            {submitting ? 'Salvataggio…' : 'Salva'}
          </button>
        </form>
      </div>
      <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
    </>
  );
}

function Field({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
      <div className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-500">
        {icon} {label}
      </div>
      {children}
    </div>
  );
}

/**
 * Floating Action Button da mostrare in fondo a destra su mobile.
 * Aprire QuickAddSheet al click.
 */
export function QuickAddFab({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-600/30 hover:bg-blue-700 active:scale-95 lg:hidden"
      aria-label="Nuovo movimento">
      <Plus className="h-6 w-6" />
    </button>
  );
}
