import { useState } from 'react';
import { ZoomBox } from './ZoomBox';

interface Props {
  /** `blob:` URL dell'immagine già scaricata dal dialog chiamante. */
  url: string;
  alt: string;
}

/** Margine, per non innescare il ciclo comparsa/scomparsa delle barre. */
const SLACK = 2;

/**
 * Anteprima immagine dentro un [[ZoomBox]]: stesse gesture e stessi comandi
 * dei PDF, perché metà degli allegati sono foto di scontrini e zoomare lì
 * serve quanto su un PDF.
 *
 * L'adattamento non supera il 100%: ingrandire d'ufficio uno screenshot
 * piccolo lo sgranerebbe e basta. Ingrandirlo resta possibile a mano.
 */
export function ImagePreview({ url, alt }: Props) {
  const [naturale, setNaturale] = useState<{ w: number; h: number } | null>(null);

  return (
    <ZoomBox className="min-h-[180px]">
      {({ box, zoom }) => {
        const fit = naturale
          ? Math.min((box.width - SLACK) / naturale.w, (box.height - SLACK) / naturale.h, 1)
          : 0;
        return (
          <img
            src={url}
            alt={alt}
            onLoad={(e) =>
              setNaturale({
                w: e.currentTarget.naturalWidth,
                h: e.currentTarget.naturalHeight,
              })
            }
            style={
              naturale
                ? {
                    width: Math.floor(naturale.w * fit * zoom),
                    height: Math.floor(naturale.h * fit * zoom),
                  }
                : undefined
            }
            className="max-w-none shrink-0 select-none rounded-md"
            draggable={false}
          />
        );
      }}
    </ZoomBox>
  );
}
