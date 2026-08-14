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
} from '@nestjs/common';
import { BankSyncTrigger, StagedTxStatus } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { BankReviewService } from './bank-review.service';
import { BankSyncService } from './bank-sync.service';
import { SyncEngineService } from './sync-engine.service';
import {
  ConfirmReviewDto,
  ListReviewQueryDto,
  UpdateReviewItemDto,
} from './dto/bank-review.dto';
import {
  BankSyncCallbackDto,
  CreateConnectionDto,
  CreateLinkDto,
  ListInstitutionsQueryDto,
  UpdateLinkDto,
} from './dto/bank-sync.dto';

/**
 * Collegamenti bancari dell'utente. Tutte le rotte richiedono JWT tranne
 * `POST bank-sync/callback`, che è pubblica per forza: la banca rimanda
 * l'utente su Safari, fuori dalla sessione della PWA.
 */
@Controller('bank-sync')
export class BankSyncController {
  constructor(
    private readonly bankSync: BankSyncService,
    private readonly syncEngine: SyncEngineService,
    private readonly review: BankReviewService,
  ) {}

  @Get('institutions')
  institutions(@Query() query: ListInstitutionsQueryDto) {
    return this.bankSync.listInstitutions(query.country ?? 'IT');
  }

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('connections')
  createConnection(@CurrentUser() user: AuthUser, @Body() dto: CreateConnectionDto) {
    return this.bankSync.createConnection(user.id, dto);
  }

  @Get('connections')
  listConnections(@CurrentUser() user: AuthUser) {
    return this.bankSync.listConnections(user.id);
  }

  /** Stato locale: è l'endpoint di polling della UI dopo il consenso. */
  @Get('connections/:id')
  getConnection(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.bankSync.getConnection(user.id, id);
  }

  @Get('connections/:id/accounts')
  connectionAccounts(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.bankSync.listConnectionAccounts(user.id, id);
  }

  /**
   * Rinnovo del consenso: rigenera l'autorizzazione sulla stessa connessione
   * (i conti collegati vengono ri-mappati per IBAN al ritorno dal callback).
   */
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('connections/:id/renew')
  @HttpCode(HttpStatus.OK)
  renewConnection(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.bankSync.renewConnection(user.id, id);
  }

  @Delete('connections/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteConnection(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.bankSync.deleteConnection(user.id, id);
  }

  @Post('links')
  createLink(@CurrentUser() user: AuthUser, @Body() dto: CreateLinkDto) {
    return this.bankSync.createLink(user.id, dto);
  }

  @Patch('links/:id')
  updateLink(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateLinkDto,
  ) {
    return this.bankSync.updateLink(user.id, id, dto.syncEnabled);
  }

  @Delete('links/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteLink(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.bankSync.deleteLink(user.id, id);
  }

  /**
   * Sincronizzazione manuale di tutti i conti collegati dell'utente. La quota
   * (4/giorno) è in DB, non nel throttler: vedi `SyncEngineService`.
   */
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  sync(@CurrentUser() user: AuthUser) {
    return this.syncEngine.syncUser(user.id, BankSyncTrigger.manual);
  }

  /** Sincronizzazione manuale di un solo conto collegato (stessa quota). */
  @Post('links/:id/sync')
  @HttpCode(HttpStatus.OK)
  syncLink(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.syncEngine.syncLink(id, user.id, BankSyncTrigger.manual);
  }

  /** Badge della coda di revisione: righe da rivedere sui conti scrivibili. */
  @Get('review/count')
  reviewCount(@CurrentUser() user: AuthUser) {
    return this.syncEngine.reviewCount(user.id);
  }

  /**
   * Coda di revisione. Visibilità = write sul conto collegato, non proprietà
   * della connessione: su un conto condiviso rivedono entrambi.
   */
  @Get('review')
  listReview(@CurrentUser() user: AuthUser, @Query() query: ListReviewQueryDto) {
    return this.review.list(user.id, query.status ?? StagedTxStatus.pending_review);
  }

  /** Categoria, tipo, accoppiamento giroconto, ignora/ripristina. */
  @Patch('review/:id')
  updateReview(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateReviewItemDto,
  ) {
    return this.review.update(user.id, id, dto);
  }

  /**
   * Conferma multipla: le righe selezionate diventano movimenti (e giroconti).
   * Può essere lenta con molte righe — il client usa un timeout esteso.
   */
  @Post('review/confirm')
  @HttpCode(HttpStatus.OK)
  confirmReview(@CurrentUser() user: AuthUser, @Body() dto: ConfirmReviewDto) {
    return this.review.confirm(user.id, dto.ids);
  }

  /**
   * Callback pubblica dello scambio del code (vedi `BankSyncService.handleCallback`).
   * Throttling stretto: è l'unica rotta di questo modulo raggiungibile senza JWT.
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('callback')
  @HttpCode(HttpStatus.OK)
  callback(@Body() dto: BankSyncCallbackDto) {
    return this.bankSync.handleCallback(dto.code, dto.state);
  }
}
