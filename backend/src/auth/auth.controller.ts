import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import * as os from 'os';
import type { CookieOptions, Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthService, TokenPair } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { InviteDto } from './dto/invite.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RequestPasswordResetDto, ResetPasswordDto } from './dto/password-reset.dto';

@Controller('auth')
@UseGuards(RolesGuard)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto.email, dto.password);
    this.setAuthCookies(res, result);
    return { userId: result.userId, role: result.role };
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = (req.cookies as Record<string, string> | undefined)?.['refresh_token'];
    if (!refreshToken) {
      res.status(HttpStatus.UNAUTHORIZED);
      return { message: 'No refresh token' };
    }
    const result = await this.authService.refresh(refreshToken);
    this.setAuthCookies(res, result);
    return { userId: result.userId, role: result.role };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = (req.cookies as Record<string, string> | undefined)?.['refresh_token'];
    await this.authService.logout(refreshToken);
    this.clearAuthCookies(res);
  }

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.changePassword(user.id, dto.currentPassword, dto.newPassword);
    // Forza re-login: i refresh token sono stati revocati lato service
    this.clearAuthCookies(res);
  }

  /**
   * Cache in-memory dell'ultimo host "pubblico" osservato sul backend.
   * Auto-impara: appena un utente si collega dalla LAN (es. dal telefono su
   * `http://192.168.1.135`), il valore viene memorizzato e riutilizzato per
   * costruire link nei contesti dove la richiesta arriva da localhost
   * (es. l'admin che clicca "Reimposta password" dallo stesso server).
   *
   * static perché Nest istanzia un solo controller: così sopravvive tra
   * tutte le request del processo. Si resetta al restart del container —
   * basta che un browser apra il sito dalla LAN una volta e si ri-popola.
   */
  private static lastSeenPublicOrigin: { host: string; protocol: string } | null = null;

  /**
   * Costruisce l'URL pubblico usato nei link delle email (inviti, accept,
   * password reset, deeplink).
   *
   * Priorità:
   * 1. Host della request CORRENTE se è "vero" (non localhost/Docker-bridge).
   * 2. Ultimo host "vero" osservato dal backend (cache in-memory) — risolve
   *    il caso "admin clicca dal browser dello stesso server".
   * 3. `APP_PUBLIC_URL` env var (override esplicito dell'admin).
   * 4. Auto-detect via `os.networkInterfaces()` — IPv4 non-loopback non-docker.
   *    Funziona se `network_mode: host`; in Docker bridge dà l'IP del
   *    container 172.x quindi non è affidabile e viene scartato.
   */
  private publicBaseUrl(req: Request): string {
    const rawHost = req.get('host');
    const proto = req.protocol;
    if (rawHost) {
      const hostname = rawHost.split(':')[0];
      if (!isLocalOrDocker(hostname)) {
        AuthController.lastSeenPublicOrigin = { host: rawHost, protocol: proto };
        return `${proto}://${rawHost}`;
      }
    }

    const seen = AuthController.lastSeenPublicOrigin;
    if (seen) return `${seen.protocol}://${seen.host}`;

    const fromEnv = this.configService.get<string>('APP_PUBLIC_URL');
    if (fromEnv) return fromEnv.replace(/\/$/, '');

    const lanIp = detectLanIp();
    if (lanIp) return `http://${lanIp}`;

    return `${proto}://${rawHost ?? 'localhost'}`;
  }

  @Roles(UserRole.admin)
  @Post('invite')
  async invite(@Body() dto: InviteDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const baseUrl = this.publicBaseUrl(req);
    const { token, expiresAt, emailSent } = await this.authService.createInvite(
      user.id,
      dto.email,
      baseUrl,
    );
    return {
      email: dto.email,
      expiresAt,
      emailSent,
      inviteUrl: `${baseUrl}/accept-invite?token=${token}`,
    };
  }

  @Roles(UserRole.admin)
  @Get('invites')
  async listInvites(@Req() req: Request) {
    const baseUrl = this.publicBaseUrl(req);
    const invites = await this.authService.listInvites();
    return invites.map((i) => ({
      id: i.id,
      email: i.email,
      expiresAt: i.expiresAt,
      createdAt: i.createdAt,
      inviteUrl: `${baseUrl}/accept-invite?token=${i.token}`,
    }));
  }

  @Roles(UserRole.admin)
  @Delete('invites/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeInvite(@Param('id') id: string) {
    await this.authService.revokeInvite(id);
  }

  @Public()
  @Get('invite/validate/:token')
  async validateInvite(@Param('token') token: string) {
    return this.authService.validateInvite(token);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('accept-invite')
  @HttpCode(HttpStatus.OK)
  async acceptInvite(@Body() dto: AcceptInviteDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.acceptInvite(dto.token, dto.password, dto.fullName);
    this.setAuthCookies(res, result);
    return { userId: result.userId, role: result.role };
  }

  // ============================================================
  // Password reset (utente ha dimenticato la password)
  // ============================================================

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: RequestPasswordResetDto, @Req() req: Request) {
    const baseUrl = this.publicBaseUrl(req);
    return this.authService.requestPasswordReset(dto.email, baseUrl);
  }

  @Public()
  @Get('reset-password/validate/:token')
  async validateResetToken(@Param('token') token: string) {
    return this.authService.validatePasswordResetToken(token);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { ok: true };
  }

  private setAuthCookies(res: Response, tokens: TokenPair) {
    const base = this.cookieBase();
    res.cookie('access_token', tokens.accessToken, {
      ...base,
      maxAge: tokens.accessTtlSec * 1000,
      path: '/',
    });
    res.cookie('refresh_token', tokens.refreshToken, {
      ...base,
      maxAge: tokens.refreshTtlSec * 1000,
      path: '/',
    });
  }

  private clearAuthCookies(res: Response) {
    const base = this.cookieBase();
    res.clearCookie('access_token', { ...base, path: '/' });
    res.clearCookie('refresh_token', { ...base, path: '/' });
  }

  private cookieBase(): CookieOptions {
    const secure = this.configService.get<string>('COOKIE_SECURE') === 'true';
    const domain = this.configService.get<string>('COOKIE_DOMAIN');
    return {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      ...(domain && domain !== 'localhost' ? { domain } : {}),
    };
  }
}

