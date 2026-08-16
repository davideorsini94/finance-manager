import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  GoneException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import {
  AccountType,
  AuditAction,
  AuditEntity,
  BankConnectionStatus,
  BankSyncTrigger,
  Prisma,
  type BankAccountLink,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountPolicyService } from '../common/services/account-policy.service';
import { AuditService } from '../common/services/audit.service';
import { sanitizeExternalText } from '../common/utils/sanitize-text';
import {
  BANK_PROVIDER,
  type BankProviderPort,
  type ConsentSession,
  type ProviderAccountDetails,
  type ProviderAccountRef,
  type ProviderInstitution,
} from './bank-provider.port';
import { BankProviderError } from './enable-banking.client';
import { computeConsentValidUntil, normalizeAccountEntry } from './enable-banking.provider';
import { SyncEngineService } from './sync-engine.service';
import { MAX_SYNC_TIMES, SYNC_TIME_PATTERN } from './dto/bank-sync.dto';
import type { CreateConnectionDto, CreateLinkDto } from './dto/bank-sync.dto';

/**
 * Finestra di validità dello "state" anti-CSRF, contata da `updatedAt`: alla
 * prima creazione coincide con `createdAt`, al **rinnovo** riparte da capo
 * (altrimenti una connessione vecchia nascerebbe già scaduta).
 */
const STATE_TTL_MS = 15 * 60 * 1000;

/** Percorso della pagina pubblica di callback nel frontend. */
const CALLBACK_PATH = '/bank-sync/callback';

/**
 * Stati da cui il rinnovo del consenso ha senso: c'è già un collegamento, ma
 * l'autorizzazione è scaduta o non più utilizzabile. Da `pending` no (c'è
 * un'autorizzazione in corso), da `revoked` nemmeno (va rifatto il collegamento).
 */
const RENEWABLE_STATUSES: BankConnectionStatus[] = [
  BankConnectionStatus.linked,
  BankConnectionStatus.expired,
  BankConnectionStatus.suspended,
  BankConnectionStatus.error,
];

/**
 * Prefisso dei valori temporanei usati nella ri-mappatura dei conti: serve solo
 * a non violare `@@unique([connectionId, providerAccountId])` mentre due link si
 * scambiano l'uid. Non è mai un identificativo valido lato provider.
 */
const REMAP_TMP_PREFIX = 'renew-tmp:';

export interface BankLinkView {
  id: string;
  accountId: string;
  accountName: string;
  providerAccountId: string;
  iban: string | null;
  currency: string;
  syncEnabled: boolean;
  /** Ultima sincronizzazione riuscita del conto (null = mai sincronizzato). */
  lastSyncAt: Date | null;
  /**
   * Saldo dichiarato dalla banca all'ultimo sync riuscito, in centesimi
   * (serializzato come stringa: è un BigInt). Serve alla riconciliazione col
   * saldo dell'app, che resta calcolato dai movimenti.
   */
  lastBalanceCents: bigint | null;
  lastBalanceAt: Date | null;
}

/** Conto bancario coperto dal consenso, come mostrato nel wizard di mapping. */
export interface ConnectionAccountView {
  uid: string;
  iban: string | null;
  name: string | null;
  currency: string | null;
  alreadyLinked: boolean;
}

export interface BankConnectionView {
  id: string;
  institutionName: string;
  institutionLogo: string | null;
  status: BankConnectionStatus;
  consentExpiresAt: Date | null;
  createdAt: Date;
  links: BankLinkView[];
}

const CONNECTION_INCLUDE = {
  links: {
    orderBy: { createdAt: 'asc' },
    include: { account: { select: { id: true, name: true } } },
  },
} satisfies Prisma.BankConnectionInclude;

type ConnectionWithLinks = Prisma.BankConnectionGetPayload<{ include: typeof CONNECTION_INCLUDE }>;

/**
 * Collegamenti bancari: connessioni (consensi PSD2) e mappatura conto banca →
 * conto dell'app. Il download dei movimenti arriva in Fase 3.
 *
 * ACL: una connessione è visibile e gestibile **solo dal suo proprietario**
 * (`userId`); le operazioni sui link passano invece da `AccountPolicyService`
 * sul conto collegato, come le transazioni.
 */
