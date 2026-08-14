import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createPrivateKey } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { BANK_SYNC_CRYPTO_CONTEXT, CryptoService } from '../common/services/crypto.service';

const SINGLETON_ID = 'singleton';

export interface BankSyncCredentialsStatus {
  hasCredentials: boolean;
  /** Application ID offuscato (primi 4 + … + ultimi 4). `null` se non configurato. */
  appIdMasked: string | null;
}

export interface BankSyncCredentials {
  appId: string;
  privateKeyPem: string;
}

/**
 * Credenziali dell'applicazione Enable Banking (singleton `bank_sync_config`).
 *
 * La chiave privata è cifrata at-rest (contesto `fm-banksync-v1`) e **non esce
 * mai** dalle API: `getCredentials()` la decifra al volo a ogni richiesta e il
 * chiamante la usa solo per firmare il JWT della singola chiamata — niente
 * cache del PEM in chiaro, niente log. Non c'è nemmeno una cache della riga:
 * il costo è una query per chiamata HTTP verso la banca, irrilevante.
 */
@Injectable()
export class BankSyncConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async getStatus(): Promise<BankSyncCredentialsStatus> {
    const cfg = await this.prisma.bankSyncConfig.findUnique({ where: { id: SINGLETON_ID } });
    const configured = !!cfg?.appId && !!cfg?.privateKeyEncrypted;
    return {
      hasCredentials: configured,
      appIdMasked: configured ? maskAppId(cfg!.appId!) : null,
    };
  }

  async save(userId: string, appId: string, privateKeyPem: string): Promise<BankSyncCredentialsStatus> {
    const normalizedId = appId.trim();
    if (!normalizedId) {
      throw new BadRequestException("L'application ID non può essere vuoto.");
    }
    const normalizedPem = normalizePem(privateKeyPem);
    assertUsableRsaKey(normalizedPem);

    await this.prisma.bankSyncConfig.upsert({
      where: { id: SINGLETON_ID },
      create: {
        id: SINGLETON_ID,
        appId: normalizedId,
        privateKeyEncrypted: this.crypto.encrypt(normalizedPem, BANK_SYNC_CRYPTO_CONTEXT),
        updatedBy: userId,
      },
      update: {
        appId: normalizedId,
        privateKeyEncrypted: this.crypto.encrypt(normalizedPem, BANK_SYNC_CRYPTO_CONTEXT),
        updatedBy: userId,
      },
    });

    return { hasCredentials: true, appIdMasked: maskAppId(normalizedId) };
  }

  async remove(): Promise<void> {
    await this.prisma.bankSyncConfig.deleteMany({ where: { id: SINGLETON_ID } });
  }

  /** Credenziali in chiaro per firmare una singola chiamata. Lancia se non configurate. */
  async getCredentials(): Promise<BankSyncCredentials> {
    const cfg = await this.prisma.bankSyncConfig.findUnique({ where: { id: SINGLETON_ID } });
    if (!cfg?.appId || !cfg.privateKeyEncrypted) {
      throw new ServiceUnavailableException(
        'Credenziali Enable Banking non configurate: impostale in Impostazioni → Sync bancario.',
      );
    }
    let privateKeyPem: string;
    try {
      privateKeyPem = this.crypto.decrypt(cfg.privateKeyEncrypted, BANK_SYNC_CRYPTO_CONTEXT);
    } catch {
      // Tipicamente: JWT_ACCESS_SECRET ruotato dopo il salvataggio.
      throw new ServiceUnavailableException(
        'Impossibile decifrare la chiave privata Enable Banking: reinseriscila in Impostazioni → Sync bancario.',
      );
    }
    return { appId: cfg.appId, privateKeyPem };
  }
}

/** Primi 4 + … + ultimi 4. Gli ID troppo corti vengono mascherati per intero. */
export function maskAppId(appId: string): string {
  if (appId.length <= 8) return '…';
  return `${appId.slice(0, 4)}…${appId.slice(-4)}`;
}

/**
 * Il PEM incollato dalla UI arriva spesso con CRLF o escape `\n` letterali
 * (copia-incolla da un JSON): normalizziamo prima di cifrare, altrimenti la
 * firma fallisce ogni volta senza un motivo evidente per l'utente.
 */
function normalizePem(raw: string): string {
  return raw.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();
}

/** Verifica subito che la chiave sia utilizzabile: meglio fallire al salvataggio. */
function assertUsableRsaKey(pem: string): void {
  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(pem)) {
    throw new BadRequestException(
      'La chiave privata deve essere in formato PEM (blocco "-----BEGIN PRIVATE KEY-----").',
    );
  }
  let key;
  try {
    key = createPrivateKey(pem);
  } catch {
    // Nessun dettaglio dell'errore nel messaggio: potrebbe contenere parti della chiave.
    throw new BadRequestException('Chiave privata non valida o protetta da passphrase.');
  }
  if (key.asymmetricKeyType !== 'rsa' && key.asymmetricKeyType !== 'rsa-pss') {
    throw new BadRequestException('Enable Banking richiede una chiave RSA (firma RS256).');
  }
}
