import { AccountMemberRole, AccountType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsHexColor,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateAccountDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsEnum(AccountType)
  type!: AccountType;

  @IsOptional()
  @IsHexColor()
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  icon?: string;

  /** Saldo iniziale in centesimi (default 0) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  initialBalanceCents?: number;

  // Solo per credit_card
  @ValidateIf((o: CreateAccountDto) => o.type === AccountType.credit_card)
  @IsUUID()
  paymentAccountId?: string;

  @ValidateIf((o: CreateAccountDto) => o.type === AccountType.credit_card)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(28)
  billingDay?: number;
}

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsHexColor()
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  icon?: string;

  @IsOptional()
  @IsUUID()
  paymentAccountId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(28)
  billingDay?: number;

  /**
   * Saldo "manuale" (in centesimi) per correggere il saldo iniziale del conto.
   * NB: sovrascrive direttamente `balanceCents` — non crea una transazione di
   * rettifica. È pensato per correggere errori nel saldo iniziale impostato
   * alla creazione del conto.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  balanceCents?: number;
}

export class AddMemberDto {
  @IsUUID()
  userId!: string;

  @IsEnum(AccountMemberRole)
  role!: AccountMemberRole;
}

export class UpdateMemberDto {
  @IsEnum(AccountMemberRole)
  role!: AccountMemberRole;
}
