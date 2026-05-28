import {
  Controller,
  Get,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { BackupService } from './backup.service';

@Controller('backup')
@Roles(UserRole.admin)
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Throttle({ default: { ttl: 5 * 60_000, limit: 5 } })
  @Get('export')
  async export(@Res() res: Response) {
    const filename = `finance-manager-backup-${new Date().toISOString().slice(0, 10)}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const stream = await this.backupService.exportToStream();
    stream.pipe(res);
  }

  @Throttle({ default: { ttl: 5 * 60_000, limit: 3 } })
  @Post('restore')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 500 * 1024 * 1024 } }))
  async restore(@UploadedFile() file: Express.Multer.File) {
    return this.backupService.restoreFromZip(file.buffer);
  }
}
