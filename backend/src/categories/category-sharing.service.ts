import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Replica le categorie attraverso i membri di un conto condiviso.
 *
 * Scenari coperti:
 *  1. Un utente accetta la condivisione di un conto: tutte le categorie
 *     già usate dai movimenti di quel conto vengono clonate (se mancano)
 *     nelle categorie del nuovo membro.
 *  2. Un utente crea/modifica un movimento con una categoria: la categoria
 *     viene clonata (se manca) per tutti gli altri membri del conto.
 *
 * Identità "stessa categoria" = `sanitize(name) + isIncome`. Sanitize è
 * una normalizzazione tollerante (lower + trim + collapse whitespace +
 * rimozione punteggiatura/diacritici), così "Spesa", "spesa ", "SPESA!"
 * sono considerate la stessa categoria.
 */
@Injectable()
export class CategorySharingService {
  private readonly logger = new Logger(CategorySharingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Normalizza il nome di una categoria per il match cross-utente.
   * Esempi: "Spesa  " → "spesa", "Casa - Affitto" → "casa affitto".
   */
  static sanitize(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // diacritici
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  /**
   * Per ogni `targetUserId`, garantisce l'esistenza di una categoria con
   * lo stesso nome (sanitizzato) e `isIncome` di quella sorgente.
   * Se assente la clona (preservando colore/icona). Se presente: NO-OP
   * (non sovrascrive).
   *
   * Per le sottocategorie: replica anche il parent (se esiste) e collega
   * il figlio clonato al parent clonato/esistente.
   *
   * Restituisce per ogni targetUserId la categoria "owned" corrispondente.
   */
  async ensureCategoryFor(
    sourceCategoryId: string,
    targetUserIds: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (targetUserIds.length === 0) return result;

    const source = await this.prisma.category.findUnique({
      where: { id: sourceCategoryId },
      include: { parent: true },
    });
    if (!source) return result;

    const sanitizedTarget = CategorySharingService.sanitize(source.name);

    // Risolvi/crea il parent per ciascun target (se la sorgente ne ha uno)
    const parentMap = new Map<string, string | null>();
    if (source.parent) {
      const parentSanitized = CategorySharingService.sanitize(source.parent.name);
      const parentMatches = await this.prisma.category.findMany({
        where: {
          userId: { in: targetUserIds },
          isIncome: source.parent.isIncome,
          parentId: null,
        },
        select: { id: true, userId: true, name: true },
      });
      const parentByUser = new Map<string, string>();
      for (const p of parentMatches) {
        if (CategorySharingService.sanitize(p.name) === parentSanitized) {
          parentByUser.set(p.userId, p.id);
        }
      }
      for (const uid of targetUserIds) {
        const existingParent = parentByUser.get(uid);
        if (existingParent) {
          parentMap.set(uid, existingParent);
        } else {
          // Clona il parent
          const created = await this.prisma.category.create({
            data: {
              userId: uid,
              name: source.parent.name.trim(),
              color: source.parent.color,
              icon: source.parent.icon,
              isIncome: source.parent.isIncome,
              sortOrder: source.parent.sortOrder ?? 0,
            },
            select: { id: true },
          });
          parentMap.set(uid, created.id);
        }
      }
    }

    // Risolvi/crea la categoria principale per ciascun target
    const candidates = await this.prisma.category.findMany({
      where: {
        userId: { in: targetUserIds },
        isIncome: source.isIncome,
      },
      select: { id: true, userId: true, name: true, parentId: true },
    });

    for (const uid of targetUserIds) {
      const expectedParentId = source.parent ? parentMap.get(uid) ?? null : null;
      const match = candidates.find(
        (c) =>
          c.userId === uid &&
          CategorySharingService.sanitize(c.name) === sanitizedTarget &&
          // Se sorgente ha un parent, anche il match deve essere figlia.
          // Se non ha parent, anche il match deve essere root.
          (source.parent ? c.parentId === expectedParentId : c.parentId === null),
      );
      if (match) {
        result.set(uid, match.id);
        continue;
      }
      try {
        const created = await this.prisma.category.create({
          data: {
            userId: uid,
            name: source.name.trim(),
            color: source.color,
            icon: source.icon,
            isIncome: source.isIncome,
            sortOrder: source.sortOrder ?? 0,
            parentId: expectedParentId,
          },
          select: { id: true },
        });
        result.set(uid, created.id);
      } catch (e) {
        // In caso di race condition / conflitto unique, non fallire la
        // request principale: logga e prosegui.
        this.logger.warn(
          `Failed to clone category ${source.id} for user ${uid}: ${(e as Error).message}`,
        );
      }
    }

    return result;
  }

  /**
   * Replica TUTTE le categorie distintamente usate dai movimenti di un
   * conto verso un nuovo membro (chiamato dopo accept share / add member).
   */
  async replicateAccountCategoriesTo(accountId: string, targetUserId: string): Promise<void> {
    const used = await this.prisma.transaction.findMany({
      where: { accountId, categoryId: { not: null } },
      distinct: ['categoryId'],
      select: { categoryId: true, userId: true },
    });
    const idsToClone = used
      .map((t) => t.categoryId)
      .filter((id): id is string => !!id);
    if (idsToClone.length === 0) return;

    // Filtra le categorie che NON sono già del targetUserId (no-op)
    const targetOwned = new Set(
      (
        await this.prisma.category.findMany({
          where: { id: { in: idsToClone }, userId: targetUserId },
          select: { id: true },
        })
      ).map((c) => c.id),
    );
    const toReplicate = idsToClone.filter((id) => !targetOwned.has(id));

    for (const categoryId of toReplicate) {
      try {
        await this.ensureCategoryFor(categoryId, [targetUserId]);
      } catch (e) {
        this.logger.warn(`replicate failed for ${categoryId}: ${(e as Error).message}`);
      }
    }
  }

  /**
   * Replica una singola categoria (appena usata in un movimento) a tutti
   * i membri del conto (escluso il creatore della transazione).
   */
  async replicateCategoryToAccountMembers(
    accountId: string,
    categoryId: string,
    excludeUserId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const account = await client.account.findUnique({
      where: { id: accountId },
      include: { members: { select: { userId: true } } },
    });
    if (!account) return;

    const targetIds = [account.ownerId, ...account.members.map((m) => m.userId)].filter(
      (id) => id !== excludeUserId,
    );
    if (targetIds.length === 0) return;

    // Non possiamo passare la `tx` (Prisma.TransactionClient) a ensureCategoryFor
    // senza riscriverlo: per pragmaticità eseguiamo la replica fuori transazione.
    // Eventuali errori vengono loggati ma non bloccano.
    await this.ensureCategoryFor(categoryId, targetIds).catch((e) =>
      this.logger.warn(`replicateCategoryToAccountMembers failed: ${(e as Error).message}`),
    );
  }
}
