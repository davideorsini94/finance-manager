import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { UTILITY_KINDS, type UtilityKind } from '../bill-extraction';

/** Date come `YYYY-MM-DD`: niente orari né fusi, sono giorni di calendario. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MESSAGE = 'Data non valida: usa il formato AAAA-MM-GG';

export class UtilityBillLineDto {
  @IsIn(UTILITY_KINDS)
  utility!: UtilityKind;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'Consumo non valido' })
  @Min(0, { message: 'Il consumo non può essere negativo' })
  @Max(999_999, { message: 'Consumo troppo alto' })
  consumption?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Costo non valido' })
  @Min(-10_000_000)
  @Max(10_000_000, { message: 'Costo troppo alto' })
  costCents?: number | null;

  @IsOptional()
  @Matches(ISO_DAY, { message: DAY_MESSAGE })
  periodStart?: string | null;

  @IsOptional()
  @Matches(ISO_DAY, { message: DAY_MESSAGE })
  periodEnd?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  supplyCode?: string | null;

  // Valore grezzo: con `enableImplicitConversion` la stringa "false"
  // diventerebbe `true`; così invece una stringa viene rifiutata.
  @IsOptional()
  @Transform(({ obj, key }) => (obj as Record<string, unknown>)[key])
  @IsBoolean()
  estimated?: boolean;
}

/**
 * Salvataggio di una bolletta (nuova a mano o verifica di una letta dal PDF).
 * Salvare = confermare: da qui la bolletta entra nelle analisi.
 */
export class SaveUtilityBillDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  provider?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  billNumber?: string | null;

  @IsOptional()
  @Matches(ISO_DAY, { message: DAY_MESSAGE })
  issueDate?: string | null;

  @IsOptional()
  @Matches(ISO_DAY, { message: DAY_MESSAGE })
  dueDate?: string | null;

  @Matches(ISO_DAY, { message: 'Indica la data di inizio del periodo' })
  periodStart!: string;

  @Matches(ISO_DAY, { message: 'Indica la data di fine del periodo' })
  periodEnd!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Totale non valido' })
  @Min(-10_000_000)
  @Max(10_000_000, { message: 'Totale troppo alto' })
  totalCents?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @IsArray()
  @ArrayMinSize(1, { message: 'Indica almeno un servizio (luce, gas o acqua)' })
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => UtilityBillLineDto)
  lines!: UtilityBillLineDto[];
}
