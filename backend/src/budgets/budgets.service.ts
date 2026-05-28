import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountPolicyService } from '../common/services/account-policy.service';
import { CreateBudgetDto, UpdateBudgetDto } from './dto/budget.dto';

export interface BudgetWithSpent {
  id: string;
  categoryId: string;
  month: string;
  limitCents: string;
  spentCents: string;
  category: { id: string; name: string; color: string | null; icon: string | null };
}

@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AccountPolicyService,
  ) {}

  static parseMonth(month: string): { start: Date; nextStart: Date; firstDay: Date } {
    const [y, m] = month.split('-').map((s) => parseInt(s, 10));
    const start = new Date(Date.UTC(y, m - 1, 1));
    const nextStart = new Date(Date.UTC(y, m, 1));
    return { start, nextStart, firstDay: start };
  }

  async create(userId: string, dto: CreateBudgetDto) {
    await this.assertCategoryOwned(userId, dto.categoryId);
    const { firstDay } = BudgetsService.parseMonth(dto.month);
    try {
      return await this.prisma.budget.create({
        data: {
          userId,
          categoryId: dto.categoryId,
          month: firstDay,
          limitCents: BigInt(dto.limitCents),
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Budget already exists for this category and month');
      }
      throw e;
    }
  }

  async update(userId: string, id: string, dto: UpdateBudgetDto) {
    const budget = await this.prisma.budget.findUnique({ where: { id } });
    if (!budget || budget.userId !== userId) throw new NotFoundException('Budget not found');
    return this.prisma.budget.update({
      where: { id },
      data: {
        limitCents: dto.limitCents !== undefined ? BigInt(dto.limitCents) : undefined,
      },
    });
  }

  async remove(userId: string, id: string) {
    const budget = await this.prisma.budget.findUnique({ where: { id } });
    if (!budget || budget.userId !== userId) throw new NotFoundException('Budget not found');
    await this.prisma.budget.delete({ where: { id } });
  }

  async listWithSpent(userId: string, month?: string): Promise<BudgetWithSpent[]> {
    const monthStr = month ?? new Date().toISOString().slice(0, 7);
    const { start, nextStart } = BudgetsService.parseMonth(monthStr);

    const budgets = await this.prisma.budget.findMany({
      where: { userId, month: start },
      include: {
        category: { select: { id: true, name: true, color: true, icon: true } },
      },
      orderBy: { category: { name: 'asc' } },
    });

    if (budgets.length === 0) return [];

    const accessible = this.policy.accessibleAccountsWhere(userId);
    const grouped = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: {
        account: accessible,
        categoryId: { in: budgets.map((b) => b.categoryId) },
        transactionDate: { gte: start, lt: nextStart },
        amountCents: { lt: 0 },
      },
      _sum: { amountCents: true },
    });

    const spentByCat = new Map<string, bigint>();
    for (const g of grouped) {
      if (g.categoryId) spentByCat.set(g.categoryId, g._sum.amountCents ?? 0n);
    }

    return budgets.map((b) => ({
      id: b.id,
      categoryId: b.categoryId,
      month: b.month.toISOString().slice(0, 10),
      limitCents: b.limitCents.toString(),
      spentCents: ((-(spentByCat.get(b.categoryId) ?? 0n)) as bigint).toString(),
      category: b.category,
    }));
  }

  private async assertCategoryOwned(userId: string, categoryId: string) {
    const c = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!c || c.userId !== userId) throw new NotFoundException('Category not found');
  }
}
