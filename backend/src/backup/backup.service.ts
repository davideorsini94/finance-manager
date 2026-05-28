import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import archiver from 'archiver';
import * as yauzl from 'yauzl';
import { Readable, PassThrough } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';

const BACKUP_VERSION = 1;

const TABLES = [
  'user',
  'inviteToken',
  'account',
  'accountMember',
  'category',
  'transaction',
  'attachment',
  'recurringRule',
  'budget',
  'goal',
  'importBatch',
  'chatSession',
  'chatMessage',
  'auditLog',
] as const;

type TableName = (typeof TABLES)[number];

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Crea uno stream zip contenente:
   * - manifest.json (versione, timestamp)
   * - data/<table>.json per ogni tabella (BigInt serializzati come stringhe)
   * - blobs/<minioKey> per ogni allegato presente in MinIO
   *
   * Il chiamante (controller) può fare `pipe(archive, res)` direttamente.
   */
  async exportToStream(): Promise<NodeJS.ReadableStream> {
    const archive = archiver('zip', { zlib: { level: 6 } });
    const passthrough = new PassThrough();
    archive.pipe(passthrough);

    archive.on('warning', (err: Error) => this.logger.warn(`archiver warning: ${err.message}`));
    archive.on('error', (err: Error) => {
      this.logger.error(`archiver error: ${err.message}`);
      passthrough.destroy(err);
    });

    const manifest = {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      tables: TABLES,
    };
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

    // Serializza ogni tabella in JSON
    for (const table of TABLES) {
      const rows = await (this.prisma as unknown as Record<string, { findMany: () => Promise<unknown[]> }>)[
        table
      ].findMany();
      const json = JSON.stringify(rows, bigIntReplacer, 2);
      archive.append(json, { name: `data/${table}.json` });
    }

    // Esporta tutti i blob degli allegati da MinIO
    const attachments = await this.prisma.attachment.findMany({
      select: { minioKey: true },
    });
    for (const att of attachments) {
      try {
        const stream = await this.minio.getObjectStream(att.minioKey);
        archive.append(stream, { name: `blobs/${att.minioKey}` });
      } catch (e) {
        this.logger.warn(`Skipping missing blob ${att.minioKey}: ${(e as Error).message}`);
      }
    }

    void archive.finalize();
    return passthrough;
  }

  /**
   * DESTRUCTIVE: cancella tutti i dati esistenti (utenti, conti, ecc) e ripristina
   * dal backup. Riservato all'admin che ha esplicitamente confermato.
   */
  async restoreFromZip(zipBuffer: Buffer): Promise<{ restored: Record<string, number>; blobs: number }> {
    const entries = await readZipEntries(zipBuffer);

    const manifestEntry = entries.get('manifest.json');
    if (!manifestEntry) throw new BadRequestException('Backup invalid: manifest.json missing');
    const manifest = JSON.parse(manifestEntry.toString('utf-8'));
    if (manifest.version !== BACKUP_VERSION) {
      throw new BadRequestException(`Backup version mismatch: expected ${BACKUP_VERSION}, got ${manifest.version}`);
    }

    // Carica i dati delle tabelle
    const tableData: Record<TableName, unknown[]> = {} as Record<TableName, unknown[]>;
    for (const table of TABLES) {
      const entry = entries.get(`data/${table}.json`);
      tableData[table] = entry ? (JSON.parse(entry.toString('utf-8')) as unknown[]) : [];
    }

    // WIPE in ordine inverso alle FK
    await this.wipeAllData();

    // INSERT in ordine corretto
    const restored: Record<string, number> = {};
    for (const table of TABLES) {
      const rows = tableData[table];
      if (rows.length === 0) {
        restored[table] = 0;
        continue;
      }
      const records = rows.map((r) => deserializeRow(r as Record<string, unknown>, table));
      // createMany non supporta tipi nidificati ma per le nostre tabelle piatte va bene
      const client = (this.prisma as unknown as Record<string, { createMany: (args: { data: unknown[]; skipDuplicates?: boolean }) => Promise<{ count: number }> }>)[
        table
      ];
      const result = await client.createMany({ data: records, skipDuplicates: true });
      restored[table] = result.count;
    }

    // Ripristina blob su MinIO
    let blobs = 0;
    for (const [name, buf] of entries.entries()) {
      if (!name.startsWith('blobs/')) continue;
      const key = name.slice('blobs/'.length);
      const att = await this.prisma.attachment.findFirst({
        where: { minioKey: key },
        select: { mimeType: true },
      });
      const mimeType = att?.mimeType ?? 'application/octet-stream';
      await this.minio.putObject(key, buf, mimeType);
      blobs++;
    }

    return { restored, blobs };
  }

  private async wipeAllData(): Promise<void> {
    // Ordine: figli prima dei padri (rispetto FK con onDelete: Cascade ovunque,
    // ma per sicurezza wipe esplicito).
    await this.prisma.$transaction([
      this.prisma.attachment.deleteMany({}),
      this.prisma.chatMessage.deleteMany({}),
      this.prisma.chatSession.deleteMany({}),
      this.prisma.auditLog.deleteMany({}),
      this.prisma.importBatch.deleteMany({}),
      this.prisma.budget.deleteMany({}),
      this.prisma.goal.deleteMany({}),
      this.prisma.recurringRule.deleteMany({}),
      this.prisma.transaction.deleteMany({}),
      this.prisma.category.deleteMany({}),
      this.prisma.accountMember.deleteMany({}),
      this.prisma.account.deleteMany({}),
      this.prisma.refreshToken.deleteMany({}),
      this.prisma.inviteToken.deleteMany({}),
      this.prisma.user.deleteMany({}),
    ]);
  }
}

function bigIntReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  return value;
}

/**
 * Converte una riga JSON (con BigInt come stringhe e date come ISO) nel formato
 * che Prisma accetta. Le colonne BigInt richiedono BigInt(...), le date Date(...).
 */
function deserializeRow(row: Record<string, unknown>, table: TableName): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) {
      out[k] = v;
    } else if (typeof v === 'string' && BIGINT_FIELDS[table]?.has(k)) {
      out[k] = BigInt(v);
    } else if (typeof v === 'string' && DATE_FIELDS[table]?.has(k)) {
      out[k] = new Date(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

const BIGINT_FIELDS: Partial<Record<TableName, Set<string>>> = {
  account: new Set(['balanceCents']),
  transaction: new Set(['amountCents']),
  attachment: new Set([]),
  recurringRule: new Set(['amountCents']),
  budget: new Set(['limitCents']),
  goal: new Set(['targetCents', 'currentCents']),
};

const DATE_FIELDS: Partial<Record<TableName, Set<string>>> = {
  user: new Set(['createdAt', 'updatedAt']),
  inviteToken: new Set(['expiresAt', 'usedAt', 'createdAt']),
  account: new Set(['archivedAt', 'createdAt', 'updatedAt']),
  accountMember: new Set(['createdAt']),
  category: new Set(['createdAt']),
  transaction: new Set(['transactionDate', 'createdAt', 'updatedAt']),
  attachment: new Set(['createdAt']),
  recurringRule: new Set(['startDate', 'endDate', 'nextRunDate', 'createdAt']),
  budget: new Set(['month', 'createdAt']),
  goal: new Set(['deadline', 'createdAt']),
  importBatch: new Set(['createdAt']),
  chatSession: new Set(['createdAt', 'updatedAt']),
  chatMessage: new Set(['createdAt']),
  auditLog: new Set(['createdAt']),
};

function readZipEntries(buffer: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('Invalid zip'));
      const entries = new Map<string, Buffer>();
      zip.on('entry', (entry) => {
        if (entry.fileName.endsWith('/')) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) {
            zip.close();
            return reject(e ?? new Error('Cannot read entry'));
          }
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
          stream.on('error', reject);
        });
      });
      zip.on('end', () => resolve(entries));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

// Silenzia eslint su Readable se non usato
void Readable;
