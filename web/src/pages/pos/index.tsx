import { Route, Routes } from 'react-router-dom';
import { PosTables } from './tables';
import { PosOrderScreen } from './order';
import { PosBillScreen } from './bill';
import { PosReceiptScreen } from './receipt';

/**
 * POS router. Screens:
 *   /pos                        — table grid (home)
 *   /pos/order/new?tableId=...  — new-order flow for an empty table
 *   /pos/order/:id              — existing open order (add more items, send KOT)
 *   /pos/order/:id/bill         — billing flow for an order
 *   /pos/order/:id/receipt      — print-optimised receipt view
 */
export function PosHome() {
  return (
    <Routes>
      <Route index element={<PosTables />} />
      <Route path="order/new" element={<PosOrderScreen mode="new" />} />
      <Route path="order/:id" element={<PosOrderScreen mode="existing" />} />
      <Route path="order/:id/bill" element={<PosBillScreen />} />
      <Route path="order/:id/receipt" element={<PosReceiptScreen />} />
    </Routes>
  );
}
