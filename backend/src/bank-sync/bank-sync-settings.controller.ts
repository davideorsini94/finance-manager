import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { BankSyncSettingsService } from './bank-sync-settings.service';
import { UpdateBankSyncCredentialsDto } from './dto/bank-sync.dto';

/**
 * Credenziali dell'applicazione Enable Banking. Admin-only, come le altre
 * impostazioni di sistema (pattern `SmtpSettingsController`): la chiave privata
 * è unica per l'istanza, non per utente.
 *
 * La GET restituisce solo `hasCredentials` e l'application ID mascherato: la
 * chiave privata non torna MAI al client.
 */
@Controller('settings/bank-sync')
@Roles(UserRole.admin)
export class BankSyncSettingsController {
  constructor(private readonly settings: BankSyncSettingsService) {}

  @Get()
  get() {
    return this.settings.getStatus();
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Put()
  upsert(@CurrentUser() user: AuthUser, @Body() dto: UpdateBankSyncCredentialsDto) {
    return this.settings.save(user.id, dto.appId, dto.privateKeyPem);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove() {
    await this.settings.remove();
  }

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('test')
  @HttpCode(HttpStatus.OK)
  test() {
    return this.settings.test();
  }
}
