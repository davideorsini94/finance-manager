import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateSmtpDto {
  @IsString()
  @MaxLength(255)
  host!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @Type(() => Boolean)
  @IsBoolean()
  secure!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  username?: string | null;

  /**
   * - stringa non vuota: nuova password (verrà cifrata)
   * - null: rimuovi password salvata (mette a NULL)
   * - undefined / non presente: lascia invariata
   */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  password?: string | null;

  @IsEmail()
  fromEmail!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  fromName?: string | null;
}

export class TestSmtpDto {
  @IsEmail()
  to!: string;
}
