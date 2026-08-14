import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountMemberRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const READ_ROLES: AccountMemberRole[] = [
  AccountMemberRole.read,
  AccountMemberRole.write,
  AccountMemberRole.owner,
];
const WRITE_ROLES: AccountMemberRole[] = [AccountMemberRole.write, AccountMemberRole.owner];

@Injectable()
export class AccountPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Filtro Prisma riusabile: "conti accessibili a userId" (proprietario o membro, non archiviati).
   */
  accessibleAccountsWhere(userId: string): Prisma.AccountWhereInput {
    return {
      archivedAt: null,
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    };
  }

  /**
   * Filtro Prisma riusabile: "conti su cui userId può scrivere" (proprietario o
   * membro con ruolo write/owner, non archiviati). Stessa semantica di
   * `assertWrite`, in forma di `where` — serve ai conteggi aggregati.
   */
  writableAccountsWhere(userId: string): Prisma.AccountWhereInput {
    return {
      archivedAt: null,
      OR: [
        { ownerId: userId },
        { members: { some: { userId, role: { in: WRITE_ROLES } } } },
      ],
    };
  }

  async canRead(userId: string, accountId: string): Promise<boolean> {
    return this.hasAccess(userId, accountId, READ_ROLES);
  }

  async canWrite(userId: string, accountId: string): Promise<boolean> {
    return this.hasAccess(userId, accountId, WRITE_ROLES);
  }

  async assertRead(userId: string, accountId: string): Promise<void> {
    if (!(await this.canRead(userId, accountId))) {
      throw await this.notFoundOrForbidden(accountId);
    }
  }

  async assertWrite(userId: string, accountId: string): Promise<void> {
    if (!(await this.canWrite(userId, accountId))) {
      throw await this.notFoundOrForbidden(accountId);
    }
  }

  async assertOwner(userId: string, accountId: string): Promise<void> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { ownerId: true, archivedAt: true },
    });
    if (!account || account.archivedAt) throw new NotFoundException('Account not found');
    if (account.ownerId !== userId) throw new ForbiddenException('Owner only');
  }

  private async hasAccess(
    userId: string,
    accountId: string,
    roles: AccountMemberRole[],
  ): Promise<boolean> {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, archivedAt: null },
      select: {
        ownerId: true,
        members: { where: { userId }, select: { role: true } },
      },
    });
    if (!account) return false;
    if (account.ownerId === userId) return true;
    const member = account.members[0];
    return !!member && roles.includes(member.role);
  }

  private async notFoundOrForbidden(accountId: string): Promise<NotFoundException | ForbiddenException> {
    const exists = await this.prisma.account.findFirst({
      where: { id: accountId, archivedAt: null },
      select: { id: true },
    });
    return exists ? new ForbiddenException('Insufficient access') : new NotFoundException('Account not found');
  }
}
