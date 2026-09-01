import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  File as FileIcon,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils/cn';
import { useUIStore } from '@/store/uiStore';
import { demoAttachmentFile } from '@/lib/demo/attachments';
import { ImagePreview } from './ImagePreview';
import type { AttachmentSummary } from '@/types/domain';

// pdfjs pesa qualche centinaio di KB: entra in un chunk separato, caricato solo
// quando si apre davvero un PDF.
const PdfPreview = lazy(() => import('./PdfPreview'));

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';

interface Props {
  attachments: AttachmentSummary[];
  /** Allegato da mostrare all'apertura (default: il primo). */
  initialIndex?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type LoadState = 'idle' | 'loading' | 'ok' | 'error';

/**
 * Anteprima degli allegati di un movimento, con navigazione se sono più di uno.
 *
 * Strategia di caricamento (invariata rispetto alla vecchia `InlinePreview`):
 * le presigned URL di MinIO puntano all'hostname interno docker e non sono
 * raggiungibili dal browser, quindi scarichiamo il binario da
 * `/api/attachments/:id/content` con `fetch` (stesso-origin, cookie JWT) e lo
 * trasformiamo in un `blob:` URL.
 *
 * Il rendering invece è cambiato: i PDF passano da pdf.js su canvas
 * (`PdfPreview`) e non più da un `<iframe src="blob:…">`, che su iPhone in PWA
 * standalone restava bianco.
 *
 * Del file scaricato teniamo **due** riferimenti, e non è ridondanza:
 * - il `Blob`, che va a pdf.js — che così legge in memoria e non fa richieste;
 * - il `blob:` URL, per `<img>`, download e "apri in nuova scheda".
 * La CSP di nginx ha `img-src ... blob:` e `frame-src ... blob:` ma
 * `connect-src 'self'`: un fetch/XHR verso un `blob:` URL viene bloccato
 * (vedi il commento in `PdfPreview`).
 */
export function AttachmentPreviewDialog({
  attachments,
  initialIndex = 0,
  open,
  onOpenChange,
}: Props) {
  const isDemo = useUIStore((s) => s.demoData);
  const [index, setIndex] = useState(initialIndex);
  const [state, setState] = useState<LoadState>('idle');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [filename, setFilename] = useState('allegato');
  const [errorMsg, setErrorMsg] = useState('');
  // Incrementato dal bottone "Riprova": rilancia l'effect di fetch.
  const [retry, setRetry] = useState(0);

  const total = attachments.length;
  const current: AttachmentSummary | undefined = attachments[index];

  // All'apertura riparto sempre dall'allegato richiesto dal chiamante.
  useEffect(() => {
    if (open) setIndex(initialIndex);
  }, [open, initialIndex]);

  const attachmentId = current?.id;
  const demoFile = isDemo && attachmentId ? demoAttachmentFile(attachmentId) : null;
  const remoteUrl = attachmentId
    ? (demoFile ?? `${API_BASE}/attachments/${attachmentId}/content`)
    : null;

  useEffect(() => {
    if (!open || !remoteUrl) {
      setState('idle');
      setErrorMsg('');
      return;
    }

    const controller = new AbortController();
    let objectUrl: string | null = null;
    setState('loading');
    setErrorMsg('');
    setFilename(current?.filename ?? 'allegato');

    fetch(remoteUrl, { credentials: 'include', signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // Nome file dal Content-Disposition quando c'è, altrimenti quello dei
        // metadati già in pagina.
        const cd = res.headers.get('Content-Disposition') ?? '';
        const utf8Match = cd.match(/filename\*=UTF-8''([^;]+)/i);
        const asciiMatch = cd.match(/filename="?([^";]+)"?/i);
        const fname = utf8Match
          ? decodeURIComponent(utf8Match[1])
          : asciiMatch
            ? asciiMatch[1]
            : (current?.filename ?? 'allegato');
        const contentType = res.headers.get('Content-Type') ?? current?.mimeType ?? '';
        const blob = await res.blob();
        // Safari a volte non popola `blob.type` dalle risposte fetch: lo
        // forziamo al MIME dichiarato dal server, serve a pdf.js e al download.
        const typedBlob = blob.type ? blob : new Blob([blob], { type: contentType });
        objectUrl = URL.createObjectURL(typedBlob);
        setFilename(fname);
        setBlob(typedBlob);
        setBlobUrl(objectUrl);
        setState('ok');
      })
      .catch((err: Error) => {
        if (err.name === 'AbortError') return;
        setErrorMsg(err.message || 'Errore di caricamento');
        setState('error');
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setBlobUrl(null);
      setBlob(null);
    };
    // `current` cambia insieme a `remoteUrl`: dipendere dall'oggetto farebbe
    // rifetchare a ogni render del genitore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, remoteUrl, retry]);

  const goPrev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const goNext = useCallback(
    () => setIndex((i) => Math.min(attachments.length - 1, i + 1)),
    [attachments.length],
  );

  const mimeType = current?.mimeType ?? '';
  const isImage = mimeType.startsWith('image/');
  const isPdf = mimeType === 'application/pdf';
  const ready = state === 'ok' && blobUrl !== null;
  // Con un visualizzatore dentro, la modale prende un'altezza **fissa**: il
  // riquadro deve essere una finestra stabile, se la prendesse dal contenuto
  // crescerebbe mentre si zooma. Senza (errore, caricamento, tipo di file non
  // visualizzabile) resta alta quanto basta.
  const conVisualizzatore = ready && (isImage || (isPdf && blob !== null));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'flex max-h-[92dvh] max-w-3xl flex-col overflow-y-auto',
          conVisualizzatore && 'h-[92dvh]',
        )}
      >
        <DialogHeader>
          <div className="flex items-center gap-2 pr-8">
            <DialogTitle className="min-w-0 flex-1 truncate text-left text-base sm:text-lg">
              {filename}
            </DialogTitle>
            {ready ? (
              <a
                href={blobUrl ?? undefined}
                download={filename}
                aria-label="Scarica allegato"
                title="Scarica"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-accent"
              >
                <Download className="h-4 w-4" />
              </a>
            ) : (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-9 w-9 shrink-0"
                disabled
                aria-label="Scarica allegato"
              >
                <Download className="h-4 w-4" />
              </Button>
            )}
          </div>
          {total > 1 && (
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-10 w-10"
                onClick={goPrev}
                disabled={index === 0}
                aria-label="Allegato precedente"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted-foreground">
                {index + 1} di {total}
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-10 w-10"
                onClick={goNext}
                disabled={index === total - 1}
                aria-label="Allegato successivo"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </DialogHeader>

        {state === 'loading' && (
          <div className="flex min-h-[40dvh] items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Caricamento…
          </div>
        )}

        {state === 'error' && (
          <div className="flex min-h-[30dvh] flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-destructive">
              Impossibile caricare l'anteprima.{errorMsg && ` (${errorMsg})`}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setRetry((n) => n + 1)}>
                Riprova
              </Button>
              {remoteUrl && (
                <a
                  href={remoteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                >
                  <ExternalLink className="h-4 w-4" /> Apri in nuova scheda
                </a>
              )}
            </div>
          </div>
        )}

        {ready && blobUrl && (
          <>
            {isImage ? (
              <ImagePreview url={blobUrl} alt={filename} />
            ) : isPdf && blob ? (
              <Suspense
                fallback={
                  <div className="flex min-h-[40dvh] items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Caricamento PDF…
                  </div>
                }
              >
                <PdfPreview file={blob} downloadUrl={blobUrl} filename={filename} />
              </Suspense>
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-md border p-6 text-center">
                <FileIcon className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Tipo di file non visualizzabile in anteprima.
                </p>
                <a
                  href={blobUrl}
                  download={filename}
                  className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                >
                  <Download className="h-4 w-4" /> Scarica file
                </a>
              </div>
            )}
            <div className="flex justify-end">
              <a
                href={blobUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3" /> Apri in nuova scheda
              </a>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
