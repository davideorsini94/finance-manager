import { useEffect, useState } from 'react';
import { Bell, Mail } from 'lucide-react';
import { api } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

type NotificationType =
  | 'budget_threshold'
  | 'recurring_executed'
  | 'cc_payment_due'
  | 'goal_reached'
  | 'large_transaction'
  | 'account_shared'
  | 'import_ready'
  | 'bank_sync_review'
  | 'bank_sync_consent'
  | 'system';

type Channel = 'in_app' | 'email';

interface Pref {
  type: NotificationType;
  channel: Channel;
  enabled: boolean;
}

const TYPE_LABELS: Record<NotificationType, { title: string; desc: string }> = {
  budget_threshold: {
    title: 'Soglia budget superata',
    desc: "Quando una categoria raggiunge l'80% o il 100% del budget mensile.",
  },
  recurring_executed: {
    title: 'Movimento ricorrente generato',
    desc: 'Quando una regola crea automaticamente una transazione.',
  },
  cc_payment_due: {
    title: 'Saldo carta di credito in scadenza',
    desc: 'Promemoria 3 giorni prima del prelievo automatico.',
  },
  goal_reached: {
    title: 'Obiettivo raggiunto',
    desc: 'Quando un obiettivo di risparmio raggiunge il target.',
  },
  large_transaction: {
    title: 'Movimento di importo rilevante',
    desc: 'Transazioni superiori al 95° percentile della tua attività recente.',
  },
  account_shared: {
    title: 'Conto condiviso con te',
    desc: 'Quando qualcuno ti aggiunge come membro o viewer.',
  },
  import_ready: {
    title: 'Import CSV pronto',
    desc: "Quando l'analisi AI di un import è completata.",
  },
  bank_sync_review: {
    title: 'Movimenti bancari da rivedere',
    desc: 'Quando la sincronizzazione bancaria importa nuovi movimenti in attesa di revisione.',
  },
  bank_sync_consent: {
    title: 'Consenso bancario in scadenza',
    desc: 'Quando il consenso a un collegamento bancario sta per scadere o è scaduto.',
  },
  system: {
    title: 'Avvisi di sistema',
    desc: 'Aggiornamenti, manutenzione, messaggi tecnici.',
  },
};

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-muted',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

export function NotificationsPreferences() {
  const [prefs, setPrefs] = useState<Pref[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [testType, setTestType] = useState<NotificationType>('system');

  useEffect(() => {
    void (async () => {
      const data = await api.get('notifications/preferences').json<Pref[]>();
      setPrefs(data);
    })();
  }, []);

  const toggle = async (type: NotificationType, channel: Channel, enabled: boolean) => {
    if (!prefs) return;
    const next = prefs.map((p) =>
      p.type === type && p.channel === channel ? { ...p, enabled } : p,
    );
    setPrefs(next);
    setSaving(true);
    try {
      await api.patch('notifications/preferences', {
        json: { items: [{ type, channel, enabled }] },
      });
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    await api.post('notifications/test', { json: { type: testType } });
  };

  if (!prefs) {
    return <div className="p-6 text-sm text-muted-foreground">Caricamento preferenze…</div>;
  }

  const lookup = (type: NotificationType, channel: Channel) =>
    prefs.find((p) => p.type === type && p.channel === channel)?.enabled ?? true;

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold">Preferenze notifiche</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Scegli per ogni evento se ricevere una notifica nell'app, via email, entrambe o nessuna.
          {saving && <span className="ml-2 text-primary">Salvataggio…</span>}
        </p>
      </header>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Evento</th>
              <th className="w-32 px-4 py-3 text-center font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <Bell className="h-3.5 w-3.5" /> In-app
                </span>
              </th>
              <th className="w-32 px-4 py-3 text-center font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" /> Email
                </span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y bg-card">
            {(Object.keys(TYPE_LABELS) as NotificationType[]).map((type) => (
              <tr key={type}>
                <td className="px-4 py-3">
                  <div className="font-medium">{TYPE_LABELS[type].title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{TYPE_LABELS[type].desc}</div>
                </td>
                <td className="px-4 py-3 text-center">
                  <Toggle
                    checked={lookup(type, 'in_app')}
                    onChange={(v) => toggle(type, 'in_app', v)}
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <Toggle
                    checked={lookup(type, 'email')}
                    onChange={(v) => toggle(type, 'email', v)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-dashed p-4">
        <div className="text-sm font-medium">Invia notifica di test</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Verifica che l'integrazione funzioni — apparirà subito nella campanella in alto a destra.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <select
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
            value={testType}
            onChange={(e) => setTestType(e.target.value as NotificationType)}
          >
            {(Object.keys(TYPE_LABELS) as NotificationType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t].title}
              </option>
            ))}
          </select>
          <Button type="button" size="sm" onClick={sendTest}>
            Invia test
          </Button>
        </div>
      </div>
    </div>
  );
}
