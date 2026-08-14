import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const KEY_LEN = 32;

/**
 * Contesto di default: il salt storico usato per la password SMTP.
 * NON va cambiato, altrimenti i payload già in DB diventano indecifrabili.
 */
export const SMTP_CRYPTO_CONTEXT = 'fm-smtp-v1';

/** Contesto delle credenziali Enable Banking (chiave privata RS256). */
export const BANK_SYNC_CRYPTO_CONTEXT = 'fm-banksync-v1';

/**
 * Cifratura simmetrica per dati sensibili memorizzati in DB
 * (password SMTP, chiave privata del sync bancario). La chiave è derivata via
 * scrypt dal JWT_ACCESS_SECRET, quindi un attaccante con accesso al solo DB non
 * può decifrare i payload.
 *
 * Ogni tipo di segreto usa un **contesto** diverso come salt: chiavi di
 * derivazione separate, così un payload cifrato per un contesto non è
 * decifrabile in un altro (e un bug di scambio contesto fallisce in modo
 * rumoroso invece che silenzioso). Il default resta `fm-smtp-v1` per
 * retrocompatibilità con i dati SMTP già cifrati.
 *
 * NB: ruotare JWT_ACCESS_SECRET invalida tutti i segreti cifrati → vanno
 * reinseriti dalle impostazioni.
 */
@Injectable()
export class CryptoService {
  private readonly secret: string;
  /** Cache delle chiavi derivate per contesto: scrypt è volutamente costoso. */
  private readonly keys = new Map<string, Buffer>();

  constructor(config: ConfigService) {
    this.secret = config.getOrThrow<string>('JWT_ACCESS_SECRET');
  }

  encrypt(plaintext: string, context: string = SMTP_CRYPTO_CONTEXT): string {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, this.keyFor(context), iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Formato: base64(iv) . base64(tag) . base64(ciphertext)
    return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
  }

  decrypt(payload: string, context: string = SMTP_CRYPTO_CONTEXT): string {
    const [ivB64, tagB64, dataB64] = payload.split('.');
    if (!ivB64 || !tagB64 || !dataB64) throw new Error('Invalid encrypted payload');
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const decipher = createDecipheriv(ALGO, this.keyFor(context), iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return dec.toString('utf-8');
  }

  private keyFor(context: string): Buffer {
    const cached = this.keys.get(context);
    if (cached) return cached;
    const key = scryptSync(this.secret, Buffer.from(context, 'utf-8'), KEY_LEN);
    this.keys.set(context, key);
    return key;
  }
}
