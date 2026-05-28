import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import {
  ListNotificationsQuery,
  MarkReadDto,
  TestNotificationDto,
  UpdatePreferencesDto,
} from './dto/notification.dto';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListNotificationsQuery) {
    return this.service.list(user.id, query);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthUser) {
    return { count: await this.service.unreadCount(user.id) };
  }

  @Patch('read')
  async markRead(@CurrentUser() user: AuthUser, @Body() dto: MarkReadDto) {
    await this.service.markRead(user.id, dto.ids);
    return { ok: true };
  }

  @Patch('read-all')
  async markAllRead(@CurrentUser() user: AuthUser) {
    await this.service.markAllRead(user.id);
    return { ok: true };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.remove(user.id, id);
  }

  // ----- Preferences -----

  @Get('preferences')
  prefs(@CurrentUser() user: AuthUser) {
    return this.service.getPreferences(user.id);
  }

  @Patch('preferences')
  updatePrefs(@CurrentUser() user: AuthUser, @Body() dto: UpdatePreferencesDto) {
    return this.service.updatePreferences(user.id, dto);
  }

  // ----- SSE stream -----

  @Sse('stream')
  stream(@CurrentUser() user: AuthUser): Observable<MessageEvent> {
    return this.service.stream(user.id).pipe(
      map(
        (data) =>
          ({
            data: JSON.stringify(data),
          }) as unknown as MessageEvent,
      ),
    );
  }

  // ----- Test (admin/dev) -----

  @Post('test')
  test(@CurrentUser() user: AuthUser, @Body() dto: TestNotificationDto) {
    return this.service.create({
      userId: user.id,
      type: dto.type,
      title: `Notifica di test (${dto.type})`,
      body: 'Questa è una notifica di prova generata manualmente.',
      data: { kind: 'system', level: 'info' } as never,
    });
  }
}
