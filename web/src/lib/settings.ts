import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface OutletSettings {
  id: string;
  name: string;
  legalName: string | null;
  gstin: string | null;
  fssaiNo: string | null;
  address: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  defaultTaxRateBps: number;
  billNumberPrefix: string | null;
  receiptFooterText: string;
  maxDiscountBps: number | null;
  kotWarningMinutes: number;
  kotUrgentMinutes: number;
  autoRestock: boolean;
  autoRestockTime: string;
}

const SETTINGS_KEY = ['settings'];

export function useSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => api.get<OutletSettings>('/settings'),
  });
}

function useSettingsMutation(section: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch<OutletSettings>(`/settings/${section}`, body),
    onSuccess: (data) => {
      qc.setQueryData(SETTINGS_KEY, data);
    },
  });
}

export function useUpdateBusiness() {
  return useSettingsMutation('business');
}
export function useUpdateTax() {
  return useSettingsMutation('tax');
}
export function useUpdateBilling() {
  return useSettingsMutation('billing');
}
export function useUpdateOperations() {
  return useSettingsMutation('operations');
}

export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];
