import { IsString, Matches, MaxLength } from 'class-validator';

/**
 * Forma ammessa per un tag Ollama: `[namespace/]nome[:tag]`. Serve da primo
 * filtro sull'input (nessun carattere di shell/percorso): il controllo
 * sostanziale resta l'allowlist del catalogo per il download e l'elenco dei
 * modelli installati per la selezione.
 */
const MODEL_TAG_PATTERN = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)?(:[A-Za-z0-9._-]+)?$/;

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
