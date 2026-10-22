// L'entry interno usato da `utility-bills/pdf-text.ts` ha gli stessi tipi del
// pacchetto (che li dichiara solo per l'entry principale).
declare module 'pdf-parse/lib/pdf-parse.js' {
  import pdfParse = require('pdf-parse');
  export = pdfParse;
}
