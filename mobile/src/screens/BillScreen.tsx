import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ApiError } from '../lib/api';
import {
  useBillForOrder,
  useGenerateBill,
  useRecordPayment,
  type BillDetail,
  type BillItem,
  type PaymentMethod,
} from '../lib/billing';
import { formatPaise, paiseToAmountString, parseAmountToPaise } from '../lib/money';
import { viewBillPdf } from '../lib/pdf';
import type { BillProps } from '../lib/navigation';

/**
 * Bill view + payment capture.
 *
 * Flow:
 *   1. Query GET /orders/:id/bill. 404 → show "Generate bill" button.
 *   2. Once the bill exists, show itemized breakdown, totals, and a
 *      payment row prefilled with the outstanding balance.
 *   3. Method picker (Cash / UPI / Card / Other), amount input (paise-safe),
 *      optional reference, "Record payment".
 *   4. When paid in full, go back to tables.
 *
 * Discount / void / refund UI is intentionally NOT on mobile. Those are
 * supervisor actions and live on the web admin — keeping mobile's billing
 * surface tight reduces the chance of an accidental revenue-affecting tap
 * during service.
 */
export function BillScreen({ route, navigation }: BillProps) {
  const { orderId } = route.params;
  const billQuery = useBillForOrder(orderId);
  const generate = useGenerateBill();

  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Bill' });
  }, [navigation]);

  const onGenerate = useCallback(async () => {
    try {
      await generate.mutateAsync(orderId);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to generate bill';
      Alert.alert('Generate failed', msg);
    }
  }, [generate, orderId]);

  if (billQuery.isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  if (billQuery.error) {
    return (
      <View style={styles.root}>
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{(billQuery.error as Error).message}</Text>
        </View>
      </View>
    );
  }

  if (billQuery.data === null) {
    return (
      <View style={styles.emptyRoot}>
        <Text style={styles.emptyText}>No bill has been generated for this order yet.</Text>
        <Pressable
          onPress={onGenerate}
          disabled={generate.isPending}
          style={({ pressed }) => [
            styles.primaryBtn,
            generate.isPending && styles.primaryBtnDim,
            pressed && !generate.isPending && styles.primaryBtnPressed,
          ]}
        >
          <Text style={styles.primaryBtnText}>
            {generate.isPending ? 'Generating…' : 'Generate bill'}
          </Text>
        </Pressable>
      </View>
    );
  }

  if (billQuery.data) {
    return (
      <BillView
        bill={billQuery.data}
        orderId={orderId}
        onDone={() => navigation.popToTop()}
      />
    );
  }

  return null;
}

