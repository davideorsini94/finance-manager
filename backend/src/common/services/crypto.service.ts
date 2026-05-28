import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const SALT = Buffer.from('fm-smtp-v1', 'utf-8'); // salt fisso: il segreto è la chiave JWT
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const KEY_LEN = 32;

/**
 * Cifratura simmetrica per dati sensibili memorizzati in DB
 * (es. password SMTP). La chiave è derivata via scrypt dal JWT_ACCESS_SECRET,
 * quindi un attaccante con accesso al solo DB non può decifrare i payload.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const secret = config.getOrThrow<string>('JWT_ACCESS_SECRET');
    this.key = scryptSync(secret, SALT, KEY_LEN);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Formato: base64(iv) . base64(tag) . base64(ciphertext)
    return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
  }

  decrypt(payload: string): string {
    const [ivB64, tagB64, dataB64] = payload.split('.');
    if (!ivB64 || !tagB64 || !dataB64) throw new Error('Invalid encrypted payload');
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const decipher = createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return dec.toString('utf-8');
  }
}