@Injectable()
export class BankSyncService {
  private readonly logger = new Logger(BankSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly policy: AccountPolicyService,
    private readonly audit: AuditService,
    private readonly syncEngine: SyncEngineService,
    @Inject(BANK_PROVIDER) private readonly provider: BankProviderPort,
  ) {}

  // ---------------------------------------------------------------- istituti

  async listInstitutions(country = 'IT'): Promise<{ items: ProviderInstitution[] }> {
    const normalized = country.toUpperCase();
    // 'ALL' = nessun filtro paese: con credenziali sandbox la Mock ASPSP non è italiana.
    const items = await this.remote(() =>
      this.provider.listInstitutions(normalized === 'ALL' ? undefined : normalized),
    );
    return { items };
  }

  // ------------------------------------------- orari di sync automatico

  /**
   * Orari (HH:mm, ora italiana) in cui parte la sincronizzazione automatica
   * dell'utente. Lista vuota = sync automatico disattivato.
   */
  async getSchedule(userId: string): Promise<{ times: string[] }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { bankSyncTimes: true },
    });
    if (!user) throw new NotFoundException('Utente non trovato.');
    return { times: normalizeSyncTimes(user.bankSyncTimes) };
  }

  /**
   * Sostituisce gli orari di sync automatico. Il formato è già validato dal
   * DTO: qui si deduplica e si ordina, così il tetto di `MAX_SYNC_TIMES` conta
   * gli orari **effettivi** (e non due volte lo stesso).
   */
  async updateSchedule(userId: string, times: string[]): Promise<{ times: string[] }> {
    const normalized = normalizeSyncTimes(times);
    if (normalized.length > MAX_SYNC_TIMES) {
      throw new BadRequestException(
        `Puoi impostare al massimo ${MAX_SYNC_TIMES} sincronizzazioni automatiche al giorno.`,
      );
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { bankSyncTimes: normalized },
    });
    return { times: normalized };
  }

  // ------------------------------------------------------------- connessioni

  async createConnection(
    userId: string,
    dto: CreateConnectionDto,
  ): Promise<{ connectionId: string; authUrl: string }> {
    const redirectUrl = this.buildRedirectUrl();
    const country = dto.aspspCountry.toUpperCase();
    const institutions = await this.remote(() => this.provider.listInstitutions(country));
    const institution = institutions.find(
      (i) => i.name.toLowerCase() === dto.aspspName.trim().toLowerCase(),
    );
    if (!institution) {
      throw new NotFoundException(
        `Istituto "${dto.aspspName}" non disponibile per il paese ${country}.`,
      );
    }

    // State anti-CSRF: 128 bit, monouso, verificato nel callback pubblico.
    const state = randomBytes(16).toString('hex');
    const validUntil = computeConsentValidUntil(institution.maximumConsentValidity);

    // La riga nasce PRIMA della chiamata al provider: se la banca reindirizza
    // l'utente prima che la POST /auth ci risponda, lo state deve già esistere.
    const connection = await this.prisma.bankConnection.create({
      data: {
        userId,
        institutionId: `${institution.country}:${institution.name}`,
        institutionName: institution.name,
        institutionLogo: institution.logo ?? httpsUrlOrNull(dto.institutionLogo),
        reference: state,
        status: BankConnectionStatus.pending,
      },
    });

    try {
      const result = await this.remote(() =>
        this.provider.startConsent({
          aspspName: institution.name,
          aspspCountry: institution.country,
          state,
          redirectUrl,
          validUntil,
        }),
      );
      void this.audit.log(userId, AuditAction.create, AuditEntity.bank_connection, connection.id, {
        institution: institution.name,
        country: institution.country,
      });
      return { connectionId: connection.id, authUrl: result.authUrl };
    } catch (e) {
      // Consenso mai avviato: la riga pending sarebbe solo rumore in lista.
      await this.prisma.bankConnection
        .delete({ where: { id: connection.id } })
        .catch(() => undefined);
      throw e;
    }
  }

  /**
   * Rinnovo del consenso: il consenso PSD2 dura al massimo 90 giorni e le
   * banche italiane non prevedono una "riconferma", quindi si rifà il giro
   * completo (nuovo `state`, nuova `POST /auth`, nuova SCA in banca) **sulla
   * stessa riga**, così link e storico restano al loro posto.
   *
   * Al ritorno dal callback i conti vengono ri-mappati per IBAN
   * (`remapLinksByIban`): la banca assegna nuovi uid a ogni consenso.
   */
  async renewConnection(
    userId: string,
    id: string,
  ): Promise<{ connectionId: string; authUrl: string }> {
    const connection = await this.findOwnedConnection(userId, id);
    if (!RENEWABLE_STATUSES.includes(connection.status)) {
      throw new BadRequestException(
        connection.status === BankConnectionStatus.pending
          ? 'C’è già un’autorizzazione in corso per questo collegamento: completala in banca oppure eliminalo e ricrealo.'
          : 'Questo collegamento non può essere rinnovato: eliminalo e collega di nuovo la banca.',
      );
    }

    const redirectUrl = this.buildRedirectUrl();
    const { country, name } = parseInstitutionId(
      connection.institutionId,
      connection.institutionName,
    );

    // La durata massima del consenso è per-banca: si rilegge dalla lista
    // istituti (cache 24h). Se la banca non è più elencata si ripiega sul tetto
    // PSD2 invece di bloccare il rinnovo.
    let institution: ProviderInstitution | null = null;
    try {
      const items = await this.provider.listInstitutions(country);
      institution = items.find((i) => i.name.toLowerCase() === name.toLowerCase()) ?? null;
    } catch (e) {
      this.logger.warn(
        `Lista istituti non disponibile per il rinnovo di ${connection.id}: ${(e as Error).message}`,
      );
    }
    const validUntil = computeConsentValidUntil(institution?.maximumConsentValidity ?? null);

    // Vecchia sessione: chiusa best-effort. Molte banche IT ammettono un solo
    // consenso attivo per TPP, quindi lasciarla aperta non aiuta comunque.
    if (connection.providerConsentId) {
      try {
        await this.provider.revokeConsent(connection.providerConsentId);
      } catch (e) {
        this.logger.warn(
          `Chiusura della vecchia sessione di ${connection.id} fallita: ${(e as Error).message}`,
        );
      }
    }

    // Come nella creazione: lo state deve essere già in DB quando la banca
    // rimanda l'utente sul callback.
    const state = randomBytes(16).toString('hex');
    const previous = { status: connection.status, reference: connection.reference };
    await this.prisma.bankConnection.update({
      where: { id: connection.id },
      data: { reference: state, status: BankConnectionStatus.pending },
    });

    try {
      const result = await this.remote(() =>
        this.provider.startConsent({
          aspspName: institution?.name ?? name,
          aspspCountry: institution?.country ?? country,
          state,
          redirectUrl,
          validUntil,
        }),
      );
      void this.audit.log(userId, AuditAction.update, AuditEntity.bank_connection, connection.id, {
        institution: connection.institutionName,
        operation: 'renew',
      });
      return { connectionId: connection.id, authUrl: result.authUrl };
    } catch (e) {
      // Rinnovo mai partito: si torna allo stato di prima, altrimenti la
      // connessione resterebbe `pending` e non sarebbe più rinnovabile.
      await this.prisma.bankConnection
        .update({ where: { id: connection.id }, data: previous })
        .catch(() => undefined);
      throw e;
    }
  }

  async listConnections(userId: string): Promise<{ items: BankConnectionView[] }> {
    const rows = await this.prisma.bankConnection.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: CONNECTION_INCLUDE,
    });
    return { items: rows.map(toConnectionView) };
  }

  /**
   * Stato **locale** della connessione: è l'endpoint su cui la PWA fa polling
   * dopo il consenso, quindi non deve mai chiamare il provider (il callback
   * pubblico ha già aggiornato la riga).
   */
  async getConnection(userId: string, id: string): Promise<BankConnectionView> {
    return toConnectionView(await this.findOwnedConnection(userId, id));
  }

  async listConnectionAccounts(
    userId: string,
    id: string,
  ): Promise<{ items: ConnectionAccountView[] }> {
    const connection = await this.findOwnedConnection(userId, id);
    if (connection.status !== BankConnectionStatus.linked || !connection.providerConsentId) {
      throw new BadRequestException(
        'Il collegamento non è ancora autorizzato: completa l’autorizzazione presso la banca.',
      );
    }

    let refs = parseProviderAccounts(connection.providerAccounts);
    if (refs.length === 0) {
      refs = await this.remote(() =>
        this.provider.listConsentAccounts(connection.providerConsentId!),
      );
    }

    const linked = new Set(connection.links.map((l) => l.providerAccountId));
    const items: ConnectionAccountView[] = [];
    for (const ref of refs) {
      // I dettagli sono un "nice to have": se la banca non risponde per un
      // conto, mostriamo comunque la entry con quello che sappiamo già.
      // Se il consenso ci ha già dato tutto (IBAN, nome, valuta) NON si
      // richiama la banca: ogni chiamata pesa sui limiti PSD2 e alcune
      // banche espongono lo stesso conto in più valute (Fineco: 4 entry con
      // un solo IBAN), quindi aprire il wizard bruciava la quota del giorno.
      let detailed = ref;
      if (!isCompleteAccountRef(ref)) {
        try {
          detailed = await this.provider.getAccountDetails(ref.uid);
        } catch (e) {
          this.logger.warn(`Dettagli conto ${ref.uid} non disponibili: ${(e as Error).message}`);
        }
      }
      items.push({
        uid: ref.uid,
        iban: sanitizeExternalText(detailed.iban ?? ref.iban, 40),
        name: sanitizeExternalText(detailed.name ?? ref.name, 100),
        currency: detailed.currency ?? ref.currency,
        alreadyLinked: linked.has(ref.uid),
      });
    }
    return { items };
  }

  async deleteConnection(userId: string, id: string): Promise<void> {
    const connection = await this.findOwnedConnection(userId, id);

    if (connection.providerConsentId) {
      // Best-effort: se la revoca remota fallisce (consenso già scaduto, banca
      // giù) cancelliamo comunque in locale, altrimenti l'utente resta bloccato.
      try {
        await this.provider.revokeConsent(connection.providerConsentId);
      } catch (e) {
        this.logger.warn(
          `Revoca remota del consenso ${connection.id} fallita: ${(e as Error).message}`,
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await clearDanglingPairs(tx, { link: { connectionId: connection.id } });
      await tx.bankConnection.delete({ where: { id: connection.id } });
    });
    void this.audit.log(userId, AuditAction.delete, AuditEntity.bank_connection, connection.id, {
      institution: connection.institutionName,
    });
  }

  // -------------------------------------------------------------------- link

  async createLink(userId: string, dto: CreateLinkDto): Promise<{ link: BankLinkView }> {
    if ((dto.accountId && dto.newAccount) || (!dto.accountId && !dto.newAccount)) {
      throw new BadRequestException(
        'Indica un conto esistente (accountId) oppure i dati del nuovo conto (newAccount), non entrambi.',
      );
    }

    const connection = await this.findOwnedConnection(userId, dto.connectionId);
    if (connection.status !== BankConnectionStatus.linked || !connection.providerConsentId) {
      throw new BadRequestException(
        'Il collegamento non è ancora autorizzato: completa l’autorizzazione presso la banca.',
      );
    }

    // Il conto deve appartenere davvero al consenso: mai fidarsi dell'uid dal client.
    let refs = parseProviderAccounts(connection.providerAccounts);
    if (refs.length === 0) {
      refs = await this.remote(() =>
        this.provider.listConsentAccounts(connection.providerConsentId!),
      );
    }
    const ref = refs.find((r) => r.uid === dto.providerAccountId);
    if (!ref) {
      throw new NotFoundException('Conto bancario non presente in questo collegamento.');
    }

    if (connection.links.some((l) => l.providerAccountId === dto.providerAccountId)) {
      throw new ConflictException('Questo conto bancario è già collegato.');
    }

    // I dati del conto arrivano dal consenso (già in DB). La chiamata alla
    // banca serve solo ad arricchirli con l'intestatario ed è **best-effort**:
    // prima era bloccante e un 429 da banca — anche solo per la quota
    // giornaliera consumata dall'elenco conti — impediva di collegare un
    // conto di cui sapevamo già tutto.
    let details: ProviderAccountDetails = { ...ref, ownerName: null };
    try {
      const live = await this.provider.getAccountDetails(dto.providerAccountId);
      details = {
        ...live,
        iban: live.iban ?? ref.iban,
        name: live.name ?? ref.name,
        currency: live.currency ?? ref.currency,
      };
    } catch (e) {
      this.logger.warn(
        `Dettagli conto ${dto.providerAccountId} non disponibili, uso i dati del consenso: ${(e as Error).message}`,
      );
    }
    const bankCurrency = details.currency?.toUpperCase() ?? null;

    // Dati del link indipendenti dal conto di destinazione.
    const linkBase = {
      connectionId: connection.id,
      providerAccountId: dto.providerAccountId,
      iban: sanitizeExternalText(details.iban, 40),
      ownerName: sanitizeExternalText(details.ownerName, 140),
    };

    try {
      let accountName: string;
      let link: BankAccountLink;

      if (dto.accountId) {
        await this.policy.assertWrite(userId, dto.accountId);
        const account = await this.prisma.account.findUnique({
          where: { id: dto.accountId },
          select: {
            id: true,
            name: true,
            type: true,
            currency: true,
            archivedAt: true,
            bankLink: { select: { id: true } },
          },
        });
        if (!account) throw new NotFoundException('Conto non trovato.');
        if (account.archivedAt) {
          throw new BadRequestException(
            'Il conto è archiviato: non può essere collegato a una banca.',
          );
        }
        if (account.type !== AccountType.checking) {
          throw new BadRequestException(
            'Solo i conti correnti possono essere collegati a una banca (carte di credito e contanti non sono supportati).',
          );
        }
        if (account.bankLink) {
          throw new ConflictException('Questo conto è già collegato a un conto bancario.');
        }
        if (bankCurrency && bankCurrency !== account.currency.toUpperCase()) {
          throw new BadRequestException(
            `La valuta del conto bancario (${bankCurrency}) non coincide con quella del conto "${account.name}" (${account.currency}).`,
          );
        }
        accountName = account.name;
        link = await this.prisma.bankAccountLink.create({
          data: { ...linkBase, accountId: account.id, currency: account.currency },
        });
      } else {
        if (bankCurrency && bankCurrency !== 'EUR') {
          throw new BadRequestException(
            `Il conto bancario è in ${bankCurrency}: la creazione automatica del conto supporta solo l’euro.`,
          );
        }
        accountName = dto.newAccount!.name.trim();
        // Conto nuovo + link nella stessa transazione: un fallimento a metà
        // lascerebbe un conto orfano mai richiesto dall'utente.
        link = await this.prisma.$transaction(async (tx) => {
          const account = await tx.account.create({
            data: {
              name: accountName,
              type: AccountType.checking,
              currency: 'EUR',
              ownerId: userId,
              balanceCents: BigInt(0),
            },
            select: { id: true },
          });
          return tx.bankAccountLink.create({
            data: { ...linkBase, accountId: account.id, currency: 'EUR' },
          });
        });
      }

      void this.audit.log(userId, AuditAction.create, AuditEntity.bank_account_link, link.id, {
        connectionId: connection.id,
        accountId: link.accountId,
      });

      // Primo scaricamento subito, in background: l'utente ha appena collegato
      // il conto e si aspetta di trovarci qualcosa senza aspettare il cron.
      // Non consuma la quota manuale (trigger `auto`) e non può far fallire la
      // creazione del link.
      void this.syncEngine
        .syncLink(link.id, userId, BankSyncTrigger.auto)
        .catch((e) =>
          this.logger.warn(
            `Sync automatico del collegamento ${link.id} fallito: ${(e as Error).message}`,
          ),
        );

      return { link: toLinkView(link, accountName) };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Conto già collegato: aggiorna la pagina e riprova.');
      }
      throw e;
    }
  }

  async updateLink(
    userId: string,
    id: string,
    syncEnabled: boolean,
  ): Promise<{ link: BankLinkView }> {
    const link = await this.findWritableLink(userId, id);
    const updated = await this.prisma.bankAccountLink.update({
      where: { id: link.id },
      data: { syncEnabled },
      include: { account: { select: { name: true } } },
    });
    return { link: toLinkView(updated, updated.account.name) };
  }

  async deleteLink(userId: string, id: string): Promise<void> {
    const link = await this.findWritableLink(userId, id);
    await this.prisma.$transaction(async (tx) => {
      await clearDanglingPairs(tx, { linkId: link.id });
      await tx.bankAccountLink.delete({ where: { id: link.id } });
    });
    void this.audit.log(userId, AuditAction.delete, AuditEntity.bank_account_link, link.id, {
      connectionId: link.connectionId,
      accountId: link.accountId,
    });
  }

  // ---------------------------------------------------------------- callback

  /**
   * Callback pubblica: la banca rimanda l'utente sul frontend (su iPhone in
   * Safari, quindi NON autenticato) che ci gira `code` + `state`.
   *
   * Lo `state` è monouso: solo una connessione ancora `pending` e con lo state
   * emesso da meno di 15 minuti può consumarlo (`updatedAt` = creazione o
   * rinnovo). Il `code` ha vita brevissima, per questo lo scambio avviene qui e
   * non al rientro nella PWA.
   *
   * Se la connessione aveva già dei conti collegati siamo in un **rinnovo**: gli
   * uid cambiano a ogni consenso, quindi i link vengono ri-mappati per IBAN.
   */
  async handleCallback(code: string, state: string): Promise<{ ok: true }> {
    const connection = await this.prisma.bankConnection.findUnique({
      where: { reference: state },
      include: { links: { select: { id: true, providerAccountId: true, iban: true } } },
    });
    if (!connection) {
      throw new NotFoundException('Autorizzazione non riconosciuta: riavvia il collegamento dall’app.');
    }
    if (connection.status !== BankConnectionStatus.pending) {
      throw new GoneException('Questa autorizzazione è già stata utilizzata.');
    }
    if (Date.now() - connection.updatedAt.getTime() > STATE_TTL_MS) {
      throw new GoneException('Autorizzazione scaduta: riavvia il collegamento dall’app.');
    }

    let session: ConsentSession;
    try {
      session = await this.provider.exchangeCallback(code);
    } catch (e) {
      // Si resta `pending`: il codice è monouso ma l'utente può ripartire dal
      // link di autorizzazione finché lo state è valido.
      this.logger.warn(
        `Scambio del code fallito per la connessione ${connection.id}: ${(e as Error).message}`,
      );
      throw new BadRequestException(
        e instanceof BankProviderError
          ? e.message
          : 'Scambio dell’autorizzazione con la banca fallito: riprova.',
      );
    }

    try {
      // Transizione atomica: due callback concorrenti, uno solo vince.
      const res = await this.prisma.bankConnection.updateMany({
        where: { id: connection.id, status: BankConnectionStatus.pending },
        data: {
          status: BankConnectionStatus.linked,
          providerConsentId: session.consentId,
          providerAccounts: (session.rawAccounts ?? []) as Prisma.InputJsonValue,
          consentExpiresAt: session.validUntil,
        },
      });
      if (res.count === 0) {
        throw new GoneException('Questa autorizzazione è già stata utilizzata.');
      }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Questa sessione bancaria è già associata a un altro collegamento.');
      }
      throw e;
    }

    if (connection.links.length > 0) {
      // Rinnovo: la ri-mappatura è un "di più" rispetto al consenso, che a
      // questo punto è già valido. Qualunque intoppo lascia i link com'erano e
      // non deve trasformare in errore una autorizzazione andata a buon fine.
      await this.remapLinksByIban(connection.id, connection.links, session).catch((e) =>
        this.logger.error(
          `Ri-mappatura dei conti della connessione ${connection.id} fallita: ${(e as Error).message}`,
        ),
      );
    }

    return { ok: true };
  }

  /**
   * Ri-mappatura dei conti dopo un rinnovo: a ogni nuovo consenso la banca
   * assegna uid diversi agli stessi conti, quindi l'unico aggancio stabile è
   * l'**IBAN** (confrontato compattato e in maiuscolo).
   *
   * Un link che non ritrova il suo IBAN viene messo in pausa
   * (`syncEnabled = false`) invece che agganciato a caso: l'utente lo ricollega
   * a mano dal wizard. Vale anche per i conti di cui non siamo riusciti a
   * leggere i dettagli.
   */
  private async remapLinksByIban(
    connectionId: string,
    links: { id: string; providerAccountId: string; iban: string | null }[],
    session: ConsentSession,
  ): Promise<void> {
    // IBAN compattato → uid del nuovo consenso.
    const uidByIban = new Map<string, string>();
    for (const ref of session.accounts) {
      let iban = ref.iban;
      if (!iban) {
        // I dettagli costano una chiamata alla banca: si chiedono solo se
        // l'IBAN non è già arrivato con la sessione. Best-effort: un conto
        // senza IBAN semplicemente non parteciperà al match.
        try {
          iban = (await this.provider.getAccountDetails(ref.uid)).iban;
        } catch (e) {
          this.logger.warn(
            `Dettagli del conto ${ref.uid} non disponibili durante la ri-mappatura: ${(e as Error).message}`,
          );
        }
      }
      const key = compactIban(iban);
      if (key && !uidByIban.has(key)) uidByIban.set(key, ref.uid);
    }
    if (uidByIban.size === 0) {
      // Tutti i link finiranno in pausa: va segnalato, perché di solito
      // significa che la banca non ci ha dato IBAN utilizzabili.
      this.logger.warn(
        `Nessun IBAN utilizzabile nei conti del nuovo consenso ${connectionId}: i collegamenti andranno rifatti a mano.`,
      );
    }

    const remap: { id: string; uid: string }[] = [];
    const disable: string[] = [];
    const taken = new Set<string>();
    let unchanged = 0;

    for (const link of links) {
      const key = compactIban(link.iban);
      const uid = key ? uidByIban.get(key) : undefined;
      // Un uid non può finire su due link (`@@unique`): il primo che lo prende
      // se lo tiene, gli altri restano da ricollegare a mano.
      if (!uid || taken.has(uid)) {
        disable.push(link.id);
        continue;
      }
      taken.add(uid);
      if (uid === link.providerAccountId) {
        unchanged++;
        continue;
      }
      remap.push({ id: link.id, uid });
    }

    if (remap.length > 0 || disable.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        // Due passate: se due conti si scambiano l'uid, assegnare direttamente
        // quelli definitivi violerebbe `@@unique([connectionId, providerAccountId])`.
        for (const r of remap) {
          await tx.bankAccountLink.update({
            where: { id: r.id },
            data: { providerAccountId: `${REMAP_TMP_PREFIX}${r.id}` },
          });
        }
        for (const r of remap) {
          await tx.bankAccountLink.update({
            where: { id: r.id },
            data: { providerAccountId: r.uid },
          });
        }
        if (disable.length > 0) {
          await tx.bankAccountLink.updateMany({
            where: { id: { in: disable } },
            data: { syncEnabled: false },
          });
        }
      });
    }

    this.logger.log(
      `Ri-mappatura conti della connessione ${connectionId}: ${remap.length} aggiornati, ${unchanged} invariati, ${disable.length} da ricollegare`,
    );
  }

  // ----------------------------------------------------------------- privati

  private async findOwnedConnection(userId: string, id: string): Promise<ConnectionWithLinks> {
    const connection = await this.prisma.bankConnection.findFirst({
      where: { id, userId },
      include: CONNECTION_INCLUDE,
    });
    if (!connection) throw new NotFoundException('Collegamento bancario non trovato.');
    return connection;
  }

  private async findWritableLink(userId: string, id: string) {
    const link = await this.prisma.bankAccountLink.findUnique({ where: { id } });
    if (!link) throw new NotFoundException('Conto collegato non trovato.');
    // Chi può scrivere sul conto può gestirne il collegamento (stessa regola
    // delle transazioni), anche se la connessione è di un altro utente.
    await this.policy.assertWrite(userId, link.accountId);
    return link;
  }

  private buildRedirectUrl(): string {
    const base = (this.config.get<string>('APP_PUBLIC_URL') ?? '').trim().replace(/\/+$/, '');
    if (!base) {
      throw new ServiceUnavailableException(
        'APP_PUBLIC_URL non è configurata sul server: senza URL pubblico la banca non può riportarti all’app dopo l’autorizzazione.',
      );
    }
    return `${base}${CALLBACK_PATH}`;
  }

  /** Esegue una chiamata al provider traducendo gli errori in risposte HTTP sensate. */
  private async remote<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof BankProviderError) {
        switch (e.kind) {
          case 'auth':
            throw new ServiceUnavailableException(e.message);
          case 'rejected':
            throw new BadRequestException(e.message);
          case 'not_found':
            throw new NotFoundException(e.message);
          case 'rate_limit':
            throw new HttpException(e.message, 429);
          default:
            throw new BadGatewayException(e.message);
        }
      }
      throw e;
    }
  }
}

