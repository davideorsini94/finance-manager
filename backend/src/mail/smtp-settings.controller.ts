import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { MailService } from './mail.service';
import { TestSmtpDto, UpdateSmtpDto } from './dto/smtp.dto';

@Controller('settings/smtp')
@Roles(UserRole.admin)
export class SmtpSettingsController {
  constructor(private readonly mailService: MailService) {}

  @Get()
  get() {
    return this.mailService.getSettings();
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Put()
  async upsert(@CurrentUser() user: AuthUser, @Body() dto: UpdateSmtpDto) {
    return this.mailService.saveSettings(user.id, {
      host: dto.host,
      port: dto.port,
      secure: dto.secure,
      username: dto.username ?? null,
      password: dto.password,
      fromEmail: dto.fromEmail,
      fromName: dto.fromName ?? null,
    });
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove() {
    await this.mailService.deleteSettings();
  }

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('test')
  @HttpCode(HttpStatus.OK)
  async test(@Body() dto: TestSmtpDto) {
    try {
      await this.mailService.sendTestEmail(dto.to);
      return { ok: true };
    } catch (e) {
      const raw = (e as Error).message;
      throw new BadRequestException(humanizeSmtpError(raw));
    }
  }
}

/**
 * Normalizza i messaggi SMTP più frequenti in qualcosa di leggibile per l'utente.
 */
function humanizeSmtpError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes('530') || m.includes('authentication required')) {
    return (
      'Autenticazione SMTP rifiutata dal server (530). ' +
      'Su Gmail/Outlook/Yahoo serve una "Password per le app" (non quella dell\'account) ' +
      'e la verifica in due passaggi deve essere attiva. Verifica anche che username e password siano corretti. ' +
      `[Dettaglio server: ${raw.split('\n')[0]}]`
    );
  }
  if (m.includes('535') || m.includes('username and password not accepted')) {
    return (
      'Credenziali SMTP non accettate (535). Su Gmail probabilmente stai usando la password ' +
      "del tuo account: serve invece una 'Password per le app' a 16 caratteri. " +
      `[Dettaglio: ${raw.split('\n')[0]}]`
    );
  }
  if (m.includes('econnrefused')) {
    return `Impossibile connettersi al server SMTP. Host o porta errati. [${raw.split('\n')[0]}]`;
  }
  if (m.includes('etimedout') || m.includes('timeout')) {
    return `Timeout connessione SMTP: il server non risponde sulla porta indicata. [${raw.split('\n')[0]}]`;
  }
  if (m.includes('self signed') || m.includes('unable to verify')) {
    return `Certificato SSL non valido. Per server self-hosted, prova STARTTLS invece di TLS implicito. [${raw.split('\n')[0]}]`;
  }
  return raw;
}
