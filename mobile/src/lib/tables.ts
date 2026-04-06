import { useQuery } from '@tanstack/react-query';
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

export function useTables() {
  return useQuery({
    queryKey: tableKeys.list,
    queryFn: async () => {
      const res = await api.get<{ data: DiningTable[] }>('/tables');
      return res.data;
    },
  });
}
