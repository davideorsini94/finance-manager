import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/**
 * Espone `?accountIds=...` sia come singolo valore sia come array (stesso
 * helper di `reports.dto.ts`: è cinque righe, duplicarlo costa meno che
 * inventare un modulo condiviso di transform).
 */
const ToStringArray = () =>
  Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    return Array.isArray(value) ? value : [value];
  });

export class LlmReportQueryDto {
  @IsIn(['annual', 'monthly'])
  scope!: 'annual' | 'monthly';

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  /** Obbligatorio quando `scope` è `monthly` (validato nel servizio). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @ToStringArray()
  @IsArray()
  @IsUUID('4', { each: true })
  accountIds?: string[];
}

export class GenerateLlmReportDto extends LlmReportQueryDto {
  /** Sovrascrive un report già presente. La UI lo manda solo dopo conferma. */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
