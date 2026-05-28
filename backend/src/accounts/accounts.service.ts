import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountMemberRole, AccountType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountPolicyService } from '../common/services/account-policy.service';
import {
  AddMemberDto,
  CreateAccountDto,
  UpdateAccountDto,
  UpdateMemberDto,
} from './dto/account.dto';

const ACCOUNT_INCLUDE = {
  members: { include: { user: { select: { id: true, email: true, fullName: true } } } },
  owner: { select: { id: true, email: true, fullName: true } },
} satisfies Prisma.AccountInclude;

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AccountPolicyService,
  ) {}

  async create(userId: string, dto: CreateAccountDto) {
    if (dto.type === AccountType.credit_card) {
      if (!dto.paymentAccountId) {
        throw new BadRequestException('paymentAccountId is required for credit_card');
      }
      // Il conto di pagamento deve essere accessibile in scrittura all'utente
      await this.policy.assertWrite(userId, dto.paymentAccountId);
      const payment = await this.prisma.account.findUnique({
        where: { id: dto.paymentAccountId },
        select: { type: true },
      });
      if (payment?.type === AccountType.credit_card) {
        throw new BadRequestException('paymentAccountId cannot be a credit_card');
      }
    }

    return this.prisma.account.create({
      data: {
        name: dto.name,
        type: dto.type,
        color: dto.color,
        icon: dto.icon,
        ownerId: userId,
        balanceCents: BigInt(dto.initialBalanceCents ?? 0),
        paymentAccountId: dto.type === AccountType.credit_card ? dto.paymentAccountId : null,
        billingDay: dto.type === AccountType.credit_card ? (dto.billingDay ?? 15) : null,
      },
      include: ACCOUNT_INCLUDE,
    });
  }

  async list(userId: string) {
    return this.prisma.account.findMany({
      where: this.policy.accessibleAccountsWhere(userId),
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      include: ACCOUNT_INCLUDE,
    });
  }

  async findOne(userId: string, id: string) {
    await this.policy.assertRead(userId, id);
    const account = await this.prisma.account.findUnique({
      where: { id },
      include: ACCOUNT_INCLUDE,
    });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  async update(userId: string, id: string, dto: UpdateAccountDto) {
    await this.policy.assertWrite(userId, id);

    if (dto.paymentAccountId) {
      await this.policy.assertWrite(userId, dto.paymentAccountId);
    }

    return this.prisma.account.update({
      where: { id },
      data: {
        name: dto.name,
        color: dto.color,
        icon: dto.icon,
        paymentAccountId: dto.paymentAccountId,
        billingDay: dto.billingDay,
        // Override esplicito del saldo (correzione manuale dell'utente).
        // Non genera transazioni di rettifica: la nuova cifra è autoritativa.
        ...(dto.balanceCents !== undefined ? { balanceCents: BigInt(dto.balanceCents) } : {}),
      },
      include: ACCOUNT_INCLUDE,
    });
  }

  async archive(userId: string, id: string) {
    await this.policy.assertOwner(userId, id);
    return this.prisma.account.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }

  // ----- Members -----

  async addMember(ownerId: string, accountId: string, dto: AddMemberDto) {
    await this.policy.assertOwner(ownerId, accountId);
    if (dto.role === AccountMemberRole.owner) {
      throw new BadRequestException('Cannot assign owner role; use account ownership');
    }
    if (dto.userId === ownerId) {
      throw new BadRequestException('Owner is implicit, cannot be added as member');
    }
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user || !user.isActive) throw new NotFoundException('User not found');

    try {
      return await this.prisma.accountMember.create({
        data: { accountId, userId: dto.userId, role: dto.role },
        include: { user: { select: { id: true, email: true, fullName: true } } },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('User is already a member');
      }
      throw e;
    }
  }

  async updateMember(
    ownerId: string,
    accountId: string,
    targetUserId: string,
    dto: UpdateMemberDto,
  ) {
    await this.policy.assertOwner(ownerId, accountId);
    if (dto.role === AccountMemberRole.owner) {
      throw new BadRequestException('Cannot assign owner role here');
    }
    const member = await this.prisma.accountMember.findUnique({
      where: { accountId_userId: { accountId, userId: targetUserId } },
    });
    if (!member) throw new NotFoundException('Member not found');

    return this.prisma.accountMember.update({
      where: { accountId_userId: { accountId, userId: targetUserId } },
      data: { role: dto.role },
      include: { user: { select: { id: true, email: true, fullName: true } } },
    });
  }

  async removeMember(ownerId: string, accountId: string, targetUserId: string) {
    await this.policy.assertOwner(ownerId, accountId);
    await this.prisma.accountMember.deleteMany({ where: { accountId, userId: targetUserId } });
  }
}
