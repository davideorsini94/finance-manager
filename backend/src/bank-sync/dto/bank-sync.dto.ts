import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Credenziali dell'applicazione Enable Banking (admin). */
export class UpdateBankSyncCredentialsDto {
  @IsString()
  @MinLength(4)
  @MaxLength(200)
  appId!: string;

  /** Chiave privata RS256 in formato PEM. Cifrata at-rest, mai restituita. */
  @IsString()
  @MinLength(64)
  @MaxLength(16_384)
  privateKeyPem!: string;
}

export class ListInstitutionsQueryDto {
  /** ISO 3166-1 alpha-2 (default IT), oppure ALL per tutte le banche visibili all'app (utile con app sandbox). */
  @IsOptional()
  @IsString()
  @Matches(/^([A-Za-z]{2}|ALL)$/i, {
    message: 'Il paese deve essere un codice ISO di 2 lettere (o ALL per tutte).',
  })
  country?: string;
}

export class CreateConnectionDto {
  /** Nome dell'istituto come restituito da `GET bank-sync/institutions`. */
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  aspspName!: string;

  @IsString()
  @Matches(/^[A-Za-z]{2}$/, { message: 'Il paese deve essere un codice ISO di 2 lettere.' })
  aspspCountry!: string;

  /**
   * Logo suggerito dal client: usato solo come fallback e solo se https —
   * il valore autorevole viene dalla lista istituti lato server.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  institutionLogo?: string;
}

export class NewLinkedAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}

export class CreateLinkDto {
  @IsUUID()
  connectionId!: string;

  /** uid del conto lato provider (dalla lista conti della connessione). */
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  providerAccountId!: string;

  /** Conto esistente da collegare. Alternativo a `newAccount`. */
  @IsOptional()
  @IsUUID()
  accountId?: string;

  /** Nuovo conto da creare e collegare. Alternativo a `accountId`. */
  @IsOptional()
  @ValidateNested()
  @Type(() => NewLinkedAccountDto)
  newAccount?: NewLinkedAccountDto;
}

export class UpdateLinkDto {
  @IsBoolean()
  syncEnabled!: boolean;
}

/** Payload della pagina pubblica di callback. */
export class BankSyncCallbackDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  code!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  state!: string;
}
