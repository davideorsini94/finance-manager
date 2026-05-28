import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCategoryDto,
  ReorderCategoriesDto,
  UpdateCategoryDto,
} from './dto/category.dto';

/**
 * Gerarchia categorie a 2 livelli (root + figli).
 *
 * Le categorie sono GENERICHE: una stessa categoria può essere assegnata sia
 * a entrate sia a uscite. Il vecchio campo `isIncome` viene mantenuto in DB
 * per retrocompatibilità ma è ignorato a livello applicativo (default false).
 *
 * Vincoli applicativi:
 *  - massimo 2 livelli (un parent non può avere a sua volta un parent);
 *  - non si può rendere figlia una categoria che ha già figli;
 *  - in eliminazione: `reassignTo` sposta transazioni/figli verso un'altra
 *    categoria; senza `reassignTo` i figli vengono promossi a root e le
 *    transazioni si "scategorizzano" (categoryId = null) tramite onDelete.
 */
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // CREATE
  // ---------------------------------------------------------------------------

  async create(userId: string, dto: CreateCategoryDto) {
    let sortOrder = dto.sortOrder;

    if (dto.parentId) {
      await this.assertOwnedAndTopLevel(userId, dto.parentId);
    }

    if (sortOrder === undefined) {
      const max = await this.prisma.category.aggregate({
        where: { userId, parentId: dto.parentId ?? null },
        _max: { sortOrder: true },
      });
      sortOrder = (max._max.sortOrder ?? -1) + 1;
    }

    return this.prisma.category.create({
      data: {
        userId,
        name: dto.name,
        color: dto.color,
        icon: dto.icon,
        // `isIncome` legacy: lo lasciamo a false. Non viene più usato per il
        // filtraggio nei picker o nei report.
        isIncome: false,
        parentId: dto.parentId ?? null,
        sortOrder,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // READ
  // ---------------------------------------------------------------------------

  list(userId: string) {
    return this.prisma.category.findMany({
      where: { userId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(userId: string, id: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category || category.userId !== userId) {
      throw new NotFoundException('Category not found');
    }
    return category;
  }

  // ---------------------------------------------------------------------------
  // UPDATE
  // ---------------------------------------------------------------------------

  async update(userId: string, id: string, dto: UpdateCategoryDto) {
    const current = await this.findOne(userId, id);

    const nextParentId: string | null | undefined =
      dto.parentId === undefined ? undefined : dto.parentId;

    if (nextParentId !== undefined && nextParentId !== current.parentId) {
      if (nextParentId === id) {
        throw new BadRequestException('Category cannot be its own parent');
      }
      if (nextParentId !== null) {
        await this.assertOwnedAndTopLevel(userId, nextParentId);
        const childrenCount = await this.prisma.category.count({
          where: { userId, parentId: id },
        });
        if (childrenCount > 0) {
          throw new BadRequestException(
            'Categories with children cannot be moved under another parent',
          );
        }
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.category.update({
        where: { id },
        data: {
          name: dto.name,
          color: dto.color,
          icon: dto.icon,
          parentId: nextParentId,
          sortOrder: dto.sortOrder,
        },
      });

      // Propagazione colore ai figli quando cambia su una root.
      if (
        dto.color !== undefined &&
        dto.color !== current.color &&
        current.parentId === null
      ) {
        await tx.category.updateMany({
          where: { userId, parentId: id },
          data: { color: dto.color },
        });
      }

      return updated;
    });
  }

  // ---------------------------------------------------------------------------
  // REORDER (drag & drop) — batch
  // ---------------------------------------------------------------------------

  async reorder(userId: string, dto: ReorderCategoriesDto) {
    if (dto.items.length === 0) return { ok: true, count: 0 };

    const ids = dto.items.map((i) => i.id);
    const owned = await this.prisma.category.findMany({
      where: { id: { in: ids }, userId },
      select: { id: true, parentId: true },
    });
    if (owned.length !== ids.length) {
      throw new NotFoundException('One or more categories not found');
    }

    const proposedParentIds = Array.from(
      new Set(dto.items.map((i) => i.parentId).filter((p): p is string => !!p)),
    );
    if (proposedParentIds.length > 0) {
      const parents = await this.prisma.category.findMany({
        where: { id: { in: proposedParentIds }, userId },
        select: { id: true, parentId: true },
      });
      if (parents.length !== proposedParentIds.length) {
        throw new NotFoundException('One or more parent categories not found');
      }
      for (const p of parents) {
        if (p.parentId !== null) {
          throw new BadRequestException(
            'Categories can only be nested 2 levels deep',
          );
        }
      }

      // Una categoria con figli non può diventare figlia
      const itemsBecomingChildren = dto.items
        .filter((i) => i.parentId)
        .map((i) => i.id);
      if (itemsBecomingChildren.length > 0) {
        const haveChildren = await this.prisma.category.findMany({
          where: { userId, parentId: { in: itemsBecomingChildren } },
          select: { parentId: true },
        });
        if (haveChildren.length > 0) {
          throw new BadRequestException(
            'Categories with children cannot be moved under another parent',
          );
        }
      }
    }

    await this.prisma.$transaction(
      dto.items.map((i) =>
        this.prisma.category.update({
          where: { id: i.id },
          data: {
            parentId: i.parentId === undefined ? undefined : i.parentId,
            sortOrder: i.sortOrder,
          },
        }),
      ),
    );

    return { ok: true, count: dto.items.length };
  }

  // ---------------------------------------------------------------------------
  // DELETE — con riassegnazione opzionale
  // ---------------------------------------------------------------------------

  async remove(userId: string, id: string, options: { reassignTo?: string } = {}) {
    await this.findOne(userId, id);

    if (options.reassignTo) {
      if (options.reassignTo === id) {
        throw new BadRequestException('Cannot reassign to itself');
      }
      const target = await this.findOne(userId, options.reassignTo);

      const children = await this.prisma.category.findMany({
        where: { userId, parentId: id },
        select: { id: true },
      });

      // Se la destinazione è una root, le figlie diventano sue figlie.
      // Se la destinazione è una figlia, i figli diventano root.
      const moveChildrenUnderTarget = target.parentId === null;
      const childIds = children.map((c) => c.id);
      const allAffectedIds = [id, ...childIds];

      await this.prisma.$transaction(async (tx) => {
        await tx.transaction.updateMany({
          where: { userId, categoryId: { in: allAffectedIds } },
          data: { categoryId: options.reassignTo },
        });
        await tx.budget
          .updateMany({
            where: { userId, categoryId: { in: allAffectedIds } },
            data: { categoryId: options.reassignTo },
          })
          .catch(() => undefined);
        await tx.recurringRule
          .updateMany({
            where: { userId, categoryId: { in: allAffectedIds } },
            data: { categoryId: options.reassignTo },
          })
          .catch(() => undefined);

        if (childIds.length > 0) {
          await tx.category.updateMany({
            where: { id: { in: childIds } },
            data: { parentId: moveChildrenUnderTarget ? options.reassignTo : null },
          });
        }
        await tx.category.delete({ where: { id } });
      });

      return { ok: true, reassignedTo: options.reassignTo };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.category.updateMany({
        where: { userId, parentId: id },
        data: { parentId: null },
      });
      await tx.category.delete({ where: { id } });
    });

    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Aggregazione gerarchica per i report
  // ---------------------------------------------------------------------------

  /**
   * Somma per categoria root sommando anche le figlie.
   * `isIncome` qui filtra il SEGNO delle transazioni considerate
   * (true = solo entrate, false = solo uscite), non più il tipo di categoria.
   */
  async sumByHierarchy(
    userId: string,
    range: { from: Date; to: Date },
    isIncome = false,
  ) {
    const cats = await this.prisma.category.findMany({
      where: { userId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    const sums = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: {
        userId,
        transactionDate: { gte: range.from, lte: range.to },
        categoryId: { in: cats.map((c) => c.id) },
        amountCents: isIncome ? { gt: 0 } : { lt: 0 },
      },
      _sum: { amountCents: true },
    });
    const sumMap = new Map(
      sums.map((s) => {
        const v = s._sum.amountCents ?? new Prisma.Decimal(0);
        return [s.categoryId!, Math.abs(Number(v))];
      }),
    );

    const byParent = new Map<string | null, typeof cats>();
    for (const c of cats) {
      const k = c.parentId ?? null;
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k)!.push(c);
    }

    return (byParent.get(null) ?? []).map((root) => {
      const children = (byParent.get(root.id) ?? []).map((ch) => ({
        id: ch.id,
        name: ch.name,
        color: ch.color,
        total: sumMap.get(ch.id) ?? 0,
      }));
      const ownTotal = sumMap.get(root.id) ?? 0;
      const childrenTotal = children.reduce((s, c) => s + c.total, 0);
      return {
        rootId: root.id,
        rootName: root.name,
        color: root.color,
        ownTotal,
        childrenTotal,
        total: ownTotal + childrenTotal,
        children,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async assertOwnedAndTopLevel(userId: string, parentId: string) {
    const parent = await this.prisma.category.findUnique({ where: { id: parentId } });
    if (!parent || parent.userId !== userId) {
      throw new NotFoundException('Parent category not found');
    }
    if (parent.parentId !== null) {
      throw new BadRequestException('Categories can only be nested 2 levels deep');
    }
    return parent;
  }
}
