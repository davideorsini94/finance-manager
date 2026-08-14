import { StagedTxStatus } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsUUID,
} from 'class-validator';

/**
 * Stati che ha senso mostrare in revisione. `confirmed` ed `error` restano
 * fuori: le prime sono già diventate movimenti, le seconde non sono
 * recuperabili dall'utente.
 */
export const REVIEWABLE_STATUSES = [
  StagedTxStatus.pending_review,
  StagedTxStatus.duplicate,
  StagedTxStatus.ignored,
] as const;

export type ReviewableStatus = (typeof REVIEWABLE_STATUSES)[number];

/** Tipi forzabili a mano: il giroconto si ottiene accoppiando, non scegliendolo. */
export const FORCEABLE_TYPES = ['income', 'expense'] as const;
export type ForceableType = (typeof FORCEABLE_TYPES)[number];

/** Tetto della conferma multipla: la barra azioni della UI seleziona a blocchi. */
export const CONFIRM_MAX_IDS = 200;

export class ListReviewQueryDto {
  /** Default `pending_review`. */
  @IsOptional()
  @IsIn(REVIEWABLE_STATUSES, {
    message: 'Stato non valido: usa pending_review, duplicate oppure ignored.',
  })
  status?: ReviewableStatus;
}

/**
 * Modifiche possibili su una riga in revisione. Tutti i campi sono opzionali,
 * ma il corpo vuoto è un errore: il service rifiuta anche le combinazioni
 * incoerenti (es. ignora + accoppia).
 */
export class UpdateReviewItemDto {
  /** Categoria finale: `null` la svuota, assente = non toccarla. */
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  /** Forza entrata/uscita su una riga non accoppiata. */
  @IsOptional()
  @IsIn(FORCEABLE_TYPES, { message: 'Il tipo può essere solo income o expense.' })
  type?: ForceableType;

  /** uuid = accoppia come giroconto; `null` = separa la coppia. */
  @IsOptional()
  @IsUUID()
  pairWithStagedId?: string | null;

  /** Esclude la riga dalla coda (non diventerà un movimento). */
  @IsOptional()
  @IsBoolean()
  ignore?: boolean;

  /** Riporta in coda una riga ignorata o segnata come duplicata. */
  @IsOptional()
  @IsBoolean()
  restore?: boolean;
}

export class ConfirmReviewDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Seleziona almeno un movimento da confermare.' })
  @ArrayMaxSize(CONFIRM_MAX_IDS, {
    message: `Puoi confermare al massimo ${CONFIRM_MAX_IDS} movimenti per volta.`,
  })
  @IsUUID('4', { each: true })
  ids!: string[];
}
