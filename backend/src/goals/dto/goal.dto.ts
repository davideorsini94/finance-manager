import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateGoalDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetCents!: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  currentCents?: number;

  @IsOptional()
  @IsDateString()
  deadline?: string;

  @IsOptional()
  @IsUUID()
  accountId?: string;
}

export class UpdateGoalDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  targetCents?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  currentCents?: number;

  @IsOptional()
  @IsDateString()
  deadline?: string | null;

  @IsOptional()
  @IsBoolean()
  isCompleted?: boolean;
}
