import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Forma ammessa per un tag Ollama: `[namespace/]nome[:tag]`. Serve da primo
 * filtro sull'input (nessun carattere di shell/percorso): il controllo
 * sostanziale resta l'allowlist del catalogo per il download e l'elenco dei
 * modelli installati per la selezione.
 */
const MODEL_TAG_PATTERN = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)?(:[A-Za-z0-9._-]+)?$/;

/** Forma ammessa per un model ID OpenCode: `[namespace/]nome[.versione]`. */
const OPENCODE_MODEL_PATTERN = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)?$/;

export class PullModelDto {
  @IsString()
  @MaxLength(120)
  @Matches(MODEL_TAG_PATTERN, { message: 'Tag del modello non valido.' })
  model!: string;
}

export class SetActiveModelDto {
  @IsString()
  @MaxLength(120)
  @Matches(MODEL_TAG_PATTERN, { message: 'Tag del modello non valido.' })
  model!: string;
}

export class SetProviderDto {
  @IsIn(['ollama', 'opencode'], { message: 'Provider LLM non valido.' })
  provider!: 'ollama' | 'opencode';
}

export class SetOpencodeKeyDto {
  @IsString()
  @MinLength(4)
  @MaxLength(400)
  apiKey!: string;

  /** Facoltativo: forza la tier. In sua assenza viene auto-rilevata provando Zen e Go. */
  @IsOptional()
  @IsIn(['zen', 'go'], { message: 'Tier OpenCode non valida.' })
  tier?: 'zen' | 'go';
}

export class SetOpencodeModelDto {
  @IsString()
  @MaxLength(120)
  @Matches(OPENCODE_MODEL_PATTERN, { message: 'Model ID non valido.' })
  model!: string;
}
