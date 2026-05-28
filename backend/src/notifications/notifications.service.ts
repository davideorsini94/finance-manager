import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Subject, Observable, filter, map, share } from 'rxjs';
import {
  NotificationChannel,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  DEFAULT_PREFS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  type NotificationData,
  type NotificationDto,
  type NotificationListResult,
  type NotificationStreamEvent,
} from './notifications.types';
import { renderNotificationEmail } from '../mail/templates/notification-email';
import { ListNotificationsQuery, UpdatePreferencesDto } from './dto/notification.dto';

type InternalEvent = NotificationStreamEvent & { userId: string };

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly events$ = new Subject<InternalEvent>();
  /** stream condiviso (multicast) per non duplicare il subject per ogni client */
  private readonly shared$ = this.events$.pipe(share());

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  // ============================================================
  // CRUD-ish
  // ============================================================

  /**
   * Crea una notifica per `userId`. Rispetta le preferenze:
   *  - se `in_app` è disabilitato, non crea il record (no-op)
   *  - se `email` è abilitato e SMTP è configurato, invia email
   * Idempotency: se `dedupKey` è fornito, salta la creazione se esiste già
   * una notifica non letta dello stesso tipo con `data.dedupKey === key`
   * nelle ultime 24h.
   */
  async create(input: {
    userId: string;
    type: NotificationType;
    title: string;
    body?: string | null;
    data?: NotificationData;
    /** chiave anti-duplicato (es. `${budgetId}:${month}:80`) */
    dedupKey?: string;
    /** email destination override (default = email utente) */
    emailTo?: string;
  }): Promise<NotificationDto | null> {
    const prefs = await this.getEffectivePrefs(input.userId, input.type);
    if (!prefs.in_app && !prefs.email) return null;

    if (input.dedupKey) {
      const exists = await this.prisma.notification.findFirst({
        where: {
          userId: input.userId,
          type: input.type,
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          data: { path: ['dedupKey'], equals: input.dedupKey },
        },
        select: { id: true },
      });
      if (exists) return null;
    }

    let dto: NotificationDto | null = null;
    if (prefs.in_app) {
      const data = input.dedupKey
        ? { ...(input.data ?? {}), dedupKey: input.dedupKey }
        : input.data;
      const created = await this.prisma.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          data: (data as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        },
      });
      dto = this.toDto(created);
      this.events$.next({ userId: input.userId, event: 'created', notification: dto });
      const unread = await this.unreadCount(input.userId);
      this.events$.next({ userId: input.userId, event: 'unread_count', count: unread });
    }

    if (prefs.email) {
      this.sendEmailFireAndForget(input.userId, input.title, input.body ?? '', input.data, input.emailTo);
    }

    return dto;
  }

  async list(userId: string, query: ListNotificationsQuery): Promise<NotificationListResult> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.NotificationWhereInput = { userId };
    if (query.unreadOnly) where.readAt = null;

    const [items, total, unread] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

    return { items: items.map((n) => this.toDto(n)), total, unread };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const result = await this.prisma.notification.updateMany({
      where: { userId, id: { in: ids }, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count > 0) {
      this.events$.next({ userId, event: 'read', ids });
      const unread = await this.unreadCount(userId);
      this.events$.next({ userId, event: 'unread_count', count: unread });
    }
  }

  async markAllRead(userId: string): Promise<void> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count > 0) {
      this.events$.next({ userId, event: 'read', ids: [] /* "all" */ });
      this.events$.next({ userId, event: 'unread_count', count: 0 });
    }
  }

  async remove(userId: string, id: string): Promise<void> {
    const n = await this.prisma.notification.findUnique({ where: { id } });
    if (!n || n.userId !== userId) throw new NotFoundException('Notification not found');
    await this.prisma.notification.delete({ where: { id } });
    const unread = await this.unreadCount(userId);
    this.events$.next({ userId, event: 'unread_count', count: unread });
  }

  // ============================================================
  // Preferences
  // ============================================================

  async getPreferences(userId: string) {
    const stored = await this.prisma.notificationPreference.findMany({ where: { userId } });
    const map = new Map<string, boolean>();
    for (const p of stored) map.set(`${p.type}:${p.channel}`, p.enabled);
    return NOTIFICATION_TYPES.flatMap((type) =>
      NOTIFICATION_CHANNELS.map((channel) => ({
        type,
        channel,
        enabled: map.get(`${type}:${channel}`) ?? DEFAULT_PREFS[type][channel],
      })),
    );
  }

  async updatePreferences(userId: string, dto: UpdatePreferencesDto) {
    await this.prisma.$transaction(
      dto.items.map((it) =>
        this.prisma.notificationPreference.upsert({
          where: { userId_type_channel: { userId, type: it.type, channel: it.channel } },
          create: { userId, type: it.type, channel: it.channel, enabled: it.enabled },
          update: { enabled: it.enabled },
        }),
      ),
    );
    return this.getPreferences(userId);
  }

  private async getEffectivePrefs(
    userId: string,
    type: NotificationType,
  ): Promise<Record<NotificationChannel, boolean>> {
    const stored = await this.prisma.notificationPreference.findMany({
      where: { userId, type },
    });
    const result = { ...DEFAULT_PREFS[type] };
    for (const p of stored) result[p.channel] = p.enabled;
    return result;
  }

  // ============================================================
  // SSE stream
  // ============================================================

  stream(userId: string): Observable<NotificationStreamEvent> {
    return this.shared$.pipe(
      filter((e) => e.userId === userId),
      map(({ userId: _u, ...e }) => e as NotificationStreamEvent),
    );
  }

  // ============================================================
  // Helpers
  // ============================================================

  private toDto(n: {
    id: string;
    type: NotificationType;
    title: string;
    body: string | null;
    data: Prisma.JsonValue;
    readAt: Date | null;
    createdAt: Date;
  }): NotificationDto {
    return {
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      data: (n.data as NotificationData | null) ?? null,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    };
  }

  private sendEmailFireAndForget(
    userId: string,
    title: string,
    body: string,
    data: NotificationData | undefined,
    overrideTo?: string,
  ): void {
    void (async () => {
      try {
        const to =
          overrideTo ??
          (await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } }))
            ?.email;
        if (!to) return;
        const html = renderNotificationEmail({ title, body, data });
        // sendInviteEmail riusa il transporter; per simmetria definiamo un metodo
        // generico sul MailService (vedi mail.service.ts patch additiva).
        await (this.mail as unknown as {
          sendNotificationEmail(to: string, subject: string, html: string, text: string): Promise<boolean>;
        }).sendNotificationEmail(to, `Finance Manager — ${title}`, html, body || title);
      } catch (e) {
        this.logger.warn(`Notification email failed for user ${userId}: ${(e as Error).message}`);
      }
    })();
  }
}
