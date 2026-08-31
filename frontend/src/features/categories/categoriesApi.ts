import { api } from '@/lib/api/client';
import type { Category } from '@/types/domain';

export interface CreateCategoryInput {
  name: string;
  color?: string;
  icon?: string;
  parentId?: string;
  sortOrder?: number;
}

export interface UpdateCategoryInput extends Partial<Omit<CreateCategoryInput, 'parentId'>> {
  parentId?: string | null;
}

export const categoriesApi = {
  list: () => api.get('categories').json<Category[]>(),
  create: (data: CreateCategoryInput) => api.post('categories', { json: data }).json<Category>(),
  update: (id: string, data: UpdateCategoryInput) =>
    api.patch(`categories/${id}`, { json: data }).json<Category>(),
  remove: (id: string) => api.delete(`categories/${id}`),
  /** Riallinea i colori alla palette del tema (radici + figli). */
  recolor: (palette: readonly string[]) =>
    api.post('categories/recolor', { json: { palette } }).json<{ updated: number }>(),
};
