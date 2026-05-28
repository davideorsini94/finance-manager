/**
 * Comparator localizzato per ordinamento alfabetico crescente di stringhe.
 * Usa `Intl.Collator` con locale 'it' e `sensitivity: 'base'` così
 * "Àlimentari" e "alimentari" risultano equivalenti e l'ordinamento
 * rispetta l'alfabeto italiano (es. accentate trattate come la base).
 */
const collator = new Intl.Collator('it', { sensitivity: 'base', numeric: true });

export function compareByName<T extends { name: string }>(a: T, b: T): number {
  return collator.compare(a.name, b.name);
}

/** Ritorna una nuova lista ordinata per `name` crescente (non muta l'input). */
export function sortByName<T extends { name: string }>(items: readonly T[]): T[] {
  return [...items].sort(compareByName);
}
