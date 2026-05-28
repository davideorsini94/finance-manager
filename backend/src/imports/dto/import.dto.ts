import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class ColumnMapDto {
  @IsInt() @Min(0) date!: number;
  @IsInt() @Min(0) amount!: number;
  @IsOptional() @IsInt() @Min(0) amountOut?: number;
  @IsOptional() @IsInt() @Min(0) description?: number;
  @IsOptional() @IsInt() @Min(0) reference?: number;
}

export class CreateBatchDto {
  @IsUUID() accountId!: string;
  @IsString() filename!: string;
  @IsString() rawCsv!: string;          // contenuto base64 o testo
  @IsOptional() @IsUUID() templateId?: string;
  @IsOptional() @IsString() delimiter?: string;
  @IsOptional() @IsString() encoding?: string;
  @IsOptional() @IsBoolean() hasHeader?: boolean;
  @IsOptional() @IsString() dateFormat?: string;
  @IsOptional() @IsString() decimalSep?: string;
  @IsOptional() @ValidateNested() @Type(() => ColumnMapDto) columnMap?: ColumnMapDto;
}

export class ConfirmRowDto {
  @IsUUID() rowId!: string;
  @IsOptional() @IsUUID() finalCategoryId?: string;
  @IsOptional() @IsBoolean() skip?: boolean;
}

export class ConfirmBatchDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ConfirmRowDto)
  rows!: ConfirmRowDto[];
  @IsOptional() @IsBoolean() saveAsTemplate?: boolean;
  @IsOptional() @IsString() templateName?: string;
}

export class CreateTemplateDto {
  @IsString() name!: string;
  @IsOptional() @IsString() bankName?: string;
  @IsString() delimiter!: string;
  @IsString() encoding!: string;
  @IsBoolean() hasHeader!: boolean;
  @ValidateNested() @Type(() => ColumnMapDto) columnMap!: ColumnMapDto;
  @IsOptional() @IsString() dateFormat?: string;
  @IsString() decimalSep!: string;
  @IsString() amountMode!: 'single' | 'split';
}
