import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
}

interface RefreshTokenPayload {
  sub: string;
  family: string;
  jti: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTtlSec: number;
  refreshTtlSec: number;
}

const INVITE_TTL_HOURS = 48;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
  ) {}

  async login(email: string, password: string): Promise<TokenPair & { userId: string; role: UserRole }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');

    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const family = randomUUID();
    const tokens = await this.issueTokens(user.id, user.email, user.role, family);
    return { ...tokens, userId: user.id, role: user.role };
  }

  async refresh(rawRefreshToken: string): Promise<TokenPair & { userId: string; role: UserRole }> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(rawRefreshToken, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenHash = this.hashToken(rawRefreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    // Detection furto: token sconosciuto con family valida → revoca tutta la family
    if (!stored) {
      await this.prisma.refreshToken.updateMany({
        where: { family: payload.family, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    if (stored.revokedAt) {
      // Token già revocato usato di nuovo: stesso scenario
      await this.prisma.refreshToken.updateMany({
        where: { family: stored.family, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token already used');
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const user = await this.prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user || !user.isActive) throw new UnauthorizedException('User inactive');

    // Rotation: revoca il vecchio + emetti nuovo nella stessa family
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const tokens = await this.issueTokens(user.id, user.email, user.role, stored.family);
    return { ...tokens, userId: user.id, role: user.role };
  }

  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) return;
    const tokenHash = this.hashToken(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async createInvite(
    adminId: string,
    email: string,
    publicBaseUrl?: string,
  ): Promise<{ token: string; expiresAt: Date; emailSent: boolean }> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('User with this email already exists');

    // Invalida inviti precedenti non usati per la stessa email
    await this.prisma.inviteToken.updateMany({
      where: { email, usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);

    await this.prisma.inviteToken.create({
      data: { token, email, invitedBy: adminId, expiresAt },
    });

    let emailSent = false;
    try {
      const admin = await this.prisma.user.findUnique({
        where: { id: adminId },
        select: { fullName: true, email: true },
      });
      const inviteUrl = `${publicBaseUrl ?? ''}/accept-invite?token=${token}`;
      emailSent = await this.mailService.sendInviteEmail(
        email,
        inviteUrl,
        admin?.fullName ?? admin?.email,
      );
    } catch (e) {
      this.logger.warn(`Invite email failed for ${email}: ${(e as Error).message}`);
    }

    return { token, expiresAt, emailSent };
  }

  async listInvites(): Promise<
    { id: string; email: string; expiresAt: Date; createdAt: Date; invitedBy: string; token: string }[]
  > {
    const invites = await this.prisma.inviteToken.findMany({
      where: { usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return invites.map((i) => ({
      id: i.id,
      email: i.email,
      expiresAt: i.expiresAt,
      createdAt: i.createdAt,
      invitedBy: i.invitedBy,
      token: i.token,
    }));
  }

  async revokeInvite(id: string): Promise<void> {
    await this.prisma.inviteToken.update({
      where: { id },
      data: { usedAt: new Date() },
    });
  }

  async validateInvite(token: string): Promise<{ email: string; expiresAt: Date }> {
    const invite = await this.prisma.inviteToken.findUnique({ where: { token } });
    if (!invite) throw new ForbiddenException('Invalid invite token');
    if (invite.usedAt) throw new ForbiddenException('Invite token already used');
    if (invite.expiresAt < new Date()) throw new ForbiddenException('Invite token expired');
    return { email: invite.email, expiresAt: invite.expiresAt };
  }

  async acceptInvite(
    token: string,
    password: string,
    fullName?: string,
  ): Promise<TokenPair & { userId: string; role: UserRole }> {
    const invite = await this.validateInvite(token);

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: invite.email,
          passwordHash,
          fullName,
          role: UserRole.user,
          locale: 'it',
        },
      });
      await tx.inviteToken.update({
        where: { token },
        data: { usedAt: new Date() },
      });
      return created;
    });

    const family = randomUUID();
    const tokens = await this.issueTokens(user.id, user.email, user.role, family);
    return { ...tokens, userId: user.id, role: user.role };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    if (currentPassword === newPassword) {
      throw new BadRequestException('New password must differ from current');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const ok = await argon2.verify(user.passwordHash, currentPassword);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      // Revoca tutti i refresh token attivi: l'utente dovrà rifare login altrove
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  // ============================================================
  // PASSWORD RESET
  // ============================================================

  /**
   * Richiede un reset password per `email`. Per evitare user-enumeration la
   * risposta è sempre "ok" (anche se l'email non corrisponde a un utente).
   * Se l'email esiste:
   *   - invalida eventuali token di reset precedenti non usati
   *   - crea un nuovo token (storato come SHA-256 hash, TTL 1h)
   *   - manda email col link `${baseUrl}/reset-password?token=<plain>`
   * SMTP non configurato → l'email non parte (silently false).
   */
  async requestPasswordReset(email: string, publicBaseUrl: string): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !user.isActive) {
      // Risposta uniforme per non rivelare l'esistenza dell'utente.
      return { ok: true };
    }

    // Invalida i token non ancora usati (un solo reset attivo per volta)
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h

    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    const resetUrl = `${publicBaseUrl}/reset-password?token=${token}`;
    try {
      await this.mailService.sendPasswordResetEmail(user.email, resetUrl, user.fullName);
    } catch (e) {
      this.logger.warn(`Password reset email failed for ${user.email}: ${(e as Error).message}`);
    }
    return { ok: true };
  }

  /**
   * Verifica se un token di reset è valido (utile per il frontend prima di
   * mostrare il form password).
   */
  async validatePasswordResetToken(token: string): Promise<{ ok: boolean }> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.hashToken(token) },
    });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      return { ok: false };
    }
    return { ok: true };
  }

  /**
   * Esegue il reset password con il token monouso. Revoca tutti i refresh
   * token attivi dell'utente (forza re-login ovunque).
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.hashToken(token) },
    });
    if (!record || record.usedAt) {
      throw new BadRequestException('Token non valido o già utilizzato');
    }
    if (record.expiresAt < new Date()) {
      throw new BadRequestException('Token scaduto');
    }
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      });
      await tx.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
      // Revoca tutti i refresh token attivi
      await tx.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  private async issueTokens(
    userId: string,
    email: string,
    role: UserRole,
    family: string,
  ): Promise<TokenPair> {
    const accessTtl = this.configService.get<string>('JWT_ACCESS_TTL') ?? '15m';
    const refreshTtl = this.configService.get<string>('JWT_REFRESH_TTL') ?? '30d';
    const accessTtlSec = parseTtlSec(accessTtl);
    const refreshTtlSec = parseTtlSec(refreshTtl);

    const accessPayload: AccessTokenPayload = { sub: userId, email, role };
    const accessToken = await this.jwtService.signAsync(accessPayload, {
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: accessTtl,
    });

    const jti = randomUUID();
    const refreshPayload: RefreshTokenPayload = { sub: userId, family, jti };
    const refreshToken = await this.jwtService.signAsync(refreshPayload, {
      secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: refreshTtl,
    });

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshToken),
        family,
        expiresAt: new Date(Date.now() + refreshTtlSec * 1000),
      },
    });

    return { accessToken, refreshToken, accessTtlSec, refreshTtlSec };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

function parseTtlSec(ttl: string): number {
  const match = ttl.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid TTL: ${ttl}`);
  const n = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return n * multipliers[unit];
}
