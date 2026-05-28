import { RecurrenceFreq, TransactionType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateRecurringDto {
  @IsUUID()
  accountId!: string;

  /** Richiesto solo per type=transfer (conto destinazione del giroconto). */
  @ValidateIf((o: CreateRecurringDto) => o.type === TransactionType.transfer)
  @IsUUID()
  toAccountId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountCents!: number;

  @IsEnum(TransactionType)
  type!: TransactionType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsEnum(RecurrenceFreq)
  frequency!: RecurrenceFreq;

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class UpdateRecurringDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  amountCents?: number;

  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsUUID()
  toAccountId?: string | null;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsEnum(RecurrenceFreq)
  frequency?: RecurrenceFreq;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
