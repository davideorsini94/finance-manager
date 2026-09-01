import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { File, Trash2, Upload, ImageIcon, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { attachmentsApi } from '@/features/transactions/attachmentsApi';
import type { AttachmentSummary } from '@/types/domain';
import { InlinePreview } from './InlinePreview';
import { useConfirm } from './confirm';

interface Props {
  transactionId: string;
  readOnly?: boolean;
}

const ACCEPTED = {
  'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif'],
  'application/pdf': ['.pdf'],
};

export function AttachmentUploader({ transactionId, readOnly }: Props) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const listQuery = useQuery({
    queryKey: ['attachments', transactionId],
    queryFn: () => attachmentsApi.list(transactionId),
  });

  const upload = useMutation({
    mutationFn: (file: File) => attachmentsApi.upload(transactionId, file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['attachments', transactionId] });
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => attachmentsApi.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['attachments', transactionId] });
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });

  const onDrop = useCallback(
    (accepted: File[]) => accepted.forEach((f) => upload.mutate(f)),
    [upload],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED,
    maxSize: 10 * 1024 * 1024,
    disabled: readOnly,
  });

  const items = listQuery.data ?? [];

  const askDelete = async (att: AttachmentSummary) => {
    const ok = await confirm({
      title: 'Eliminare allegato?',
      description: att.filename,
      confirmLabel: 'Elimina',
      destructive: true,
    });
    if (ok) remove.mutate(att.id);
  };

  return (
    <div className="space-y-3">
      {!readOnly && (
        <div
          {...getRootProps()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed p-4 text-sm transition ${
            isDragActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/40'
          }`}
        >
          <input {...getInputProps()} />
          <Upload className="h-5 w-5 mb-2" />
          <p>Trascina file qui o clicca per scegliere</p>
          <p className="text-xs">Immagini o PDF, max 10 MB</p>
        </div>
      )}

      {upload.isError && (
        <p className="text-xs text-destructive">{(upload.error as Error).message}</p>
      )}

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((att) => (
            <AttachmentItem
              key={att.id}
              attachment={att}
              onDelete={readOnly ? undefined : () => askDelete(att)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface ItemProps {
  attachment: AttachmentSummary;
  onDelete?: () => void;
}

function AttachmentItem({ attachment, onDelete }: ItemProps) {
  const isImage = attachment.mimeType.startsWith('image/');
  const isPdf = attachment.mimeType === 'application/pdf';
  const Icon = isImage ? ImageIcon : isPdf ? FileText : File;

  return (
    <li className="flex items-center gap-3 rounded-md border p-2">
      <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm">{attachment.filename}</p>
        <p className="text-xs text-muted-foreground">
          {(attachment.sizeBytes / 1024).toFixed(1)} KB
        </p>
      </div>
      <InlinePreview
        attachmentId={attachment.id}
        mimeType={attachment.mimeType}
        filename={attachment.filename}
      />
      {onDelete && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete();
          }}
          aria-label="Elimina"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </li>
  );
}
