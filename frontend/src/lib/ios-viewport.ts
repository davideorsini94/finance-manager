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
}
