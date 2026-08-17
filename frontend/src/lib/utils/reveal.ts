/**
 * Porta un elemento in vista **solo se non lo è già (quasi)**. Serve quando un
 * click in cima alla pagina cambia il contenuto di una card più in basso: su
 * iPhone quella card sta sotto la piega e l'interazione sembrerebbe non fare
 * nulla, mentre su desktop è già visibile e uno scroll gratuito darebbe fastidio.
 *
 * Lo scroll avviene nel contenitore scrollabile dell'AppShell (`<main>`): il
 * documento non scrolla mai (vedi nota "PWA e Mobile" del grafo di conoscenza).
 */
export function revealIfOffscreen(el: HTMLElement | null): void {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  if (rect.top < 0 || rect.top > window.innerHeight * 0.6) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
