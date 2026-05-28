import { Transform, Type } from 'class-transformer';
import { IsArray, IsDateString, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** Espone una query string `?accountIds=...` sia come singolo valore sia come array. */
const ToStringArray = () =>
  Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    return Array.isArray(value) ? value : [value];
  });

export class DashboardQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @ToStringArray()
  @IsArray()
  @IsUUID('4', { each: true })
  accountIds?: string[];
}

export class CustomReportQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @ToStringArray()
  @IsArray()
  @IsUUID('4', { each: true })
  accountIds?: string[];

  @IsOptional()
  @ToStringArray()
  @IsArray()
  @IsUUID('4', { each: true })
  categoryIds?: string[];
}

export class MonthlyReportQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @IsOptional()
  @ToStringArray()
  @IsArray()
  @IsUUID('4', { each: true })
  accountIds?: string[];
}

export class AnnualReportQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @IsOptional()
  @ToStringArray()
  @IsArray()
  @IsUUID('4', { each: true })
  accountIds?: string[];
}

export class CompareQueryDto {
  @IsDateString()
  period1From!: string;

  @IsDateString()
  period1To!: string;

  @IsDateString()
  period2From!: string;

  @IsDateString()
  period2To!: string;

  @IsOptional()
  @ToStringArray()
  @IsArray()
  @IsUUID('4', { each: true })
  accountIds?: string[];
}
