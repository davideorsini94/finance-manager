import { useState } from 'react';
import { Mail, CheckCircle2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requestPasswordReset } from './authApi';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultEmail?: string;
}

export function ForgotPasswordDialog({ open, onOpenChange, defaultEmail }: Props) {
  const [email, setEmail] = useState(defaultEmail ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const reset = () => {
    setEmail(defaultEmail ?? '');
    setSubmitting(false);
    setDone(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      await requestPasswordReset(email.trim().toLowerCase());
      setDone(true);
    } catch {
      // L'API risponde uniformemente "ok" anche per email inesistenti per
      // evitare user-enumeration. Solo errori di rete arrivano qui: in tal
      // caso mostriamo lo stesso messaggio "controlla la posta".
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Recupera password</DialogTitle>
          <DialogDescription>
            Inserisci l'email del tuo account: ti invieremo un link per impostare una nuova
            password (valido 1 ora).
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-4 py-4">
            <div className="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" />
              <p>
                Se l'indirizzo è associato a un account, riceverai a breve un'email con il link
                per il reset. Controlla anche la cartella spam.
              </p>
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Chiudi
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="forgot-email">Email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  className="pl-9"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@esempio.it"
                  required
                />
              </div>
            </div>
            <DialogFooter className="sm:space-x-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Annulla
              </Button>
              <Button type="submit" disabled={submitting || !email.trim()}>
                {submitting ? 'Invio…' : 'Invia link reset'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
