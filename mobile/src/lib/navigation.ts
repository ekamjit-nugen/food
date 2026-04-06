import type { NativeStackScreenProps } from '@react-navigation/native-stack';

/**
 * Central nav param list. Add screens here and every `navigation.navigate`
 * call gets typechecked for free.
 *
 * - Tables: home after auth. Shows grid of tables + takeaway list.
 * - Order: order composer. `orderId` present → existing order;
 *          otherwise `tableId` + `tableCode` for a new dine-in order,
 *          or `orderType: 'takeaway'` for a tableless order.
 * - Bill: bill view for a specific order (must be already generated or
 *         will be generated on arrival).
 */
export type AppStackParamList = {
  Tables: undefined;
  Order:
    | { orderId: string; tableCode?: string }
    | { orderId?: undefined; tableId: string; tableCode: string }
    | { orderId?: undefined; tableId?: undefined; orderType: 'takeaway'; tableCode?: undefined };
  Bill: { orderId: string };
  Stock: undefined;
};

export type TablesProps = NativeStackScreenProps<AppStackParamList, 'Tables'>;
export type OrderProps = NativeStackScreenProps<AppStackParamList, 'Order'>;
export type BillProps = NativeStackScreenProps<AppStackParamList, 'Bill'>;
export type StockProps = NativeStackScreenProps<AppStackParamList, 'Stock'>;
