import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import {
  AccountMemberRole,
  AccountRole,
  InviteStatus,
  NotificationType,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CategorySharingService } from '../categories/category-sharing.service';
import { InviteMemberDto } from './dto/sharing.dto';

const INVITE_TTL_DAYS = 7;

/** Mapping fra il ruolo "logico" (AccountRole) e quello sull'AccountMember (AccountMemberRole). */
function toMemberRole(role: AccountRole): AccountMemberRole {
  switch (role) {
    case AccountRole.owner:
      return AccountMemberRole.owner;
    case AccountRole.editor:
      return AccountMemberRole.write;
    case AccountRole.viewer:
    default:
      return AccountMemberRole.read;
  }
}

function toAccountRole(role: AccountMemberRole): AccountRole {
  switch (role) {
    case AccountMemberRole.owner:
      return AccountRole.owner;
    case AccountMemberRole.write:
      return AccountRole.editor;
    case AccountMemberRole.read:
    default:
      return AccountRole.viewer;
  }
}

@Injectable()
export class SharingService {
  private readonly logger = new Logger(SharingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    private readonly categorySharing: CategorySharingService,
  ) {}

  // ============================================================
  // Owner-side
  // ============================================================

  async listMembers(userId: string, accountId: string) {
    await this.ensureAccess(userId, accountId);
    const [members, invites, account] = await this.prisma.$transaction([
      this.prisma.accountMember.findMany({
        where: { accountId },
        include: { user: { select: { id: true, email: true, fullName: true } } },
      }),
      this.prisma.accountInvite.findMany({
        where: { accountId, status: InviteStatus.pending },
        include: { inviter: { select: { fullName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.account.findUnique({
        where: { id: accountId },
        select: {
          ownerId: true,
          name: true,
          owner: { select: { id: true, email: true, fullName: true } },
        },
      }),
    ]);
    if (!account) throw new NotFoundException();
    return {
      account,
      members: members.map((m) => ({ ...m, role: toAccountRole(m.role) })),
      invites,
    };
  }

  async invite(userId: string, accountId: string, dto: InviteMemberDto) {
    await this.ensureOwner(userId, accountId);
    if (dto.role === AccountRole.owner) {
      throw new BadRequestException('Per cambiare owner usa /transfer-ownership');
    }

    const memberRole = toMemberRole(dto.role);
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      const member = await this.prisma.accountMember.findUnique({
        where: { accountId_userId: { accountId, userId: existing.id } },
      });
      if (member) {
        if (member.role !== memberRole) {
          await this.prisma.accountMember.update({
            where: { accountId_userId: { accountId, userId: existing.id } },
            data: { role: memberRole },
          });
        }
        // Replica le categorie del conto nuovo membro (anche se già membro:
        // potrebbe servire ad allinearlo a categorie aggiunte di recente).
        void this.categorySharing.replicateAccountCategoriesTo(accountId, existing.id);
        return { kind: 'member_updated' as const, userId: existing.id };
      }
    }

    await this.prisma.accountInvite.updateMany({
      where: { accountId, email: dto.email, status: InviteStatus.pending },
      data: { status: InviteStatus.revoked },
    });

    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const invite = await this.prisma.accountInvite.create({
      data: {
        accountId,
        invitedBy: userId,
        email: dto.email,
        role: dto.role,
        tokenHash,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000),
      },
      include: {
        account: { select: { name: true } },
        inviter: { select: { fullName: true, email: true } },
      },
    });

    const baseUrl = (this.config.get<string>('APP_PUBLIC_URL') ?? '').replace(/\/$/, '');

    // Caso A: l'utente è già registrato → link diretto alla pagina di
    //   accept (richiede login).
    // Caso B: l'utente NON è ancora registrato → creo un InviteToken di
    //   onboarding e mando un link che fa: imposta password → crea utente
    //   → auto-accept della share invite.
    let acceptUrl: string;
    if (existing) {
      acceptUrl = `${baseUrl}/accounts/invite/accept?token=${token}`;
    } else {
      // Invalida eventuali token di onboarding pending per la stessa email
      await this.prisma.inviteToken.updateMany({
        where: { email: dto.email, usedAt: null },
        data: { usedAt: new Date() },
      });
      const userToken = crypto.randomBytes(32).toString('hex');
      await this.prisma.inviteToken.create({
        data: {
          token: userToken,
          email: dto.email,
          invitedBy: userId,
          // Onboarding scade insieme allo share invite (7gg) per coerenza.
          expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000),
        },
      });
      acceptUrl = `${baseUrl}/accept-invite?token=${userToken}&accountInvite=${token}`;
    }

    void this.mail
      .sendAccountInviteEmail(dto.email, {
        acceptUrl,
        accountName: invite.account.name,
        role: dto.role,
        invitedByName: invite.inviter.fullName ?? invite.inviter.email,
      })
      .catch((e) => this.logger.warn(`Invite email failed: ${(e as Error).message}`));

    if (existing) {
      void this.notifications.create({
        userId: existing.id,
        type: NotificationType.account_shared,
        title: `Conto condiviso con te: ${invite.account.name}`,
        body: `${invite.inviter.fullName ?? invite.inviter.email} ti ha invitato come ${dto.role}.`,
        data: {
          kind: 'account_shared',
          accountId,
          accountName: invite.account.name,
          invitedBy: invite.inviter.fullName ?? invite.inviter.email,
          role: dto.role,
        },
      });
    }

    return { kind: 'invite_sent' as const, inviteId: invite.id };
  }

  async revokeInvite(userId: string, accountId: string, inviteId: string) {
    await this.ensureOwner(userId, accountId);
    const invite = await this.prisma.accountInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.accountId !== accountId) throw new NotFoundException();
    await this.prisma.accountInvite.update({
      where: { id: inviteId },
      data: { status: InviteStatus.revoked },
    });
  }

  async resendInvite(userId: string, accountId: string, inviteId: string) {
    await this.ensureOwner(userId, accountId);
    const invite = await this.prisma.accountInvite.findUnique({
      where: { id: inviteId },
      include: {
        account: { select: { name: true } },
        inviter: { select: { fullName: true, email: true } },
      },
    });
    if (!invite || invite.accountId !== accountId) throw new NotFoundException();
    if (invite.status !== InviteStatus.pending) {
      throw new BadRequestException('Solo gli inviti pending possono essere rinviati');
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await this.prisma.accountInvite.update({
      where: { id: inviteId },
      data: {
        tokenHash,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000),
      },
    });
    const baseUrl = (this.config.get<string>('APP_PUBLIC_URL') ?? '').replace(/\/$/, '');

    // Stesso pattern di `invite()`: se l'invitato non ha ancora un account,
    // creiamo un InviteToken di onboarding e usiamo il link unificato.
    const userExists = await this.prisma.user.findUnique({ where: { email: invite.email } });
    let acceptUrl: string;
    if (userExists) {
      acceptUrl = `${baseUrl}/accounts/invite/accept?token=${token}`;
    } else {
      await this.prisma.inviteToken.updateMany({
        where: { email: invite.email, usedAt: null },
        data: { usedAt: new Date() },
      });
      const userToken = crypto.randomBytes(32).toString('hex');
      await this.prisma.inviteToken.create({
        data: {
          token: userToken,
          email: invite.email,
          invitedBy: userId,
          expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000),
        },
      });
      acceptUrl = `${baseUrl}/accept-invite?token=${userToken}&accountInvite=${token}`;
    }
    void this.mail
      .sendAccountInviteEmail(invite.email, {
        acceptUrl,
        accountName: invite.account.name,
        role: invite.role,
        invitedByName: invite.inviter.fullName ?? invite.inviter.email,
      })
      .catch((e) => this.logger.warn(`Invite email failed: ${(e as Error).message}`));
  }

