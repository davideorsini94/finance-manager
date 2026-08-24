import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CollapsibleCard } from '@/components/ui/collapsible-card';

/**
 * Diagnostica del viewport, pensata per il debug dei problemi iOS standalone
 * (bande nere sotto la BottomNav, viewport che non riempie lo schermo, pan
 * residuo dopo la tastiera — vedi ios-viewport.ts e il grafo "PWA e Mobile").
 * Mostra i numeri live di screen / layout viewport / visual viewport /
 * unità dvh-svh-lvh / safe-area, così il confronto tra i valori individua
 * DOVE finisce lo spazio (dentro la webview → CSS, fuori → sistema iOS).
 */

interface Metrics {
  screenW: number;
  screenH: number;
  innerW: number;
  innerH: number;
  vvW: number | null;
  vvH: number | null;
  vvOffsetTop: number | null;
  vvScale: number | null;
  dvh: number;
  svh: number;
  lvh: number;
  safeTop: string;
  safeBottom: string;
  standalone: boolean;
  rootH: number;
  lvhFix: string;
}

function readMetrics(probe: HTMLDivElement | null): Metrics {
  const vv = window.visualViewport;
  const cs = getComputedStyle(document.documentElement);
  // Le sonde misurano l'altezza effettiva in px delle unità viewport.
  const probeH = (cls: string) => {
    const el = probe?.querySelector<HTMLDivElement>(`.${cls}`);
    return el ? Math.round(el.getBoundingClientRect().height) : 0;
  };
  return {
    screenW: window.screen.width,
    screenH: window.screen.height,
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    vvW: vv ? Math.round(vv.width) : null,
    vvH: vv ? Math.round(vv.height) : null,
    vvOffsetTop: vv ? Math.round(vv.offsetTop) : null,
    vvScale: vv ? Math.round(vv.scale * 100) / 100 : null,
    dvh: probeH('fm-probe-dvh'),
    svh: probeH('fm-probe-svh'),
    lvh: probeH('fm-probe-lvh'),
    safeTop: cs.getPropertyValue('--safe-top').trim() || '0px',
    safeBottom: cs.getPropertyValue('--safe-bottom').trim() || '0px',
    standalone:
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true,
    rootH: Math.round(
      document.getElementById('root')?.getBoundingClientRect().height ?? 0,
    ),
    lvhFix: cs.getPropertyValue('--fm-lvh-fix').trim() || 'n/d',
  };
}

export function ViewportDiagnosticsCard() {
  const probeRef = useRef<HTMLDivElement | null>(null);
  const [m, setM] = useState<Metrics | null>(null);

  const refresh = useCallback(() => setM(readMetrics(probeRef.current)), []);

  useEffect(() => {
    refresh();
    const vv = window.visualViewport;
    window.addEventListener('resize', refresh);
    window.addEventListener('orientationchange', refresh);
    vv?.addEventListener('resize', refresh);
    vv?.addEventListener('scroll', refresh);
    return () => {
      window.removeEventListener('resize', refresh);
      window.removeEventListener('orientationchange', refresh);
      vv?.removeEventListener('resize', refresh);
      vv?.removeEventListener('scroll', refresh);
    };
  }, [refresh]);

  // Delta chiave: quanto layout viewport manca rispetto allo schermo intero.
  const missing = m ? m.screenH - m.innerH : 0;

  const rows: Array<[string, string]> = m
    ? [
        ['screen', `${m.screenW} × ${m.screenH}`],
        ['window.inner', `${m.innerW} × ${m.innerH}`],
        ['schermo − layout (Δh)', `${missing}px`],
        [
          'visualViewport',
          m.vvH === null
            ? 'n/d'
            : `${m.vvW} × ${m.vvH} (top ${m.vvOffsetTop}px, zoom ${m.vvScale})`,
        ],
        ['100dvh / 100svh / 100lvh', `${m.dvh} / ${m.svh} / ${m.lvh}px`],
        ['safe-area top / bottom', `${m.safeTop} / ${m.safeBottom}`],
        ['display-mode', m.standalone ? 'standalone (PWA)' : 'browser'],
        ['#root (shell) effettivo', `${m.rootH}px`],
        ['--fm-lvh-fix (workaround iOS 26)', m.lvhFix],
      ]
    : [];

  return (
    <CollapsibleCard
      title="Diagnostica schermo"
      description="Valori live del viewport, per il debug dei problemi di layout su iPhone (bande nere, spazio non usato). I valori si aggiornano da soli quando il viewport cambia (rotazione, tastiera)."
      defaultOpen={false}
      storageKey="fm-cfg-diag"
    >
      <div className="space-y-3">
        {/* Sonde invisibili per misurare le unità viewport in px reali */}
        <div ref={probeRef} aria-hidden className="pointer-events-none fixed left-0 top-0 w-0 invisible">
          <div className="fm-probe-dvh absolute w-0 h-[100dvh]" />
          <div className="fm-probe-svh absolute w-0 h-[100svh]" />
          <div className="fm-probe-lvh absolute w-0 h-[100lvh]" />
        </div>

        <dl className="space-y-1 font-mono text-xs">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right">{value}</dd>
            </div>
          ))}
        </dl>

        <Button type="button" variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="h-3.5 w-3.5 mr-2" />
          Aggiorna
        </Button>
      </div>
    </CollapsibleCard>
  );
}