/**
 * Azzera i puntatori di giroconto che restano appesi alle righe staged in
 * procinto di sparire.
 *
 * `matchedStagedId` è una colonna semplice (nessuna FK, quindi nessun cascade):
 * cancellando un collegamento, le righe **degli altri conti** che puntavano
 * alle sue resterebbero agganciate a una gamba inesistente — non confermabili
 * ("l'altra gamba non esiste più") e nemmeno separabili dalla UI, che offre
 * "Spaia" solo quando la controparte è ancora leggibile. L'accoppiamento è
 * reciproco, quindi basta partire dalle righe condannate che ne hanno uno.
 */
async function clearDanglingPairs(
  tx: Prisma.TransactionClient,
  doomed: Prisma.BankStagedTransactionWhereInput,
): Promise<void> {
  const paired = await tx.bankStagedTransaction.findMany({
    where: { ...doomed, matchedStagedId: { not: null } },
    select: { id: true },
  });
  if (paired.length === 0) return;
  await tx.bankStagedTransaction.updateMany({
    where: { matchedStagedId: { in: paired.map((r) => r.id) } },
    data: { matchedStagedId: null, suggestedType: null },
  });
}

function toConnectionView(row: ConnectionWithLinks): BankConnectionView {
  return {
    id: row.id,
    institutionName: row.institutionName,
    institutionLogo: row.institutionLogo,
    status: row.status,
    consentExpiresAt: row.consentExpiresAt,
    createdAt: row.createdAt,
    links: row.links.map((l) => toLinkView(l, l.account.name)),
  };
}

