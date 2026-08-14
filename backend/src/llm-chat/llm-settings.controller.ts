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
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { LlmModelsService } from './llm-models.service';
import { PullModelDto, SetActiveModelDto } from './dto/llm-settings.dto';

/**
 * Impostazioni del modello LLM locale (Ollama).
 *
 * Le GET sono aperte a qualsiasi utente autenticato (la card in Impostazioni
 * mostra a tutti quale modello è attivo); download, eliminazione e selezione
 * sono admin-only, come le altre impostazioni di sistema.
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
}
