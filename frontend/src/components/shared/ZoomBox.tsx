import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

/** Dimensioni interne del riquadro, al netto del bordo. */
export interface BoxSize {
  width: number;
  height: number;
}

interface Props {
  /**
   * Il contenuto, dimensionato dal chiamante in funzione del riquadro: a
   * `zoom` 1 deve starci **tutto dentro** (è il significato di "adatta"), a
   * zoom N essere N volte più grande. Il riquadro non lo ridimensiona da sé:
   * così un PDF può ridisegnarsi nitido alla scala nuova invece di essere una
   * bitmap stirata.
   */
  children: (stato: { box: BoxSize; zoom: number }) => ReactNode;
  maxZoom?: number;
  /** Classi del riquadro: di norma solo il pavimento d'altezza (`min-h-*`). */
  className?: string;
}

const MIN_ZOOM = 1;
/** Zoom del doppio tap/doppio click, quando si è al 100%. */
const ZOOM_DOPPIO_TAP = 2.5;
/** Due tap più vicini di così (ms, px) sono un doppio tap. */
const DOPPIO_TAP_MS = 300;
const DOPPIO_TAP_PX = 30;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Riquadro ad altezza fissa che tiene il contenuto dentro lo schermo e lo
 * lascia ingrandire.
 *
 * Lo spostamento è lo **scorrimento nativo** del riquadro, non una transform
 * con pan a mano: si eredita gratis l'inerzia di iOS, le barre su desktop e il
 * caso multipagina (si scorre alla pagina dopo). Lo zoom cambia la dimensione
 * di layout del contenuto, quindi chi disegna su canvas ridisegna nitido.
 *
 * Il pinch fa eccezione: mentre le dita si muovono servono 60 fotogrammi al
 * secondo, quindi si scala con una `transform` (nessun ridisegno) e si
 * consolida il valore a gesto finito. Ogni cambio di zoom tiene fermo il punto
 * indicato — cursore, centro delle dita o centro del riquadro — correggendo lo
 * scorrimento subito dopo il ridisegno.
 *
 * Gesture: Ctrl/⌘ + rotellina (la rotellina liscia scorre), pinch a due dita,
 * doppio click e doppio tap, più i pulsanti sotto.
 */