/** Unico punto di costruzione della vista di un conto collegato. */
function toLinkView(link: BankAccountLink, accountName: string): BankLinkView {
  return {
    id: link.id,
    accountId: link.accountId,
    accountName,
    providerAccountId: link.providerAccountId,
    iban: link.iban,
    currency: link.currency,
    syncEnabled: link.syncEnabled,
    lastSyncAt: link.lastSyncAt,
    lastBalanceCents: link.lastBalanceCents,
    lastBalanceAt: link.lastBalanceAt,
  };
}

/**
 * `institutionId` è la coppia `"<paese>:<nome>"` con cui Enable Banking
 * identifica la banca. Il nome può contenere due punti, quindi si divide solo
 * sul primo. Righe legacy senza prefisso: si assume l'Italia, unico mercato
 * dell'app.
 */
function parseInstitutionId(
  institutionId: string,
  fallbackName: string,
): { country: string; name: string } {
  const separator = institutionId.indexOf(':');
  if (separator > 0) {
    return {
      country: institutionId.slice(0, separator).toUpperCase(),
      name: institutionId.slice(separator + 1),
    };
  }
  return { country: 'IT', name: institutionId.trim() || fallbackName };
}

/** IBAN in forma confrontabile: maiuscolo, senza spazi né separatori. */
function compactIban(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return compact || null;
}

/** Rilegge `BankConnection.providerAccounts` (payload grezzo del provider). */
/**
 * Il riferimento salvato al momento del consenso basta a sé stesso: non
 * serve richiamare la banca per ottenere dati che abbiamo già (ogni chiamata
 * consuma i limiti di accesso PSD2 dell'ASPSP).
 */
function isCompleteAccountRef(ref: ProviderAccountRef): boolean {
  return Boolean(ref.iban && ref.name && ref.currency);
}

function parseProviderAccounts(value: Prisma.JsonValue | null): ProviderAccountRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeAccountEntry(entry))
    .filter((a): a is ProviderAccountRef => a !== null);
}

/**
 * Orari di sync in forma canonica: solo `HH:mm` sulla griglia dei quarti d'ora,
 * senza duplicati e in ordine crescente. Il filtro sul formato serve anche in
 * lettura, per non restituire valori scritti prima di questa validazione.
 */
function normalizeSyncTimes(times: string[]): string[] {
  const valid = times.map((t) => t.trim()).filter((t) => SYNC_TIME_PATTERN.test(t));
  return [...new Set(valid)].sort();
}

/** Il logo finisce in un `<img src>`: accettiamo solo https. */
function httpsUrlOrNull(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}
