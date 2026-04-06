/**
 * Service alert domain types. See schema.sql → service_alerts for the rationale.
 * v1 scope is intentionally tiny: raise, ack, list. No replies, no priorities,
 * no SLAs.
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
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  createdAt: Date;
}