/**
 * Riconosce hostname "non pubblici" (loopback o reti private Docker bridge).
 * Hostname così non vanno usati nei link email perché il destinatario non
 * potrebbe raggiungere l'app aprendoli.
 */
function isLocalOrDocker(hostname: string): boolean {
  if (!hostname) return true;
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '0.0.0.0' || h === '::1') return true;
  if (h.startsWith('127.')) return true;
  // Docker default bridge: 172.16.0.0/12  →  172.16.x.x ... 172.31.x.x
  const m = h.match(/^172\.(\d+)\./);
  if (m) {
    const second = parseInt(m[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

/**
 * Cerca l'IP IPv4 non-loopback "più probabilmente LAN" del processo.
 * Dentro un container Docker bridge ritornerà l'IP del container (172.x)
 * che è inutile dall'esterno — quindi lo scartiamo. Funziona bene se il
 * backend gira con `network_mode: host` o direttamente sull'host.
 */
function detectLanIp(): string | null {
  const ifaces = os.networkInterfaces();
  // Preferisci IP "tipicamente LAN domestica/azienda"
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] ?? []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      const ip = iface.address;
      if (ip.startsWith('192.168.') || ip.startsWith('10.')) return ip;
    }
  }
  // Fallback: qualunque IPv4 esterno purché NON sia un IP Docker-bridge
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] ?? []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      const ip = iface.address;
      if (ip.startsWith('169.254.')) continue; // link-local
      const m = ip.match(/^172\.(\d+)\./);
      if (m) {
        const s = parseInt(m[1], 10);
        if (s >= 16 && s <= 31) continue; // docker bridge
      }
      return ip;
    }
  }
  return null;
}
