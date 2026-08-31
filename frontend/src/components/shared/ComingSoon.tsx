import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function ComingSoon({ labelKey }: { labelKey: string }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold tracking-tight">{t(labelKey)}</h1>
      <Card>
        <CardHeader>
          <CardTitle>In arrivo</CardTitle>
          <CardDescription>Questa sezione sarà disponibile nella prossima milestone.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Tutta la struttura backend e l'autenticazione sono pronte. Le pagine funzionali
          (movimenti, conti, report, chat LLM, import) saranno implementate nelle milestone M2-M4.
        </CardContent>
      </Card>
    </div>
  );
}
