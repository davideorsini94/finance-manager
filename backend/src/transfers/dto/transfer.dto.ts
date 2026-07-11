import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateTransferDto {
  @IsUUID()
  fromAccountId!: string;

  @IsUUID()
  toAccountId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountCents!: number;

  @IsDateString()
  date!: string;

  /** Data esecuzione lato destinatario (può essere futura). Default = date. */
  @IsOptional()
  @IsDateString()
  arrivalDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** Categoria opzionale: applicata a ENTRAMBE le transazioni (out + in). */
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

export class UpdateTransferDto {
  /** Nuovo conto sorgente. Se cambia, il movimento viene spostato sul nuovo conto. */
  @IsOptional()
  @IsUUID()
  fromAccountId?: string;

  /** Nuovo conto destinazione. Se cambia, il movimento viene spostato sul nuovo conto. */
  @IsOptional()
  @IsUUID()
  toAccountId?: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  amountCents?: number;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsDateString()
  arrivalDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** Per sganciare la categoria mandare null. */
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;
}
