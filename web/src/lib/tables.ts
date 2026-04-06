import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface DiningTable {
  id: string;
  outletId: string;
  code: string;
  label: string | null;
  section: string | null;
  seats: number;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const tableKeys = {
  list: ['tables', 'list'] as const,
};

export function useTables(opts?: { includeInactive?: boolean }) {
  const includeInactive = opts?.includeInactive ?? false;
  return useQuery({
    queryKey: [...tableKeys.list, { includeInactive }],
    queryFn: async () => {
      const query = includeInactive ? { includeInactive: 'true' } : undefined;
      const res = await api.get<{ data: DiningTable[] }>('/tables', query);
      return res.data;
    },
  });
}

/**
 * Bulk-create tables. The onboarding wizard is the main caller: "make me
 * N tables numbered T1..TN". The server wraps the insert in a transaction
 * so either all tables are created or none are.
 */
export interface BulkTableInput {
  code: string;
  seats?: number;
  label?: string | null;
  section?: string | null;
  displayOrder?: number;
}

export function useBulkCreateTables() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tables: BulkTableInput[]) =>
      api.post<{ data: DiningTable[] }>('/tables/bulk', { tables }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tableKeys.list });
    },
  });
}

export interface CreateTableInput {
  code: string;
  seats: number;
  label?: string | null;
  displayOrder?: number;
}

export function useCreateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTableInput) => api.post<DiningTable>('/tables', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tableKeys.list });
    },
  });
}

export interface UpdateTableInput {
  code?: string;
  seats?: number;
  label?: string | null;
  displayOrder?: number;
  isActive?: boolean;
}

export function useUpdateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; input: UpdateTableInput }) =>
      api.patch<DiningTable>(`/tables/${vars.id}`, vars.input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tableKeys.list });
    },
  });
}

export function useDeactivateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<DiningTable>(`/tables/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tableKeys.list });
    },
  });
}
