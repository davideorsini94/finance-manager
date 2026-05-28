import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsHexColor,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsHexColor()
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  icon?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isIncome?: boolean;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsHexColor()
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  icon?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isIncome?: boolean;

  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class ReorderCategoryItemDto {
  @IsUUID()
  id!: string;

  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder!: number;
}

export class ReorderCategoriesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderCategoryItemDto)
  items!: ReorderCategoryItemDto[];
}

export class DeleteCategoryQueryDto {
  /** Se presente, le transazioni e le sottocategorie vengono spostate qui. */
  @IsOptional()
  @IsUUID()
  reassignTo?: string;
}
