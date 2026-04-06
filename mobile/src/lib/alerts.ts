import { useMutation } from '@tanstack/react-query';
import { api } from './api';

/**
 * Service alerts — the "call a waiter / manager / kitchen" buttons. The
 * endpoint is frictionless by design (no role gate server-side) because
 * speed matters more than authorization: anyone on a paired device can
 * summon help.
 */

export type ServiceAlertKind = 'call_waiter' | 'call_kitchen' | 'call_manager';

export interface ServiceAlert {
  id: string;
  tenantId: string;
  outletId: string;
  kind: ServiceAlertKind;
  tableId: string | null;
  note: string | null;
  raisedBy: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  createdAt: string;
}

export interface CreateAlertInput {
  kind: ServiceAlertKind;
  tableId?: string;
  note?: string;
}

export function useCreateAlert() {
  return useMutation({
    mutationFn: (input: CreateAlertInput) => api.post<ServiceAlert>('/alerts', input),
  });
}
