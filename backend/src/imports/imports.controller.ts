import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { ImportsService } from './imports.service';
import {
  ConfirmBatchDto,
  CreateBatchDto,
  CreateTemplateDto,
} from './dto/import.dto';

@Controller('imports')
export class ImportsController {
  constructor(private readonly service: ImportsService) {}

  @Post('batches')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateBatchDto) {
    return this.service.createBatch(u.id, dto);
  }

  @Get('batches')
  list(@CurrentUser() u: AuthUser) {
    return this.service.listBatches(u.id);
  }

  @Get('batches/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.getBatch(u.id, id);
  }

  @Post('batches/:id/confirm')
  confirm(
    @CurrentUser() u: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ConfirmBatchDto,
  ) {
    return this.service.confirm(u.id, id, dto);
  }

  @Post('batches/:id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.cancel(u.id, id);
  }

  @Get('templates')
  templates(@CurrentUser() u: AuthUser) {
    return this.service.listTemplates(u.id);
  }

  @Post('templates')
  createTemplate(@CurrentUser() u: AuthUser, @Body() dto: CreateTemplateDto) {
    return this.service.createTemplate(u.id, dto);
  }

  @Delete('templates/:id')
  deleteTemplate(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.deleteTemplate(u.id, id);
  }
}
