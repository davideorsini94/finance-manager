import { useEffect, useRef, useState } from 'react';
import { Eye, Download, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  attachmentId: string;
  mimeType: string;
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';

/**
 * Anteprima inline degli allegati. Strategia:
 *
 *  1. Le presigned URL di MinIO non funzionano dal browser perché
 *     puntano a `http://minio:9000` (hostname interno docker).
 *  2. L'endpoint streaming `/api/attachments/:id/content` risponde con il
 *     binario, ma usare `<iframe src="/api/...">` direttamente con un PDF
 *     dietro JWT-cookie è fragile: alcune versioni di Chrome PDF viewer
 *     rifiutano il caricamento (errore "Failed to load PDF document"
 *     mostrato come "Not Found"), e Safari ha restrizioni sugli iframe
 *     cross-document.
 *  3. La soluzione più portabile: scaricare il file con `fetch()`
 *     (stesso-origin, cookie auth inviati), trasformarlo in `Blob`,
 *     ottenere un `blob:` URL e passarlo a iframe / img. Funziona su
 *     Chrome, Safari, Firefox.
 */
export function InlinePreview({ attachmentId, mimeType }: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [downloadFilename, setDownloadFilename] = useState<string>('allegato');
  const aborter = useRef<AbortController | null>(null);

  const isImage = mimeType.startsWith('image/');
  const isPdf = mimeType === 'application/pdf';
  const remoteUrl = `${API_BASE}/attachments/${attachmentId}/content`;

  const cleanup = () => {
    aborter.current?.abort();
    aborter.current = null;
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null);
    setState('idle');
    setErrorMsg('');
  };

  useEffect(() => {
    if (!open) {
      cleanup();
      return;
    }
    const ac = new AbortController();
    aborter.current = ac;
    setState('loading');
    fetch(remoteUrl, { credentials: 'include', signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        // Estrai filename dal Content-Disposition se presente
        const cd = res.headers.get('Content-Disposition') ?? '';
        const utf8Match = cd.match(/filename\*=UTF-8''([^;]+)/i);
        const asciiMatch = cd.match(/filename="?([^";]+)"?/i);
        const fname = utf8Match
          ? decodeURIComponent(utf8Match[1])
          : asciiMatch
            ? asciiMatch[1]
            : 'allegato';
        setDownloadFilename(fname);
        const contentType = res.headers.get('Content-Type') ?? mimeType;
        const blob = await res.blob();
        // Forziamo il MIME del Blob al valore del server (Safari a volte
        // non lo include nel Blob da fetch).
        const typedBlob = blob.type ? blob : new Blob([blob], { type: contentType });
        const url = URL.createObjectURL(typedBlob);
        setBlobUrl(url);
        setState('ok');
      })
      .catch((err: Error) => {
        if (err.name === 'AbortError') return;
        setErrorMsg(err.message || 'Errore di caricamento');
        setState('error');
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, remoteUrl]);

  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label="Anteprima"
      >
        <Eye className="h-4 w-4" />
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) cleanup();
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">{downloadFilename}</DialogTitle>
          </DialogHeader>

          {state === 'loading' && (
            <p className="grid h-[60vh] place-items-center text-sm text-muted-foreground">
              Caricamento…
            </p>
          )}

          {state === 'error' && (
            <div className="grid h-[40vh] place-items-center gap-3 text-center">
              <p className="text-sm text-destructive">
                Impossibile caricare l'anteprima.{errorMsg && ` (${errorMsg})`}
              </p>
              <a
                href={remoteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
              >
                <ExternalLink className="h-4 w-4" /> Apri in nuova scheda
              </a>
            </div>
          )}

          {state === 'ok' && blobUrl && (
            <>
              {isImage ? (
                <img
                  src={blobUrl}
                  alt={downloadFilename}
                  className="mx-auto max-h-[70vh] w-auto"
                />
              ) : isPdf ? (
                <iframe
                  src={blobUrl}
                  className="h-[70vh] w-full rounded-md border"
                  title={downloadFilename}
                />
              ) : (
                <div className="flex flex-col items-start gap-3 py-2">
                  <p className="text-sm text-muted-foreground">
                    Tipo di file non visualizzabile inline.
                  </p>
                  <a
                    href={blobUrl}
                    download={downloadFilename}
                    className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                  >
                    <Download className="h-4 w-4" /> Scarica file
                  </a>
                </div>
              )}
              {/* Per il PDF aggiungo anche un link "apri esterno" come fallback */}
              {isPdf && (
                <div className="flex justify-end pt-2">
                  <a
                    href={blobUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3 w-3" /> Apri in nuova scheda
                  </a>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
