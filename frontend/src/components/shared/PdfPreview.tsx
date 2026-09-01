import { useCallback, useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
// Il worker viene emesso da Vite come asset same-origin: la CSP di nginx
// (`default-src 'self'`) lo accetta senza modifiche.
//
// `?worker&url` invece del più ovvio `?url`: Vite lo ribundla emettendo un
// file **.js**. Con `?url` l'asset conserverebbe l'estensione `.mjs`, che
// `mime.types` di nginx 1.27 non mappa → servito come
// `application/octet-stream` → il browser rifiuta di avviare il Worker e in
// produzione l'anteprima PDF non partirebbe.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url';
import { Download, Loader2 } from 'lucide-react';

// Configurazione una sola volta a livello di modulo: questo file è caricato
// in lazy, quindi pdfjs entra nel bundle solo quando si apre un PDF.
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface Props {
  /**
   * Il PDF già scaricato dal dialog chiamante, come `Blob`.
   *
   * **Non passare qui un `blob:` URL.** react-pdf, ricevendo una stringa, la
   * gira a pdf.js come `url`, e pdf.js per gli schemi diversi da http(s) usa
   * XHR (`isValidFetchUrl` accetta solo http/https): quella richiesta ricade
   * sotto `connect-src` della CSP di nginx, che è `'self'` e **non** copre
   * `blob:` — la richiesta viene bloccata, `xhr.status` è 0 e l'anteprima
   * muore con "Unexpected server response (0) while retrieving PDF".
   * Succede solo dietro nginx: in `vite dev` non c'è CSP.
   *
   * Con un `Blob` invece react-pdf lo legge in memoria (FileReader →
   * ArrayBuffer) e pdf.js non fa nessuna richiesta.
   */
  file: Blob;
  /** `blob:` URL dello stesso file: serve solo al link di download di riserva. */
  downloadUrl: string;
  filename: string;
}

/** Larghezza massima di rendering: oltre non guadagniamo leggibilità. */
const MAX_PAGE_WIDTH = 800;

/**
 * Rendering PDF su canvas via pdf.js.
 *
 * Sostituisce il vecchio `<iframe src={blob:…}>`: dentro la PWA standalone su
 * iOS (WebKit + service worker) l'iframe con sorgente blob resta bianco. Il
 * canvas non ha questo problema.
 *
 * Le ricevute sono di poche pagine: le impiliamo tutte verticalmente invece di
 * paginare.
 */
export default function PdfPreview({ file, downloadUrl, filename }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setWidth(Math.min(w, MAX_PAGE_WIDTH));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Nuovo file: azzero lo stato (il componente resta montato quando si naviga
  // tra due PDF allegati allo stesso movimento).
  useEffect(() => {
    setNumPages(0);
    setLoadError(null);
  }, [file]);

  const onLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
    setLoadError(null);
  }, []);

  const onLoadError = useCallback((err: Error) => {
    setLoadError(err.message || 'PDF non leggibile');
  }, []);

  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-sm text-destructive">
          Impossibile visualizzare il PDF. ({loadError})
        </p>
        <a
          href={downloadUrl}
          download={filename}
          className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
        >
          <Download className="h-4 w-4" /> Scarica il file
        </a>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full">
      <Document
        file={file}
        onLoadSuccess={onLoadSuccess}
        onLoadError={onLoadError}
        loading={
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Caricamento PDF…
          </div>
        }
        error={null}
        className="flex flex-col items-center gap-3"
      >
        {width !== null &&
          Array.from({ length: numPages }, (_, i) => (
            <div key={i} className="overflow-hidden rounded-md border bg-white shadow-sm">
              <Page
                pageNumber={i + 1}
                width={width}
                // Niente text/annotation layer: non servono per una ricevuta e
                // così evitiamo di importare i CSS di react-pdf.
                renderTextLayer={false}
                renderAnnotationLayer={false}
                loading={
                  <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                }
              />
            </div>
          ))}
      </Document>
      {numPages > 1 && (
        <p className="pt-2 text-center text-xs text-muted-foreground">{numPages} pagine</p>
      )}
    </div>
  );
}
