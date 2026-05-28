import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { AttachmentsService } from './attachments.service';

@Controller()
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Post('transactions/:transactionId/attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 11 * 1024 * 1024 } }))
  upload(
    @CurrentUser() user: AuthUser,
    @Param('transactionId', new ParseUUIDPipe()) transactionId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.attachmentsService.upload(user.id, transactionId, file);
  }

  @Get('transactions/:transactionId/attachments')
  list(
    @CurrentUser() user: AuthUser,
    @Param('transactionId', new ParseUUIDPipe()) transactionId: string,
  ) {
    return this.attachmentsService.listForTransaction(user.id, transactionId);
  }

  @Get('attachments/:id/presigned')
  presigned(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.attachmentsService.getPresigned(user.id, id);
  }

  /**
   * Stream del binario dell'allegato. Sostituisce in pratica le presigned
   * URL di MinIO (che non funzionano dal browser perché puntano al
   * hostname interno della rete docker). Imposta Content-Type corretto e
   * `Content-Disposition: inline` così img/iframe mostrano l'anteprima.
   *
   * Usa `StreamableFile` di NestJS che gestisce backpressure / abort /
   * disposing del socket meglio del puro `stream.pipe(res)`. Il browser
   * (in particolare Chrome PDF viewer) è schizzinoso: con il pipe diretto
   * a volte la chunked-encoding produceva un download stream che PDF
   * viewer interpretava come "Failed to load PDF document".
   */
  @Get('attachments/:id/content')
  async content(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, filename, mimeType, sizeBytes } = await this.attachmentsService.openStream(
      user.id,
      id,
    );
    // Sanitizza il filename per Content-Disposition: solo ASCII printable e
    // niente quote/backslash/path separators. Per nomi non ASCII forniamo
    // anche `filename*=UTF-8''<encoded>` (RFC 6266).
    const asciiFallback = filename.replace(/[^\x20-\x7E]+/g, '_').replace(/["\\]/g, '_');
    const utf8Encoded = encodeURIComponent(filename);
    res.set({
      'Content-Type': mimeType,
      'Content-Length': String(sizeBytes),
      'Content-Disposition': `inline; filename="${asciiFallback}"; filename*=UTF-8''${utf8Encoded}`,
      'Cache-Control': 'private, max-age=900',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(stream, { type: mimeType, length: sizeBytes });
  }

  @Delete('attachments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.attachmentsService.remove(user.id, id);
  }
}
