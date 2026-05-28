import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client as MinioClient } from 'minio';
import { Readable } from 'stream';

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private readonly client: MinioClient;
  readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.getOrThrow<string>('MINIO_BUCKET');
    this.client = new MinioClient({
      endPoint: this.config.getOrThrow<string>('MINIO_ENDPOINT'),
      port: parseInt(this.config.getOrThrow<string>('MINIO_PORT'), 10),
      useSSL: this.config.get<string>('MINIO_USE_SSL') === 'true',
      accessKey: this.config.getOrThrow<string>('MINIO_ACCESS_KEY'),
      secretKey: this.config.getOrThrow<string>('MINIO_SECRET_KEY'),
    });
  }

  async onModuleInit() {
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket);
        this.logger.log(`Created bucket: ${this.bucket}`);
      }
    } catch (e) {
      this.logger.error(`MinIO bootstrap failed: ${(e as Error).message}`);
    }
  }

  async putObject(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    await this.client.putObject(this.bucket, key, buffer, buffer.length, {
      'Content-Type': mimeType,
    });
  }

  async getPresignedDownloadUrl(key: string, ttlSec = 15 * 60): Promise<string> {
    return this.client.presignedGetObject(this.bucket, key, ttlSec);
  }

  async removeObject(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key);
  }

  async getObjectStream(key: string): Promise<Readable> {
    return this.client.getObject(this.bucket, key);
  }
}
