import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface Outlet {
  id: string;
  tenantId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const outletKeys = {
  list: ['outlets'] as const,
};

export function useOutlets() {
  return useQuery({
    queryKey: outletKeys.list,
    queryFn: async () => {
      const res = await api.get<{ data: Outlet[] }>('/outlets');
      return res.data;
    },
  });
}

export function useCreateOutlet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string }) => api.post<Outlet>('/outlets', input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: outletKeys.list }); },
  });
}

export function useUpdateOutlet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; input: { name?: string; isActive?: boolean } }) =>
      api.patch<Outlet>(`/outlets/${vars.id}`, vars.input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: outletKeys.list }); },
  });
}