export function ZoomBox({ children, maxZoom = 5, className }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<BoxSize>({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  // Zoom "vivo" del pinch: solo una transform, il contenuto non si ridisegna.
  // Tenuto anche in un ref perché a fine gesto va letto fuori da un render.
  const [live, setLive] = useState(1);
  const liveRef = useRef(1);
  const aggiornaLive = useCallback((v: number) => {
    liveRef.current = v;
    setLive(v);
  }, []);
  const [origine, setOrigine] = useState({ x: 0, y: 0 });
  // Punto da tenere fermo, salvato prima del ridisegno e usato subito dopo.
  const fermo = useRef<{ cx: number; cy: number; px: number; py: number } | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const misura = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    misura();
    const observer = new ResizeObserver(misura);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** Porta lo zoom a `next` tenendo fermo il punto (`clientX`,`clientY`). */
  const zoomaSu = useCallback(
    (next: number, clientX?: number, clientY?: number) => {
      const el = boxRef.current;
      if (!el) return;
      const z = clamp(next, MIN_ZOOM, maxZoom);
      if (Math.abs(z - zoom) < 0.001) return;
      const r = el.getBoundingClientRect();
      const px = clientX === undefined ? el.clientWidth / 2 : clientX - r.left;
      const py = clientY === undefined ? el.clientHeight / 2 : clientY - r.top;
      // Il punto sotto il dito, in coordinate del contenuto a zoom 1.
      fermo.current = {
        cx: (el.scrollLeft + px) / zoom,
        cy: (el.scrollTop + py) / zoom,
        px,
        py,
      };
      setZoom(z);
    },
    [maxZoom, zoom],
  );

  // Dopo il ridisegno alla scala nuova rimetto lo scorrimento dov'era il punto.
  useLayoutEffect(() => {
    const el = boxRef.current;
    const p = fermo.current;
    if (!el || !p) return;
    fermo.current = null;
    el.scrollLeft = p.cx * zoom - p.px;
    el.scrollTop = p.cy * zoom - p.py;
  }, [zoom]);

  // Rotellina: con Ctrl/⌘ zooma, da sola scorre. Il listener è registrato a
  // mano perché serve `passive: false` per poter annullare lo zoom del browser.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomaSu(zoom * Math.exp(-e.deltaY / 300), e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, zoomaSu]);

  // Pinch a due dita.
  const pinch = useRef<{ dist: number; px: number; py: number; cx: number; cy: number } | null>(null);
  const ultimoTap = useRef({ t: 0, x: 0, y: 0 });

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;

    const distanza = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const r = el.getBoundingClientRect();
      const px = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
      const py = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
      pinch.current = {
        dist: distanza(e.touches),
        px,
        py,
        cx: (el.scrollLeft + px) / zoom,
        cy: (el.scrollTop + py) / zoom,
      };
      // Origine della transform in coordinate del contenuto **alla scala
      // attuale**: è lì che deve restare incollato il centro delle dita.
      setOrigine({ x: pinch.current.cx * zoom, y: pinch.current.cy * zoom });
    };

    const onMove = (e: TouchEvent) => {
      const p = pinch.current;
      if (!p || e.touches.length !== 2) return;
      // Senza questo iOS si porta via il gesto come zoom di pagina.
      e.preventDefault();
      const ratio = distanza(e.touches) / p.dist;
      aggiornaLive(clamp(ratio, MIN_ZOOM / zoom, maxZoom / zoom));
    };

    const onEnd = (e: TouchEvent) => {
      const p = pinch.current;
      if (p && e.touches.length < 2) {
        pinch.current = null;
        const l = liveRef.current;
        aggiornaLive(1);
        if (Math.abs(l - 1) > 0.01) {
          fermo.current = { cx: p.cx, cy: p.cy, px: p.px, py: p.py };
          setZoom(clamp(zoom * l, MIN_ZOOM, maxZoom));
        }
        return;
      }
      // Doppio tap (un dito solo): alterna 100% e 250% sul punto toccato.
      if (e.touches.length === 0 && e.changedTouches.length === 1) {
        const t = e.changedTouches[0];
        const ora = Date.now();
        const prec = ultimoTap.current;
        if (
          ora - prec.t < DOPPIO_TAP_MS &&
          Math.hypot(t.clientX - prec.x, t.clientY - prec.y) < DOPPIO_TAP_PX
        ) {
          zoomaSu(zoom > MIN_ZOOM ? MIN_ZOOM : ZOOM_DOPPIO_TAP, t.clientX, t.clientY);
          ultimoTap.current = { t: 0, x: 0, y: 0 };
        } else {
          ultimoTap.current = { t: ora, x: t.clientX, y: t.clientY };
        }
      }
    };

    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
  }, [aggiornaLive, maxZoom, zoom, zoomaSu]);

  // Trascinamento col mouse quando si è ingranditi (su touch scorre già da sé).
  const trascina = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || zoom === MIN_ZOOM || e.button !== 0) return;
    const el = boxRef.current;
    if (!el) return;
    trascina.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
    el.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = trascina.current;
    const el = boxRef.current;
    if (!d || !el) return;
    el.scrollLeft = d.sl - (e.clientX - d.x);
    el.scrollTop = d.st - (e.clientY - d.y);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    trascina.current = null;
    boxRef.current?.releasePointerCapture?.(e.pointerId);
  };

  const adatta = () => {
    zoomaSu(MIN_ZOOM);
    const el = boxRef.current;
    if (el) el.scrollTo({ top: 0, left: 0 });
  };

  const percentuale = Math.round(zoom * live * 100);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div
        ref={boxRef}
        className={cn(
          // `flex-1 min-h-0`: il riquadro prende lo spazio che avanza nel
          // Dialog e cede quando lo schermo è corto, invece di avere
          // un'altezza fissa in dvh che su una finestra bassa sfonderebbe.
          'relative min-h-0 flex-1 overflow-auto overscroll-contain rounded-md border bg-muted/30',
          zoom > MIN_ZOOM && 'cursor-grab active:cursor-grabbing',
          className,
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) =>
          zoomaSu(zoom > MIN_ZOOM ? MIN_ZOOM : ZOOM_DOPPIO_TAP, e.clientX, e.clientY)
        }
      >
        <div
          className="mx-auto flex min-h-full w-max min-w-full items-center justify-center"
          style={
            live === 1
              ? undefined
              : { transform: `scale(${live})`, transformOrigin: `${origine.x}px ${origine.y}px` }
          }
        >
          {box.width > 0 && children({ box, zoom })}
        </div>
      </div>

      <div className="flex items-center justify-center gap-1">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-9 w-9"
          onClick={() => zoomaSu(zoom / 1.4)}
          disabled={zoom <= MIN_ZOOM}
          aria-label="Riduci"
        >
          <Minus className="h-4 w-4" />
        </Button>
        <span className="min-w-14 text-center text-xs tabular-nums text-muted-foreground">
          {percentuale}%
        </span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-9 w-9"
          onClick={() => zoomaSu(zoom * 1.4)}
          disabled={zoom >= maxZoom}
          aria-label="Ingrandisci"
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-9 gap-1.5 px-2 text-xs"
          onClick={adatta}
          disabled={zoom <= MIN_ZOOM}
        >
          <Maximize2 className="h-3.5 w-3.5" /> Adatta
        </Button>
      </div>
    </div>
  );
}