  async updateMemberRole(
    userId: string,
    accountId: string,
    memberUserId: string,
    role: AccountRole,
  ) {
    await this.ensureOwner(userId, accountId);
    if (memberUserId === userId) throw new BadRequestException('Non puoi modificare il tuo stesso ruolo');
    if (role === AccountRole.owner) throw new BadRequestException('Usa /transfer-ownership');
    const member = await this.prisma.accountMember.findUnique({
      where: { accountId_userId: { accountId, userId: memberUserId } },
    });
    if (!member) throw new NotFoundException();
    return this.prisma.accountMember.update({
      where: { accountId_userId: { accountId, userId: memberUserId } },
      data: { role: toMemberRole(role) },
    });
  }

  async removeMember(userId: string, accountId: string, memberUserId: string) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException();
    if (account.ownerId !== userId && memberUserId !== userId) throw new ForbiddenException();
    if (memberUserId === account.ownerId) throw new BadRequestException("L'owner non può essere rimosso");
    await this.prisma.accountMember.delete({
      where: { accountId_userId: { accountId, userId: memberUserId } },
    });
  }

  async transferOwnership(currentOwnerId: string, accountId: string, newOwnerId: string) {
    await this.ensureOwner(currentOwnerId, accountId);
    const newMember = await this.prisma.accountMember.findUnique({
      where: { accountId_userId: { accountId, userId: newOwnerId } },
    });
    if (!newMember) throw new BadRequestException('Il nuovo owner deve già essere membro');
    await this.prisma.$transaction([
      this.prisma.account.update({ where: { id: accountId }, data: { ownerId: newOwnerId } }),
      this.prisma.accountMember.upsert({
        where: { accountId_userId: { accountId, userId: currentOwnerId } },
        create: { accountId, userId: currentOwnerId, role: AccountMemberRole.write },
        update: { role: AccountMemberRole.write },
      }),
      this.prisma.accountMember.update({
        where: { accountId_userId: { accountId, userId: newOwnerId } },
        data: { role: AccountMemberRole.owner },
      }),
    ]);
  }

  // ============================================================
  // Invitee-side
  // ============================================================

  async acceptInvite(userId: string, token: string) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const invite = await this.prisma.accountInvite.findUnique({
      where: { tokenHash },
      include: { account: { select: { id: true, name: true } } },
    });
    if (!invite) throw new NotFoundException('Invito non trovato');
    if (invite.status !== InviteStatus.pending) {
      throw new BadRequestException(`Invito ${invite.status}`);
    }
    if (invite.expiresAt < new Date()) {
      await this.prisma.accountInvite.update({
        where: { id: invite.id },
        data: { status: InviteStatus.expired },
      });
      throw new BadRequestException('Invito scaduto');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new ForbiddenException("L'email dell'invito non corrisponde all'utente loggato");
    }

    const memberRole = toMemberRole(invite.role);
    await this.prisma.$transaction([
      this.prisma.accountMember.upsert({
        where: { accountId_userId: { accountId: invite.accountId, userId } },
        create: { accountId: invite.accountId, userId, role: memberRole },
        update: { role: memberRole },
      }),
      this.prisma.accountInvite.update({
        where: { id: invite.id },
        data: { status: InviteStatus.accepted, acceptedAt: new Date() },
      }),
    ]);

    // Replica al nuovo membro tutte le categorie usate finora dai movimenti
    // del conto. Sanitize-aware: se l'utente ha già una categoria con lo
    // stesso nome (case/spazi/diacritici insensibile), non la duplica.
    void this.categorySharing.replicateAccountCategoriesTo(invite.accountId, userId);

    return { accountId: invite.accountId, accountName: invite.account.name, role: invite.role };
  }

  async rejectInvite(userId: string, token: string) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const invite = await this.prisma.accountInvite.findUnique({ where: { tokenHash } });
    if (!invite) throw new NotFoundException();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.email.toLowerCase() !== invite.email.toLowerCase())
      throw new ForbiddenException();
    if (invite.status === InviteStatus.pending) {
      await this.prisma.accountInvite.update({
        where: { id: invite.id },
        data: { status: InviteStatus.rejected },
      });
    }
  }

  async listMyPendingInvites(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return [];
    return this.prisma.accountInvite.findMany({
      where: {
        email: user.email,
        status: InviteStatus.pending,
        expiresAt: { gt: new Date() },
      },
      include: {
        account: { select: { name: true, type: true } },
        inviter: { select: { fullName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ============================================================
  // Helpers
  // ============================================================

  private async ensureAccess(userId: string, accountId: string) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      include: { members: { where: { userId } } },
    });
    if (!account) throw new NotFoundException();
    if (account.ownerId !== userId && account.members.length === 0) throw new ForbiddenException();
    return account;
  }

  private async ensureOwner(userId: string, accountId: string) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException();
    if (account.ownerId !== userId) throw new ForbiddenException("Solo l'owner può gestire i membri");
    return account;
  }
}