function BillView({
  bill,
  orderId,
  onDone,
}: {
  bill: BillDetail;
  orderId: string;
  onDone: () => void;
}) {
  const outstanding = bill.totalPaise - bill.paidPaise;
  const settled = bill.status === 'paid';
  const voided = bill.status === 'void';

  const record = useRecordPayment(orderId);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [amountStr, setAmountStr] = useState(paiseToAmountString(outstanding > 0 ? outstanding : 0));
  const [reference, setReference] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);

  const onViewPdf = async () => {
    setPdfBusy(true);
    try {
      await viewBillPdf(bill.id, bill.billNumber);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to open PDF';
      Alert.alert('PDF failed', msg);
    } finally {
      setPdfBusy(false);
    }
  };

  // If outstanding changes (after a partial payment lands), refresh the input.
  React.useEffect(() => {
    if (!settled && !voided) setAmountStr(paiseToAmountString(outstanding > 0 ? outstanding : 0));
  }, [outstanding, settled, voided]);

  // Stable idempotency key: generated once when the user confirms, reused on
  // retry so a double-tap or network flake doesn't create duplicate payments.
  const idempotencyKeyRef = useRef<string | null>(null);

  const onRecord = () => {
    const paise = parseAmountToPaise(amountStr);
    if (paise === null || paise <= 0) {
      Alert.alert('Invalid amount', 'Enter a positive amount like 250 or 250.50.');
      return;
    }
    if (paise > outstanding) {
      Alert.alert(
        'Amount exceeds outstanding',
        `Outstanding is ${formatPaise(outstanding)}. Enter a smaller amount.`,
      );
      return;
    }
    // Confirmation dialog before committing the payment
    Alert.alert(
      'Confirm payment',
      `Record ${formatPaise(paise)} via ${method.toUpperCase()}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: () => void doRecord(paise),
        },
      ],
    );
  };

  const doRecord = async (paise: number) => {
    // Generate a fresh key per confirmation (reused if the same call retries)
    idempotencyKeyRef.current = Crypto.randomUUID();
    try {
      const refTrimmed = reference.trim();
      await record.mutateAsync({
        billId: bill.id,
        input: {
          idempotencyKey: idempotencyKeyRef.current,
          method,
          amountPaise: paise,
          ...(refTrimmed ? { reference: refTrimmed } : {}),
        },
      });
      setReference('');
      // If this payment settled the bill, surface that and bounce home.
      if (paise >= outstanding) {
        Alert.alert('Bill paid', `Bill #${bill.billNumber} settled.`, [
          { text: 'OK', onPress: onDone },
        ]);
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to record payment';
      Alert.alert('Payment failed', msg);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <View style={styles.billHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.billNumber}>Bill #{bill.billNumber}</Text>
            </View>
            <Text
              style={[
                styles.billStatus,
                settled && styles.billStatusPaid,
                voided && styles.billStatusVoid,
              ]}
            >
              {bill.status.toUpperCase()}
            </Text>
          </View>

          <Pressable
            onPress={onViewPdf}
            disabled={pdfBusy}
            style={({ pressed }) => [
              styles.pdfBtn,
              pdfBusy && styles.pdfBtnDim,
              pressed && !pdfBusy && styles.pdfBtnPressed,
            ]}
          >
            <Text style={styles.pdfBtnText}>
              {pdfBusy ? 'Opening PDF…' : 'View / share PDF'}
            </Text>
          </Pressable>

          {bill.items.map((i) => (
            <ItemRow key={i.id} item={i} />
          ))}

          <View style={styles.separator} />
          <TotalLine label="Subtotal" value={bill.subtotalPaise} />
          {bill.lineDiscountTotalPaise > 0 ? (
            <TotalLine label="Line discounts" value={-bill.lineDiscountTotalPaise} muted />
          ) : null}
          {bill.discountPaise > 0 ? (
            <TotalLine
              label={bill.discountReason ? `Discount (${bill.discountReason})` : 'Discount'}
              value={-bill.discountPaise}
              muted
            />
          ) : null}
          <TotalLine label="Taxable" value={bill.taxablePaise} muted />
          <TotalLine label="CGST" value={bill.cgstPaise} muted />
          <TotalLine label="SGST" value={bill.sgstPaise} muted />
          {bill.roundOffPaise !== 0 ? (
            <TotalLine label="Round off" value={bill.roundOffPaise} muted />
          ) : null}
          <View style={styles.separator} />
          <TotalLine label="Total" value={bill.totalPaise} bold />
          {bill.paidPaise > 0 ? <TotalLine label="Paid" value={bill.paidPaise} muted /> : null}
          {!settled && !voided && outstanding > 0 ? (
            <TotalLine label="Outstanding" value={outstanding} bold accent />
          ) : null}
        </View>

        {bill.payments.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Payments</Text>
            {bill.payments.map((p) => (
              <View key={p.id} style={styles.paymentRow}>
                <Text style={[styles.paymentMethod, p.isVoid && styles.paymentVoid]}>
                  {p.method.toUpperCase()}
                  {p.isVoid ? ' (void)' : ''}
                </Text>
                <Text style={[styles.paymentAmount, p.isVoid && styles.paymentVoid]}>
                  {formatPaise(p.amountPaise)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {!settled && !voided ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Record payment</Text>

            <Text style={styles.fieldLabel}>Method</Text>
            <View style={styles.methodRow}>
              {(['cash', 'upi', 'card', 'other'] as const).map((m) => {
                const selected = m === method;
                return (
                  <Pressable
                    key={m}
                    onPress={() => setMethod(m)}
                    style={[styles.methodChip, selected && styles.methodChipActive]}
                  >
                    <Text style={[styles.methodChipText, selected && styles.methodChipTextActive]}>
                      {m.toUpperCase()}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>Amount (₹)</Text>
            <TextInput
              value={amountStr}
              onChangeText={setAmountStr}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor="#64748b"
              style={styles.input}
            />

            {method === 'upi' || method === 'card' ? (
              <>
                <Text style={styles.fieldLabel}>Reference (optional)</Text>
                <TextInput
                  value={reference}
                  onChangeText={setReference}
                  placeholder={method === 'upi' ? 'UPI txn id' : 'Last 4 digits'}
                  placeholderTextColor="#64748b"
                  style={styles.input}
                  autoCapitalize="none"
                />
              </>
            ) : null}

            <Pressable
              onPress={onRecord}
              disabled={record.isPending}
              style={({ pressed }) => [
                styles.primaryBtn,
                record.isPending && styles.primaryBtnDim,
                pressed && !record.isPending && styles.primaryBtnPressed,
              ]}
            >
              <Text style={styles.primaryBtnText}>
                {record.isPending ? 'Recording…' : 'Record payment'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {settled ? (
          <View style={styles.successBox}>
            <Text style={styles.successText}>Paid in full.</Text>
            <Pressable
              onPress={onDone}
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
            >
              <Text style={styles.primaryBtnText}>Back to tables</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ItemRow({ item }: { item: BillItem }) {
  return (
    <View style={styles.itemRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.itemName} numberOfLines={1}>
          {item.menuItemName}
          {item.variationName ? ` (${item.variationName})` : ''}
        </Text>
        <Text style={styles.itemMeta}>
          {item.quantity} × {formatPaise(item.unitPricePaise)}
        </Text>
      </View>
      <Text style={styles.itemTotal}>{formatPaise(item.lineTotalPaise)}</Text>
    </View>
  );
}

function TotalLine({
  label,
  value,
  bold,
  muted,
  accent,
}: {
  label: string;
  value: number;
  bold?: boolean;
  muted?: boolean;
  accent?: boolean;
}) {
  return (
    <View style={styles.totalLine}>
      <Text style={[styles.totalLabel, muted && styles.totalMuted, bold && styles.totalBold]}>
        {label}
      </Text>
      <Text
        style={[
          styles.totalValue,
          muted && styles.totalMuted,
          bold && styles.totalBold,
          accent && styles.totalAccent,
        ]}
      >
        {formatPaise(value)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a' },
  scrollContent: { padding: 16, paddingBottom: 32 },
  errorBox: { margin: 16, backgroundColor: '#7f1d1d', padding: 12, borderRadius: 8 },
  errorText: { color: '#fecaca' },

  emptyRoot: {
    flex: 1,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyText: { color: '#cbd5e1', textAlign: 'center', marginBottom: 20, fontSize: 15 },

  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  billHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  billNumber: { color: '#fff', fontSize: 18, fontWeight: '700' },
  billStatus: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#0f172a',
  },
  billStatusPaid: { color: '#34d399', backgroundColor: '#064e3b' },
  billStatusVoid: { color: '#f87171', backgroundColor: '#7f1d1d' },

  pdfBtn: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  pdfBtnPressed: { backgroundColor: '#1e293b' },
  pdfBtnDim: { opacity: 0.5 },
  pdfBtnText: { color: '#60a5fa', fontSize: 13, fontWeight: '600' },

  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#334155',
  },
  itemName: { color: '#fff', fontSize: 14 },
  itemMeta: { color: '#94a3b8', fontSize: 11, marginTop: 2 },
  itemTotal: { color: '#fff', fontSize: 14, fontVariant: ['tabular-nums'] },

  separator: { height: 1, backgroundColor: '#334155', marginVertical: 8 },
  totalLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  totalLabel: { color: '#e2e8f0', fontSize: 13 },
  totalValue: { color: '#e2e8f0', fontSize: 13, fontVariant: ['tabular-nums'] },
  totalMuted: { color: '#94a3b8', fontSize: 12 },
  totalBold: { color: '#fff', fontSize: 15, fontWeight: '700' },
  totalAccent: { color: '#fbbf24' },

  sectionTitle: { color: '#fff', fontSize: 14, fontWeight: '600', marginBottom: 10 },
  paymentRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  paymentMethod: { color: '#cbd5e1', fontSize: 13, fontWeight: '600' },
  paymentAmount: { color: '#fff', fontSize: 13, fontVariant: ['tabular-nums'] },
  paymentVoid: { textDecorationLine: 'line-through', color: '#64748b' },

  fieldLabel: {
    color: '#94a3b8',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 10,
    fontWeight: '600',
  },
  methodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  methodChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    marginRight: 8,
    marginBottom: 8,
  },
  methodChipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  methodChipText: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' },
  methodChipTextActive: { color: '#fff' },
  input: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },

  primaryBtn: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 14,
  },
  primaryBtnPressed: { backgroundColor: '#1d4ed8' },
  primaryBtnDim: { opacity: 0.5 },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  successBox: {
    backgroundColor: '#064e3b',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#065f46',
  },
  successText: { color: '#a7f3d0', fontSize: 16, fontWeight: '600' },
});
