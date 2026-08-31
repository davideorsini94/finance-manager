import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsHexColor, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from 'class-validator';

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

/**
 * Riallineamento dei colori alla palette del tema. La palette arriva dal
 * frontend, che è il proprietario dei token di design: qui si valida soltanto
 * che siano esadecimali e che non ne arrivino a valanga.
 */
export class RecolorCategoriesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(24)
  @Matches(/^#[0-9a-fA-F]{6}$/, { each: true, message: 'Colore non valido: atteso #rrggbb.' })
  palette!: string[];
}
