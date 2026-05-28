import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/services/crypto.service';

const SINGLETON_ID = 'singleton';

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  fromEmail: string;
  fromName: string | null;
  updatedAt: Date;
  hasPassword: boolean;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private transporterUpdatedAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async getSettings(): Promise<SmtpSettings | null> {
    const cfg = await this.prisma.smtpConfig.findUnique({ where: { id: SINGLETON_ID } });
    if (!cfg) return null;
    return {
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      username: cfg.username,
      fromEmail: cfg.fromEmail,
      fromName: cfg.fromName,
      updatedAt: cfg.updatedAt,
      hasPassword: !!cfg.passwordEncrypted,
    };
  }

  async saveSettings(
    userId: string,
    input: {
      host: string;
      port: number;
      secure: boolean;
      username?: string | null;
      password?: string | null; // null = invariata, string = nuova
      fromEmail: string;
      fromName?: string | null;
    },
  ): Promise<SmtpSettings> {
    const existing = await this.prisma.smtpConfig.findUnique({ where: { id: SINGLETON_ID } });

    let passwordEncrypted: string | null | undefined;
    if (input.password === null || input.password === '') {
      passwordEncrypted = null;
    } else if (input.password === undefined) {
      passwordEncrypted = undefined; // invariata
    } else {
      passwordEncrypted = this.crypto.encrypt(input.password);
    }

    await this.prisma.smtpConfig.upsert({
      where: { id: SINGLETON_ID },
      create: {
        id: SINGLETON_ID,
        host: input.host,
        port: input.port,
        secure: input.secure,
        username: input.username ?? null,
        passwordEncrypted: passwordEncrypted ?? null,
        fromEmail: input.fromEmail,
        fromName: input.fromName ?? null,
        updatedBy: userId,
      },
      update: {
        host: input.host,
        port: input.port,
        secure: input.secure,
        username: input.username ?? null,
        ...(passwordEncrypted !== undefined ? { passwordEncrypted } : {}),
        fromEmail: input.fromEmail,
        fromName: input.fromName ?? null,
        updatedBy: userId,
      },
    });
    this.invalidateTransporter();
    void existing; // referenced solo per leggibilità
    const settings = await this.getSettings();
    if (!settings) throw new Error('Failed to persist SMTP settings');
    return settings;
  }

  async deleteSettings(): Promise<void> {
    await this.prisma.smtpConfig.deleteMany({ where: { id: SINGLETON_ID } });
    this.invalidateTransporter();
  }

  /**
   * Invia email di test all'indirizzo specificato usando la config corrente.
   */
  async sendTestEmail(to: string): Promise<void> {
    const transport = await this.getTransporter();
    if (!transport) throw new ServiceUnavailableException('SMTP not configured');
    const settings = await this.getSettings();
    if (!settings) throw new ServiceUnavailableException('SMTP not configured');
    await transport.sendMail({
      from: this.formatFrom(settings),
      to,
      subject: 'Finance Manager — Email di test',
      text: 'Se ricevi questa email, la configurazione SMTP funziona correttamente.',
      html: '<p>Se ricevi questa email, la configurazione SMTP funziona correttamente.</p>',
    });
  }

  /**
   * Invia un invito a registrarsi. Se SMTP non è configurato, ritorna
   * `false` senza errore: il chiamante può comunque mostrare il link
   * direttamente all'admin.
   */
  async sendInviteEmail(
    to: string,
    inviteUrl: string,
    invitedByName?: string | null,
  ): Promise<boolean> {
    const transport = await this.getTransporter();
    if (!transport) return false;
    const settings = await this.getSettings();
    if (!settings) return false;

    const fromLine = invitedByName
      ? `${invitedByName} ti ha invitato a Finance Manager.`
      : 'Sei stato invitato a Finance Manager.';

    await transport.sendMail({
      from: this.formatFrom(settings),
      to,
      subject: 'Finance Manager — Invito',
      text: `${fromLine}\n\nClicca sul link per attivare il tuo account (valido 48h):\n${inviteUrl}\n`,
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto">
          <h2>Finance Manager</h2>
          <p>${fromLine}</p>
          <p>Clicca sul pulsante per impostare la tua password e attivare l'account (valido 48h):</p>
          <p><a href="${inviteUrl}" style="display:inline-block;background:#3b82f6;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Attiva account</a></p>
          <p style="color:#64748b;font-size:12px">Se non hai richiesto questo invito, ignora il messaggio.</p>
        </div>
      `,
    });
    return true;
  }

  /**
   * Email di recupero password con link al frontend `/reset-password?token=...`.
   * Silenzioso se SMTP non configurato (il chiamante può comunque mostrare
   * il link all'admin per recupero manuale).
   */
  async sendPasswordResetEmail(
    to: string,
    resetUrl: string,
    userFullName?: string | null,
  ): Promise<boolean> {
    const transport = await this.getTransporter();
    if (!transport) return false;
    const settings = await this.getSettings();
    if (!settings) return false;

    const greeting = userFullName ? `Ciao ${userFullName},` : 'Ciao,';
    await transport.sendMail({
      from: this.formatFrom(settings),
      to,
      subject: 'Finance Manager — Reset password',
      text: `${greeting}\n\nHai richiesto il reset della password del tuo account Finance Manager.\nClicca sul link per impostare una nuova password (valido 1 ora):\n${resetUrl}\n\nSe non sei stato tu a richiederlo, ignora questa email — la tua password attuale resta valida.\n`,
      html: `
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:auto;color:#0f172a">
          <div style="background:#3b82f6;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0">
            <div style="font-size:12px;opacity:0.85;letter-spacing:0.04em;text-transform:uppercase">Finance Manager</div>
            <div style="font-size:18px;font-weight:600;margin-top:4px">Reset della password</div>
          </div>
          <div style="background:#f8fafc;padding:20px 22px;border-radius:0 0 10px 10px;border:1px solid #e2e8f0;border-top:none">
            <p style="margin:0 0 14px 0;line-height:1.5">${greeting}</p>
            <p style="margin:0 0 14px 0;line-height:1.5">
              Hai richiesto il reset della password del tuo account Finance Manager.
              Clicca sul pulsante qui sotto per impostarne una nuova (link valido <strong>1 ora</strong>):
            </p>
            <p style="text-align:center;margin:18px 0">
              <a href="${resetUrl}" style="display:inline-block;background:#3b82f6;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:500">Imposta nuova password</a>
            </p>
            <p style="margin:14px 0 0 0;line-height:1.5;color:#64748b;font-size:12px">
              Se non sei stato tu a richiederlo, ignora questa email — la tua password attuale resta valida.
            </p>
          </div>
        </div>
      `,
    });
    return true;
  }

  /**
   * Invio email generico per le notifiche. Stessa policy di
   * sendInviteEmail: silenzioso se SMTP non configurato.
   */
  async sendNotificationEmail(
    to: string,
    subject: string,
    html: string,
    text: string,
  ): Promise<boolean> {
    const transport = await this.getTransporter();
    if (!transport) return false;
    const settings = await this.getSettings();
    if (!settings) return false;
    await transport.sendMail({
      from: this.formatFrom(settings),
      to,
      subject,
      text,
      html,
    });
    return true;
  }

  /**
   * Invia un'email per un invito a un conto condiviso.
   * Silenzioso se SMTP non configurato.
   */
  async sendAccountInviteEmail(
    to: string,
    params: {
      acceptUrl: string;
      accountName: string;
      role: string;
      invitedByName?: string | null;
    },
  ): Promise<boolean> {
    const transport = await this.getTransporter();
    if (!transport) return false;
    const settings = await this.getSettings();
    if (!settings) return false;

    const fromLine = params.invitedByName
      ? `${params.invitedByName} ti ha invitato a collaborare al conto "${params.accountName}".`
      : `Sei stato invitato a collaborare al conto "${params.accountName}".`;

    await transport.sendMail({
      from: this.formatFrom(settings),
      to,
      subject: `Finance Manager — Invito al conto "${params.accountName}"`,
      text: `${fromLine}\n\nRuolo: ${params.role}\nClicca sul link per accettare (valido 7gg):\n${params.acceptUrl}\n`,
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto">
          <h2>Finance Manager</h2>
          <p>${fromLine}</p>
          <p>Ruolo: <strong>${params.role}</strong></p>
          <p><a href="${params.acceptUrl}" style="display:inline-block;background:#3b82f6;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Accetta invito</a></p>
          <p style="color:#64748b;font-size:12px">Se non riconosci il mittente, ignora questo messaggio. Il link scade in 7 giorni.</p>
        </div>
      `,
    });
    return true;
  }

  private async getTransporter(): Promise<Transporter | null> {
    const cfg = await this.prisma.smtpConfig.findUnique({ where: { id: SINGLETON_ID } });
    if (!cfg) return null;

    // Cache invalidation se il record è stato aggiornato
    const updatedTs = cfg.updatedAt.getTime();
    if (this.transporter && this.transporterUpdatedAt === updatedTs) {
      return this.transporter;
    }

    const password = cfg.passwordEncrypted ? this.crypto.decrypt(cfg.passwordEncrypted) : undefined;
    this.transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.username
        ? { user: cfg.username, pass: password ?? '' }
        : undefined,
    });
    this.transporterUpdatedAt = updatedTs;
    return this.transporter;
  }

  private invalidateTransporter() {
    this.transporter = null;
    this.transporterUpdatedAt = 0;
  }

  private formatFrom(s: SmtpSettings): string {
    return s.fromName ? `"${s.fromName}" <${s.fromEmail}>` : s.fromEmail;
  }
}
