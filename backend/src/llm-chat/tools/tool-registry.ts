import { Injectable } from '@nestjs/common';
import { TransactionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountPolicyService } from '../../common/services/account-policy.service';
import { ReportsService } from '../../reports/reports.service';
import { BudgetsService } from '../../budgets/budgets.service';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string; format?: string }>;
    required?: string[];
  };
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

const ISO_DATE_DESC = 'Date in ISO format YYYY-MM-DD';

/**
 * Tutti i tool ricevono `userId` iniettato lato server. L'LLM non può MAI
 * specificare un userId diverso e quindi non può accedere a dati di altri
 * utenti. Le query passano sempre da AccountPolicyService.
 */
@Injectable()
export class ToolRegistry {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AccountPolicyService,
    private readonly reports: ReportsService,
    private readonly budgets: BudgetsService,
  ) {}

  getDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'list_accounts',
        description:
          "Restituisce l'elenco dei conti accessibili all'utente con saldo corrente.",
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'list_categories',
        description: "Restituisce l'elenco delle categorie dell'utente.",
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'period_totals',
        description:
          'Restituisce totali entrate, uscite, netto e numero transazioni in un periodo.',
        parameters: {
          type: 'object',
          properties: {
            from: { type: 'string', description: ISO_DATE_DESC },
            to: { type: 'string', description: ISO_DATE_DESC },
          },
          required: ['from', 'to'],
        },
      },
      {
        name: 'category_breakdown',
        description: 'Spesa raggruppata per categoria in un periodo.',
        parameters: {
          type: 'object',
          properties: {
            from: { type: 'string', description: ISO_DATE_DESC },
            to: { type: 'string', description: ISO_DATE_DESC },
          },
          required: ['from', 'to'],
        },
      },
      {
        name: 'list_transactions',
        description:
          "Restituisce le ultime N transazioni che soddisfano i filtri. Limit max 50, default 20.",
        parameters: {
          type: 'object',
          properties: {
            from: { type: 'string', description: ISO_DATE_DESC },
            to: { type: 'string', description: ISO_DATE_DESC },
            categoryName: { type: 'string', description: 'Filtra per nome categoria (case-insensitive)' },
            type: { type: 'string', description: "income | expense | transfer" },
            limit: { type: 'number', description: 'Massimo 50' },
          },
        },
      },
      {
        name: 'budget_status',
        description:
          'Stato budget vs speso del mese specificato (default: mese corrente).',
        parameters: {
          type: 'object',
          properties: {
            month: { type: 'string', description: 'Mese in formato YYYY-MM' },
          },
        },
      },
    ];
  }

  async execute(name: string, args: Record<string, unknown>, userId: string): Promise<ToolResult> {
    try {
      switch (name) {
        case 'list_accounts':
          return { ok: true, data: await this.listAccounts(userId) };
        case 'list_categories':
          return { ok: true, data: await this.listCategories(userId) };
        case 'period_totals':
          return {
            ok: true,
            data: await this.reports.periodTotals(
              userId,
              new Date(String(args.from)),
              new Date(String(args.to)),
            ),
          };
        case 'category_breakdown':
          return {
            ok: true,
            data: await this.reports.categoryBreakdown(
              userId,
              new Date(String(args.from)),
              new Date(String(args.to)),
            ),
          };
        case 'list_transactions':
          return { ok: true, data: await this.listTransactions(userId, args) };
        case 'budget_status':
          return {
            ok: true,
            data: await this.budgets.listWithSpent(userId, args.month as string | undefined),
          };
        default:
          return { ok: false, error: `Unknown tool: ${name}` };
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  private async listAccounts(userId: string) {
    const accounts = await this.prisma.account.findMany({
      where: this.policy.accessibleAccountsWhere(userId),
      select: { id: true, name: true, type: true, balanceCents: true, currency: true },
    });
    return accounts.map((a) => ({ ...a, balanceCents: a.balanceCents.toString() }));
  }

  private async listCategories(userId: string) {
    return this.prisma.category.findMany({
      where: { userId },
      select: { id: true, name: true, isIncome: true, color: true },
      orderBy: { name: 'asc' },
    });
  }

  private async listTransactions(userId: string, args: Record<string, unknown>) {
    const limit = Math.min(50, Number(args.limit ?? 20));
    const where: import('@prisma/client').Prisma.TransactionWhereInput = {
      account: this.policy.accessibleAccountsWhere(userId),
    };
    if (args.from || args.to) {
      where.transactionDate = {
        ...(args.from ? { gte: new Date(String(args.from)) } : {}),
        ...(args.to ? { lte: new Date(String(args.to)) } : {}),
      };
    }
    if (args.type && ['income', 'expense', 'transfer'].includes(String(args.type))) {
      where.type = args.type as TransactionType;
    }
    if (args.categoryName) {
      where.category = { name: { contains: String(args.categoryName), mode: 'insensitive' } };
    }
    const transactions = await this.prisma.transaction.findMany({
      where,
      orderBy: [{ transactionDate: 'desc' }],
      take: limit,
      include: {
        category: { select: { name: true } },
        account: { select: { name: true } },
      },
    });
    return transactions.map((tx) => ({
      id: tx.id,
      date: tx.transactionDate.toISOString().slice(0, 10),
      amount: Number(tx.amountCents) / 100,
      type: tx.type,
      description: tx.description,
      category: tx.category?.name ?? null,
      account: tx.account.name,
    }));
  }
}
