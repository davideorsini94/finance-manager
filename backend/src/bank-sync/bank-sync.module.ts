import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { ImportsModule } from '../imports/imports.module';
import { TransfersModule } from '../transfers/transfers.module';
import { BANK_PROVIDER } from './bank-provider.port';
import { BankReviewService } from './bank-review.service';
import { BankSyncConfigService } from './bank-sync-config.service';
import { BankSyncSettingsService } from './bank-sync-settings.service';
import { BankSyncSettingsController } from './bank-sync-settings.controller';
import { BankSyncService } from './bank-sync.service';
import { BankSyncController } from './bank-sync.controller';
import { EnableBankingClient } from './enable-banking.client';
import { EnableBankingProvider } from './enable-banking.provider';
import { SyncEngineService } from './sync-engine.service';
import { TransferMatcherService } from './transfer-matcher.service';

/**
 * Sync bancario (Enable Banking, solo AIS/lettura).
 *
 * `BANK_PROVIDER` è il punto di sostituzione: `BankSyncService` conosce solo
 * `BankProviderPort`, mai il client HTTP.
 *
 * Dipendenze esterne (nessun ciclo: nessuno di questi moduli importa bank-sync):
 *  - `ImportsModule` → `CategoryAiService`, il classificatore di categorie;
 *  - `TransfersModule` → `TransfersService`, per confermare i giroconti;
 *  - `CategoriesModule` → `CategorySharingService`, per replicare le categorie
 *    sui conti condivisi come fa `TransactionsService.create`.
 */
@Module({
  imports: [ImportsModule, TransfersModule, CategoriesModule],
  controllers: [BankSyncSettingsController, BankSyncController],
  providers: [
    BankSyncConfigService,
    BankSyncSettingsService,
    BankSyncService,
    SyncEngineService,
    TransferMatcherService,
    BankReviewService,
    EnableBankingClient,
    EnableBankingProvider,
    { provide: BANK_PROVIDER, useExisting: EnableBankingProvider },
  ],
  exports: [BankSyncConfigService, SyncEngineService, BANK_PROVIDER],
})
export class BankSyncModule {}
