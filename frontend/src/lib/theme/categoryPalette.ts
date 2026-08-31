/**
 * Palette delle categorie, accordata al tema "Registro".
 *
 * Dodici tinte distribuite sul cerchio cromatico ma tenute alla **stessa
 * intensità** (saturazione ~40%, luminosità ~45%): sono colori da pigmento, non
 * primari da schermo, così convivono con la carta verde pallido senza vibrare e
 * restano leggibili sul fondo scuro. I colori accesi di Tailwind — magenta,
 * blu elettrico, ciano — facevano esattamente il contrario.
 *
 * L'accento dell'interfaccia (blu penna) non compare: serve a distinguere ciò
 * che è interattivo, e un dato che usa lo stesso colore lo confonde.
 *
 * Ordine: le tinte si alternano fredde/calde, così categorie vicine in elenco
 * restano distinguibili anche quando finiscono adiacenti in un grafico a torta.
 */
export interface CategoryColor {
  name: string;
  hex: string;
}

export const CATEGORY_PALETTE: readonly CategoryColor[] = [
  { name: 'Ottanio', hex: '#2f7f8e' },
  { name: 'Terracotta', hex: '#ae6a3c' },
  { name: 'Petrolio', hex: '#3a6b96' },
  { name: 'Ocra', hex: '#a68a38' },
  { name: 'Indaco', hex: '#50589b' },
  { name: 'Oliva', hex: '#7f8c3c' },
  { name: 'Glicine', hex: '#6f5599' },
  { name: 'Salvia', hex: '#4f8d5e' },
  { name: 'Prugna', hex: '#8e4f86' },
  { name: 'Verderame', hex: '#3a8c7c' },
  { name: 'Vinaccia', hex: '#a3486c' },
  { name: 'Mattone', hex: '#a84b45' },
] as const;

/** Solo gli esadecimali, nell'ordine della palette. */
export const CATEGORY_PALETTE_HEX: readonly string[] = CATEGORY_PALETTE.map((c) => c.hex);
