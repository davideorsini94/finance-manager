import { api } from '@/lib/api/client';
import type { AttachmentSummary } from '@/types/domain';

export interface PresignedAttachment {
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export const attachmentsApi = {
  list: (transactionId: string) =>
    api.get(`transactions/${transactionId}/attachments`).json<AttachmentSummary[]>(),

  upload: (transactionId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api
      .post(`transactions/${transactionId}/attachments`, { body: formData })
      .json<AttachmentSummary>();
  },

  presigned: (id: string) => api.get(`attachments/${id}/presigned`).json<PresignedAttachment>(),

  remove: (id: string) => api.delete(`attachments/${id}`),
};
