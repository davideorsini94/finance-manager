import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { LlmModelsService } from './llm-models.service';
import {
  PullModelDto,
  SetActiveModelDto,
  SetOpencodeKeyDto,
  SetOpencodeModelDto,
  SetProviderDto,
} from './dto/llm-settings.dto';

/**
 * Impostazioni del modello LLM: locale (Ollama) o cloud (OpenCode Zen/Go).
 *
 * Le GET sono aperte a qualsiasi utente autenticato (la card in Impostazioni
 * mostra a tutti quale modello è attivo); modifica di provider, chiave API,
 * download, eliminazione e selezione sono admin-only, come le altre
 * impostazioni di sistema.
 */
@Controller('settings/llm')
export class LlmSettingsController {
  constructor(private readonly models: LlmModelsService) {}

  @Get()
  overview() {
    return this.models.getOverview();
  }

  @Get('catalog')
  catalog() {
    return this.models.getCatalog();
  }

  @Get('pull-status')
  pullStatus() {
    return this.models.getPullStatus();
  }

  /** Elenco modelli della tier OpenCode (query `?tier=zen|go`). */
  @Get('opencode/models')
  opencodeModels(@Query('tier') tier?: string) {
    return this.models.getOpencodeModels(tier === 'go' ? 'go' : tier === 'zen' ? 'zen' : undefined);
  }

  @Roles(UserRole.admin)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('models/pull')
  @HttpCode(HttpStatus.ACCEPTED)
  startPull(@Body() dto: PullModelDto) {
    return this.models.startPull(dto.model);
  }

  /**
   * `name` arriva URL-encoded perché i tag contengono ':' (es.
   * `qwen2.5%3A7b-instruct-q4_K_M`); Express decodifica i parametri di rotta.
   */
  @Roles(UserRole.admin)
  @Delete('models/:name')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('name') name: string) {
    await this.models.deleteModel(name);
  }

  @Roles(UserRole.admin)
  @Put()
  setActive(@CurrentUser() user: AuthUser, @Body() dto: SetActiveModelDto) {
    return this.models.setActiveModel(user.id, dto.model);
  }

  @Roles(UserRole.admin)
  @Put('provider')
  setProvider(@CurrentUser() user: AuthUser, @Body() dto: SetProviderDto) {
    return this.models.setProvider(user.id, dto.provider);
  }

  @Roles(UserRole.admin)
  @Put('opencode/key')
  saveOpencodeKey(
    @CurrentUser() user: AuthUser,
    @Body() dto: SetOpencodeKeyDto,
  ) {
    return this.models.saveOpencodeApiKey(user.id, dto.apiKey, dto.tier);
  }

  @Roles(UserRole.admin)
  @Delete('opencode/key')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeOpencodeKey() {
    return this.models.removeOpencodeKey();
  }

  @Roles(UserRole.admin)
  @Put('opencode/model')
  selectOpencodeModel(@CurrentUser() user: AuthUser, @Body() dto: SetOpencodeModelDto) {
    return this.models.selectOpencodeModel(user.id, dto.model);
  }

  @Roles(UserRole.admin)
  @Post('opencode/test')
  testOpencode() {
    return this.models.testOpencode();
  }
}
