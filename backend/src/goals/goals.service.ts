import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountPolicyService } from '../common/services/account-policy.service';
import { CreateGoalDto, UpdateGoalDto } from './dto/goal.dto';

@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AccountPolicyService,
  ) {}

  async create(userId: string, dto: CreateGoalDto) {
    if (dto.accountId) await this.policy.assertRead(userId, dto.accountId);
    return this.prisma.goal.create({
      data: {
        userId,
        accountId: dto.accountId ?? null,
        name: dto.name,
        targetCents: BigInt(dto.targetCents),
        currentCents: BigInt(dto.currentCents ?? 0),
        deadline: dto.deadline ? new Date(dto.deadline) : null,
      },
    });
  }

  list(userId: string) {
    return this.prisma.goal.findMany({
      where: { userId },
      orderBy: [{ isCompleted: 'asc' }, { deadline: 'asc' }, { createdAt: 'desc' }],
      include: { account: { select: { id: true, name: true, type: true } } },
    });
  }

  async update(userId: string, id: string, dto: UpdateGoalDto) {
    const goal = await this.prisma.goal.findUnique({ where: { id } });
    if (!goal || goal.userId !== userId) throw new NotFoundException('Goal not found');
    return this.prisma.goal.update({
      where: { id },
      data: {
        name: dto.name,
        targetCents: dto.targetCents !== undefined ? BigInt(dto.targetCents) : undefined,
        currentCents: dto.currentCents !== undefined ? BigInt(dto.currentCents) : undefined,
        deadline:
          dto.deadline === null ? null : dto.deadline ? new Date(dto.deadline) : undefined,
        isCompleted: dto.isCompleted,
      },
    });
  }

  async remove(userId: string, id: string) {
    const goal = await this.prisma.goal.findUnique({ where: { id } });
    if (!goal || goal.userId !== userId) throw new NotFoundException('Goal not found');
    await this.prisma.goal.delete({ where: { id } });
  }
}
