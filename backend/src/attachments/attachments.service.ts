import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AccountPolicyService } from '../common/services/account-policy.service';
import { MinioService } from '../minio/minio.service';

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    private readonly policy: AccountPolicyService,
  ) {}

  async upload(
    userId: string,
    transactionId: string,
    file: { buffer: Buffer; originalname: string; size: number; mimetype: string },
  ) {
    if (file.size > MAX_SIZE_BYTES) {
      throw new PayloadTooLargeException(`File exceeds ${MAX_SIZE_BYTES} bytes`);
    }
    const tx = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!tx) throw new NotFoundException('Transaction not found');
    await this.policy.assertWrite(userId, tx.accountId);

    // Sniff reale del MIME (lato server, non si fida del header del browser).
    // file-type è ESM-only: usiamo il trucco `new Function` per evitare che
    // TS (module=commonjs) downcompili l'import dinamico in require().
    const detected = await loadFileType().then((m) => m.fileTypeFromBuffer(file.buffer));
    const mime = detected?.mime ?? file.mimetype;
    if (!ALLOWED_MIME.has(mime)) {
      throw new BadRequestException(`MIME type not allowed: ${mime}`);
    }

    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-200);
    const minioKey = `${userId}/${transactionId}/${randomUUID()}_${safeName}`;
    await this.minio.putObject(minioKey, file.buffer, mime);

    return this.prisma.attachment.create({
      data: {
        transactionId,
        userId,
        minioKey,
        filename: safeName,
        mimeType: mime,
        sizeBytes: file.size,
      },
    });
  }

  async listForTransaction(userId: string, transactionId: string) {
    const tx = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!tx) throw new NotFoundException('Transaction not found');
    await this.policy.assertRead(userId, tx.accountId);
    return this.prisma.attachment.findMany({
      where: { transactionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getPresigned(userId: string, attachmentId: string) {
    const att = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      include: { transaction: { select: { accountId: true } } },
    });
    if (!att) throw new NotFoundException('Attachment not found');
    await this.policy.assertRead(userId, att.transaction.accountId);
    const url = await this.minio.getPresignedDownloadUrl(att.minioKey);
    return {
      url,
      filename: att.filename,
      mimeType: att.mimeType,
      sizeBytes: att.sizeBytes,
    };
  }

  /**
   * Stream del binario via il backend. Necessario per l'anteprima nel
   * browser perché le URL presigned di MinIO puntano a `http://minio:9000`
   * (hostname della rete docker, non risolvibile dal client). Verifica
   * accesso e ritorna stream + meta per impostare gli header.
   */
  async openStream(userId: string, attachmentId: string) {
    const att = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      include: { transaction: { select: { accountId: true } } },
    });
    if (!att) throw new NotFoundException('Attachment not found');
    await this.policy.assertRead(userId, att.transaction.accountId);
    const stream = await this.minio.getObjectStream(att.minioKey);
    return {
      stream,
      filename: att.filename,
      mimeType: att.mimeType,
      sizeBytes: att.sizeBytes,
    };
  }

  async remove(userId: string, attachmentId: string) {
    const att = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      include: { transaction: { select: { accountId: true } } },
    });
    if (!att) throw new NotFoundException('Attachment not found');
    await this.policy.assertWrite(userId, att.transaction.accountId);

    await this.prisma.attachment.delete({ where: { id: attachmentId } });
    try {
      await this.minio.removeObject(att.minioKey);
    } catch {
      // Best-effort: se MinIO è giù, l'oggetto resta orfano. Tollerabile.
    }
  }
}

type FileTypeModule = { fileTypeFromBuffer: (buf: Buffer) => Promise<{ mime: string } | undefined> };
const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<unknown>;
const loadFileType = (): Promise<FileTypeModule> =>
  dynamicImport('file-type') as Promise<FileTypeModule>;
