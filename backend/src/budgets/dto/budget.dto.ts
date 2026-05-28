import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsUUID, Matches, Min } from 'class-validator';

export class CreateBudgetDto {
  @IsUUID()
  categoryId!: string;

  /** Mese in formato YYYY-MM (verrà normalizzato al primo del mese) */
  @Matches(/^\d{4}-\d{2}$/)
  month!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  limitCents!: number;
}

export class UpdateBudgetDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  limitCents?: number;
}

export class ListBudgetsQuery {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  month?: string;
}
