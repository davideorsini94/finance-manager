import { Prisma } from '@prisma/client';

/**
 * Categorie "Giroconto": dal sync bancario arrivano movimenti che sono
 * spostamenti tra conti ma restano entrate/uscite (manca la gamba opposta,
 * oppure non sono stati abbinati). L'utente li riconosce assegnando una
 * categoria "Giroconto" (anche sottocategoria, anche con spazi o maiuscole
 * diverse): negli aggregati vanno trattati come giroconti, non come flussi.
 */
export const TRANSFER_CATEGORY_WHERE: Prisma.CategoryWhereInput = {
  OR: [
    { name: { startsWith: 'giroconto', mode: 'insensitive' } },
    { parent: { name: { startsWith: 'giroconto', mode: 'insensitive' } } },
  ],
};

/** Entrata/uscita con categoria "Giroconto": va contata come giroconto. */
export const CATEGORIZED_TRANSFER_WHERE: Prisma.TransactionWhereInput = {
  type: { not: 'transfer' },
  category: { is: TRANSFER_CATEGORY_WHERE },
};

/** Esclude dagli aggregati di entrate/uscite i movimenti con categoria "Giroconto". */
export const NOT_CATEGORIZED_TRANSFER_WHERE: Prisma.TransactionWhereInput = {
  OR: [{ categoryId: null }, { category: { isNot: TRANSFER_CATEGORY_WHERE } }],
};
