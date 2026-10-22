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
  Put,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { SaveUtilityBillDto } from './dto/utility-bill.dto';
import { UtilityBillsService } from './utility-bills.service';

@Controller('utility-bills')
export class UtilityBillsController {
  constructor(private readonly service: UtilityBillsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.get(user.id, id);
  }

  /** Inserimento a mano. */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: SaveUtilityBillDto) {
    return this.service.create(user.id, dto);
  }

  /** Ogni upload costa una lettura LLM: tetto stretto. */
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 11 * 1024 * 1024, files: 1 } }))
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: { buffer: Buffer; originalname: string; size: number } | undefined,
  ) {
    return this.service.upload(user.id, file);
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post(':id/extract')
  reextract(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.reextract(user.id, id);
  }

  /** Salva e conferma (verifica dei dati letti o modifica). */
  @Put(':id')
  save(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SaveUtilityBillDto,
  ) {
    return this.service.save(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.service.remove(user.id, id);
  }

  /** PDF originale, in stream (stessi header di `attachments/:id/content`). */
  @Get(':id/file')
  async file(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, fileName, sizeBytes } = await this.service.openFile(user.id, id);
    const asciiFallback = fileName.replace(/[^\x20-\x7E]+/g, '_').replace(/["\\]/g, '_');
    res.set({
      'Content-Type': 'application/pdf',
      ...(sizeBytes > 0 ? { 'Content-Length': String(sizeBytes) } : {}),
      'Content-Disposition': `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'private, max-age=900',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(stream, { type: 'application/pdf', ...(sizeBytes > 0 ? { length: sizeBytes } : {}) });
  }
}
