import { Injectable, Logger } from '@nestjs/common';
import {
  BankSyncConfigService,
  type BankSyncCredentialsStatus,
} from './bank-sync-config.service';
import { EnableBankingClient } from './enable-banking.client';
import { EnableBankingProvider } from './enable-banking.provider';

export interface BankSyncTestResult {
  ok: boolean;
  message: string;
}

/**
 * Impostazioni admin del sync bancario: lettura/scrittura credenziali (delegate
 * a `BankSyncConfigService`) e prova di connessione verso Enable Banking.
 */
@Injectable()
export class BankSyncSettingsService {
  private readonly logger = new Logger(BankSyncSettingsService.name);

  constructor(
    private readonly config: BankSyncConfigService,
    private readonly client: EnableBankingClient,
    private readonly provider: EnableBankingProvider,
  ) {}

  getStatus(): Promise<BankSyncCredentialsStatus> {
    return this.config.getStatus();
  }

  async save(
    userId: string,
    appId: string,
    privateKeyPem: string,
  ): Promise<BankSyncCredentialsStatus> {
    const status = await this.config.save(userId, appId, privateKeyPem);
    // Il catalogo istituti dipende dall'applicazione (sandbox vs production):
    // al cambio credenziali la cache va svuotata subito.
    this.provider.invalidateInstitutionsCache();
    return status;
  }

  async remove(): Promise<void> {
    await this.config.remove();
    this.provider.invalidateInstitutionsCache();
  }

  /**
   * Firma un JWT con le credenziali salvate e interroga il provider.
   * Non solleva mai: l'esito negativo è parte della risposta, così la UI può
   * mostrare il motivo esatto senza gestire codici di errore.
   */
  async test(): Promise<BankSyncTestResult> {
    try {
      const app = await this.client.getApplication();
      const name = typeof app.name === 'string' ? app.name : null;
      return {
        ok: true,
        message: name
          ? `Connessione riuscita: applicazione "${name}" autenticata su Enable Banking.`
          : 'Connessione riuscita: credenziali accettate da Enable Banking.',
      };
    } catch (e) {
      // Alcune applicazioni non espongono /application: si riprova con la
      // lista banche, che è comunque una chiamata autenticata.
      try {
        const res = await this.client.listAspsps('IT');
        const count = Array.isArray(res.aspsps) ? res.aspsps.length : 0;
        return {
          ok: true,
          message: `Connessione riuscita: ${count} banche italiane disponibili.`,
        };
      } catch (fallbackError) {
        this.logger.warn(`Test credenziali fallito: ${(e as Error).message}`);
        return { ok: false, message: (fallbackError as Error).message };
      }
    }
  }
}
