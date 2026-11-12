import { Prisma } from '@prisma/client';

const startsWith = (prefix: string): Prisma.CategoryWhereInput => ({
  OR: [
    { name: { startsWith: prefix, mode: 'insensitive' } },
    { parent: { name: { startsWith: prefix, mode: 'insensitive' } } },
  ],
});

/**
 * Categorie "Giroconto": dal sync bancario arrivano movimenti che sono
 * spostamenti tra conti ma restano entrate/uscite (manca la gamba opposta,
 * oppure non sono stati abbinati). L'utente li riconosce assegnando una
 * categoria "Giroconto" (anche sottocategoria, anche con spazi o maiuscole
 * diverse): negli aggregati vanno trattati come giroconti, non come flussi.
 */
export const TRANSFER_CATEGORY_WHERE: Prisma.CategoryWhereInput = startsWith('giroconto');

/**
 * Categorie "Investimenti" (e sottocategorie, es. "Investimento fondi",
 * "Liquidazione"): comprare o vendere fondi sposta soldi tra conto e
 * investimento, non è né spesa né guadagno. Come i giroconti restano fuori da
 * entrate e uscite e si mostrano a parte.
 */
export const INVESTMENT_CATEGORY_WHERE: Prisma.CategoryWhereInput = startsWith('investiment');

/** Entrata/uscita con categoria "Giroconto": va contata come giroconto. */
export const CATEGORIZED_TRANSFER_WHERE: Prisma.TransactionWhereInput = {
  type: { not: 'transfer' },
  category: { is: TRANSFER_CATEGORY_WHERE },
};

/** Entrata/uscita con categoria di investimento. */
export const CATEGORIZED_INVESTMENT_WHERE: Prisma.TransactionWhereInput = {
  type: { not: 'transfer' },
  category: { is: INVESTMENT_CATEGORY_WHERE },
};

/** Entrate/uscite che non sono flussi veri: giroconti o investimenti. */
export const NON_FLOW_WHERE: Prisma.TransactionWhereInput = {
  type: { not: 'transfer' },
  category: { is: { OR: [TRANSFER_CATEGORY_WHERE, INVESTMENT_CATEGORY_WHERE] } },
};

/**
 * Esclude dagli aggregati di entrate/uscite i movimenti con categoria
 * "Giroconto" o di investimento.
 */
export const FLOW_ONLY_WHERE: Prisma.TransactionWhereInput = {
  OR: [
    { categoryId: null },
    { category: { isNot: { OR: [TRANSFER_CATEGORY_WHERE, INVESTMENT_CATEGORY_WHERE] } } },
  ],
};
