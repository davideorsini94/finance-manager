import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountPolicyService } from '../common/services/account-policy.service';

const PUBLIC_USER_FIELDS = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  locale: true,
  isActive: true,
  favoriteAccountId: true,
  createdAt: true,
};

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AccountPolicyService,
  ) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: PUBLIC_USER_FIELDS,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateMe(id: string, data: { fullName?: string; locale?: string }) {
    return this.prisma.user.update({
      where: { id },
      data,
      select: PUBLIC_USER_FIELDS,
    });
  }

  /**
   * Imposta (o rimuove con `null`) il conto preferito dell'utente.
   * Il conto deve essere accessibile in lettura dall'utente: questo evita
   * che vengano impostati come preferiti id di conti non accessibili.
   */
  async setFavoriteAccount(userId: string, accountId: string | null) {
    if (accountId !== null) {
      const canRead = await this.policy.canRead(userId, accountId);
      if (!canRead) {
        throw new BadRequestException('Account not accessible');
      }
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: { favoriteAccountId: accountId },
      select: PUBLIC_USER_FIELDS,
    });
  }

  async list(query?: string) {
    const where = query
      ? {
          isActive: true,
          OR: [
            { email: { contains: query, mode: 'insensitive' as const } },
            { fullName: { contains: query, mode: 'insensitive' as const } },
          ],
        }
      : { isActive: true };

    return this.prisma.user.findMany({
      where,
      select: { id: true, email: true, fullName: true },
      orderBy: { fullName: 'asc' },
      take: 50,
    });
  }

  async deactivate(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return this.prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: PUBLIC_USER_FIELDS,
    });
  }
}
