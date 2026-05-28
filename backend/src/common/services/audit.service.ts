import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, AuditEntity, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(
    userId: string,
    action: AuditAction,
    entity: AuditEntity,
    entityId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action,
          entity,
          entityId,
          metadata: metadata ? (metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
      });
    } catch (e) {
      // L'audit log non deve mai bloccare l'operazione di business
      this.logger.warn(`Audit log failed for ${entity}/${entityId}: ${(e as Error).message}`);
    }
  }
}
