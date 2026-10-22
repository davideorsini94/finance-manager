import { Worker } from 'worker_threads';

/** Pagine lette: i dati di una bolletta stanno nelle prime; il resto è dettaglio. */
const MAX_PAGES = 8;
/** Oltre questo tempo il worker viene ucciso, non solo abbandonato. */
const PARSE_TIMEOUT_MS = 30_000;
/** Memoria massima del worker: un PDF costruito per gonfiarsi muore lì. */
const WORKER_HEAP_MB = 256;

/**
 * Codice del worker. pdf-parse usa pdf.js 1.10 con il "fake worker", cioè
 * nello stesso thread di chi lo chiama: un PDF malformato o costruito apposta
 * (stream enormi, pagine con milioni di operatori) bloccherebbe l'event loop
 * dell'intero backend, chat e sync compresi, e nessun timeout potrebbe
 * scattare. In un `worker_threads` il blocco resta confinato e `terminate()`
 * lo ferma davvero.
 *
 * `isEvalSupported = false`: pdf.js 1.10 compila con `eval` glifi e funzioni
 * PostScript (CVE-2018-5158, CVE-2024-4367). Il solo testo non ne ha bisogno.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('worker_threads');
// Stessa istanza che pdf-parse caricherà (cache dei moduli del worker).
const pdfjs = require(workerData.pdfjsPath);
pdfjs.PDFJS.isEvalSupported = false;
const pdfParse = require(workerData.pdfParsePath);
pdfParse(Buffer.from(workerData.data), { max: workerData.maxPages, version: workerData.version })
  .then((r) => parentPort.postMessage({ text: r.text || '' }))
  .catch((e) => parentPort.postMessage({ error: String((e && e.message) || e) }));
`;

const PDFJS_VERSION = 'v1.10.100';

/** Testo delle prime pagine del PDF, righe separate da `\n`. */
export function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfParsePath = require.resolve('pdf-parse/lib/pdf-parse.js');
  // Lo stesso file che pdf-parse richiede per la versione indicata: la cache
  // dei moduli del worker fa sì che il flag `isEvalSupported` valga per lui.
  const pdfjsPath = require.resolve(`pdf-parse/lib/pdf.js/${PDFJS_VERSION}/build/pdf.js`);
  // Copia in un ArrayBuffer proprio: si trasferisce al worker senza copie
  // ulteriori e senza toccare il Buffer del chiamante.
  const data = new Uint8Array(buffer).buffer;

  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { data, pdfParsePath, pdfjsPath, maxPages: MAX_PAGES, version: PDFJS_VERSION },
      transferList: [data],
      resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
    });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error('lettura del PDF troppo lenta'))),
      PARSE_TIMEOUT_MS,
    );
    worker.once('message', (msg: { text?: string; error?: string }) =>
      finish(() => (msg.error ? reject(new Error(`PDF non leggibile: ${msg.error}`)) : resolve(msg.text ?? ''))),
    );
    worker.once('error', (e) => finish(() => reject(new Error(`PDF non leggibile: ${e.message}`))));
    worker.once('exit', (code) =>
      finish(() => reject(new Error(`lettura del PDF interrotta (codice ${code})`))),
    );
  });
}
