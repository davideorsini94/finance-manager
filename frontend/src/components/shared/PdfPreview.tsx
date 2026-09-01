import { useCallback, useState } from 'react';
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
import { ZoomBox } from './ZoomBox';

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

/**
 * Tetto all'area del canvas: Safari (iOS in particolare) smette di disegnare
 * oltre ~16.7 milioni di pixel e la pagina resterebbe bianca. Con lo zoom a 5×
 * su uno schermo a 3× di densità ci si arriva, quindi la densità di
 * rasterizzazione viene abbassata quanto basta.
 */
const MAX_PIXEL_CANVAS = 16_777_216;
/** Margine, per non innescare il ciclo comparsa/scomparsa delle barre. */
const SLACK = 2;

/**
 * Rendering PDF su canvas via pdf.js, dentro un [[ZoomBox]].
 *
 * Sostituisce il vecchio `<iframe src={blob:…}>`: dentro la PWA standalone su
 * iOS (WebKit + service worker) l'iframe con sorgente blob resta bianco. Il
 * canvas non ha questo problema.
 *
 * All'apertura la **pagina intera** sta nel riquadro (si adatta al lato che
 * stringe di più); le pagine restano impilate e si scorre a quelle dopo. Lo
 * zoom cambia la dimensione di layout, quindi pdf.js **ridisegna** alla scala
 * nuova e il testo resta nitido invece di essere una bitmap stirata.
 */
export default function PdfPreview({ file, downloadUrl, filename }: Props) {
  const [numPages, setNumPages] = useState(0);
  // Dimensioni in punti della prima pagina: servono a calcolare l'adattamento
  // **prima** di disegnare, così non si vede il salto da "tutta larghezza" a
  // "pagina intera".
  const [pagina, setPagina] = useState<{ w: number; h: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const onLoadSuccess = useCallback(async (pdf: pdfjs.PDFDocumentProxy) => {
    setLoadError(null);
    setNumPages(pdf.numPages);
    const prima = await pdf.getPage(1);
    const vp = prima.getViewport({ scale: 1 });
    setPagina({ w: vp.width, h: vp.height });
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
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <ZoomBox className="min-h-[180px]">
        {({ box, zoom }) => {
          const fit = pagina
            ? Math.min((box.width - SLACK) / pagina.w, (box.height - SLACK) / pagina.h)
            : 0;
          const larghezza = pagina ? Math.floor(pagina.w * fit * zoom) : 0;
          const altezza = pagina ? Math.floor(pagina.h * fit * zoom) : 0;
          const densita = Math.min(
            window.devicePixelRatio || 1,
            Math.sqrt(MAX_PIXEL_CANVAS / Math.max(1, larghezza * altezza)),
          );

          return (
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
              {pagina !== null &&
                Array.from({ length: numPages }, (_, i) => (
                  <div
                    key={i}
                    // Dimensione esplicita: il canvas di react-pdf si misura da
                    // sé dentro un effect, a ridisegno finito. Senza questo
                    // riquadro il contenuto cambierebbe altezza in ritardo e la
                    // correzione dello scorrimento dello ZoomBox lavorerebbe su
                    // numeri vecchi.
                    style={{ width: larghezza, height: altezza }}
                    className="shrink-0 overflow-hidden rounded-md bg-white shadow-sm outline outline-1 -outline-offset-1 outline-border"
                  >
                    <Page
                      pageNumber={i + 1}
                      width={larghezza}
                      devicePixelRatio={densita}
                      // Niente text/annotation layer: non servono per una
                      // ricevuta e così evitiamo di importare i CSS di react-pdf.
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                      loading={
                        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      }
                    />
                  </div>
                ))}
            </Document>
          );
        }}
      </ZoomBox>
      {numPages > 1 && (
        <p className="text-center text-xs text-muted-foreground">
          {numPages} pagine · scorri per vedere le altre
        </p>
      )}
    </div>
  );
}
