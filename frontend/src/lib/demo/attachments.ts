/**
 * Allegati finti della modalità demo.
 *
 * Il binario non passa dal backend: gli id demo sono mappati su file statici
 * serviti da `public/demo/`. La mappa è usata in due punti:
 *  - `AttachmentPreviewDialog` (fetch diretto, non passa da ky);
 *  - `lib/api/client.ts` (`maybeDemoResponse`), per qualunque chiamata ky
 *    verso `attachments/<id>/content`.
 */

export const DEMO_ATTACHMENT_FILES: Record<string, string> = {
  'demo-att-pdf': '/demo/ricevuta-demo.pdf',
  'demo-att-pdf-2': '/demo/ricevuta-demo.pdf',
  'demo-att-img': '/demo/scontrino-demo.png',
  'demo-att-img-2': '/demo/scontrino-demo.png',
};

/** Path statico dell'allegato demo, o `null` se l'id non è demo. */
export function demoAttachmentFile(attachmentId: string): string | null {
  return DEMO_ATTACHMENT_FILES[attachmentId] ?? null;
}

/**
 * Estrae l'id da un pathname `…/attachments/<id>/content` e ritorna il file
 * demo corrispondente (`null` se la rotta non è quella o l'id non è demo).
 */
export function demoAttachmentFileFromPath(pathname: string): string | null {
  const match = pathname.match(/attachments\/([^/]+)\/content$/);
  if (!match) return null;
  return demoAttachmentFile(decodeURIComponent(match[1]));
}
