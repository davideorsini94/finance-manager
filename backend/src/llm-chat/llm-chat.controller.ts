import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { LlmChatService } from './llm-chat.service';

class CreateSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}

class SendMessageDto {
  @IsString()
  @MaxLength(4000)
  content!: string;
}

@Controller('chat')
export class LlmChatController {
  constructor(private readonly chatService: LlmChatService) {}

  @Get('sessions')
  list(@CurrentUser() user: AuthUser) {
    return this.chatService.listSessions(user.id);
  }

  @Post('sessions')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSessionDto) {
    return this.chatService.createSession(user.id, dto.title);
  }

  @Get('sessions/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.chatService.getSession(user.id, id);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.chatService.deleteSession(user.id, id);
  }

  @Post('sessions/:id/messages')
  async sendMessage(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SendMessageDto,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    try {
      for await (const chunk of this.chatService.streamReply(user.id, id, dto.content)) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        if (chunk.done) break;
      }
    } catch (e) {
      const message = (e as Error).message;
      res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
    } finally {
      res.end();
    }
  }
}
