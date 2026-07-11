/**
 * Fix per i problemi di viewport su iOS (Safari e PWA standalone).
 *
 * 1. Auto-zoom sul focus degli input: Safari iOS zooma la pagina quando si
 *    focalizza un campo con font-size < 16px (i nostri usano text-sm = 14px).
 *    In standalone lo zoom/pan spesso resta attivo dopo il blur: layout
 *    "rotto" con campi che sembrano sovrapporsi. `maximum-scale=1` sopprime
 *    SOLO l'auto-zoom: dal iOS 10 Safari ignora il limite per il pinch-zoom
 *    dell'utente, quindi l'accessibilità non è compromessa. Lo applichiamo
 *    da JS solo su iOS perché su Android Chrome lo stesso attributo
 *    disabiliterebbe davvero il pinch-zoom.
 *
 * 2. Documento "pannato": in standalone, dopo la chiusura della tastiera o
 *    al ritorno in foreground, iOS a volte lascia il documento scrollato
 *    di qualche px (BottomNav shiftata in alto, banda nera sotto, si
 *    sistemava trascinando la pagina con un dito). L'app non ha scroll di
 *    documento (tutto scrolla dentro <main>), quindi riportare la finestra
 *    a (0,0) è sempre corretto. Evitiamo il reset mentre un campo è in
 *    editing per non nascondere l'input dietro la tastiera.
 */
export function initIosViewportFix() {
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS si presenta come macOS ma è touch
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isIOS) return;

  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute(
      'content',
      'width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1',
    );

  const isEditing = () => {
    const el = document.activeElement;
    return (
      el instanceof HTMLElement &&
      (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
    );
  };

  const reset = () => {
    if (isEditing()) return;
    if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
  };
  // Sul focusout aspettiamo che l'eventuale focus successivo si assesti
  // (passaggio da un campo all'altro), poi riallineiamo.
  const resetSoon = () => setTimeout(reset, 100);

  window.addEventListener('focusout', resetSoon);
  window.addEventListener('pageshow', reset);
  window.addEventListener('orientationchange', resetSoon);
  window.visualViewport?.addEventListener('resize', resetSoon);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) resetSoon();
  });
  reset();
  // Nudge all'avvio: alcune versioni di iOS ripartono col viewport "pannato"
  // e serve uno scroll (anche no-op) per forzarne il ricalcolo.
  window.scrollTo(0, 1);
  window.scrollTo(0, 0);

  /**
   * 3. BottomNav "incollata" al fondo realmente visibile (solo standalone).
   *
   * Gli elementi position:fixed sono ancorati al LAYOUT viewport; quando il
   * VISUAL viewport resta pannato/accorciato (bug standalone dopo tastiera o
   * riapertura) la barra resta sospesa sopra il fondo dello schermo con una
   * banda scoperta sotto — e con lo scroll del documento bloccato non è più
   * nemmeno sistemabile trascinando. `scrollTo(0,0)` non aiuta perché lo
   * scroll È già 0: l'offset vive nel visual viewport. Qui misuriamo la
   * differenza tra il fondo del visual viewport e quello del layout viewport
   * e la compensiamo con un translateY. In condizioni normali l'offset è 0 e
   * il transform viene rimosso. Con la tastiera aperta non tocchiamo nulla.
   */
  const vv = window.visualViewport;
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (isStandalone && vv) {
    let raf = 0;
    const glue = () => {
      raf = 0;
      const nav = document.querySelector<HTMLElement>('.fm-bottomnav');
      if (!nav) return;
      if (isEditing()) {
        nav.style.transform = '';
        return;
      }
      const offset = vv.offsetTop + vv.height - window.innerHeight;
      nav.style.transform = Math.abs(offset) > 1 ? `translateY(${offset}px)` : '';
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(glue);
    };
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    window.addEventListener('pageshow', schedule);
    window.addEventListener('orientationchange', () => setTimeout(schedule, 150));
    window.addEventListener('focusout', () => setTimeout(schedule, 150));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) schedule();
    });
    schedule();
    // Ripassa dopo l'assestamento del layout post-lancio.
    setTimeout(schedule, 600);
    setTimeout(schedule, 1800);
  }
}
