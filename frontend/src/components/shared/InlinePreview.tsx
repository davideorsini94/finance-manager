import { useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AttachmentSummary } from '@/types/domain';
import { AttachmentPreviewDialog } from './AttachmentPreviewDialog';

interface Props {
  attachmentId: string;
  mimeType: string;
  /** Nome mostrato in testata prima che risponda il server (facoltativo). */
  filename?: string;
}

/**
 * Bottone "occhio" per l'anteprima di un singolo allegato (riga dell'uploader
 * dentro il form movimento). È un wrapper sottile: fetch, rendering e download
 * stanno in [[AttachmentPreviewDialog]], condiviso con la lista movimenti.
 */
export function InlinePreview({ attachmentId, mimeType, filename }: Props) {
  const [open, setOpen] = useState(false);

  const attachments = useMemo<AttachmentSummary[]>(
    () => [
      {
        id: attachmentId,
        filename: filename ?? 'allegato',
        mimeType,
        sizeBytes: 0,
        createdAt: '',
      },
    ],
    [attachmentId, mimeType, filename],
  );

  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label="Anteprima"
      >
        <Eye className="h-4 w-4" />
      </Button>

      <AttachmentPreviewDialog attachments={attachments} open={open} onOpenChange={setOpen} />
    </>
  );
}
