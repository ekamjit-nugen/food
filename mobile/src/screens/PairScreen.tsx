import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

/**
 * Pairing screen. Two paths:
 *   1. Scan the QR from the admin console. Payload shape is
 *      { v:1, kind:'food.pair', code:'ABC12345' }.
 *   2. Type the 8-char code manually. Fallback if the camera is unavailable
 *      or the admin has read the code aloud.
 *
 * After a successful pair we just update auth state; the navigator re-renders
 * to HomeScreen automatically.
 */

const QR_KIND = 'food.pair';

function extractCode(raw: string): string | null {
  // Try JSON envelope first.
  try {
    const parsed = JSON.parse(raw) as { v?: number; kind?: string; code?: string };
    if (parsed && parsed.kind === QR_KIND && typeof parsed.code === 'string') {
      return parsed.code.toUpperCase();
    }
  } catch {
    // fall through — maybe someone printed just the code
  }
  const cleaned = raw.trim().toUpperCase();
  if (/^[A-Z0-9]{8}$/.test(cleaned)) return cleaned;
  return null;
}

export function PairScreen() {
  const { pair } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [manualCode, setManualCode] = useState('');
  const [label, setLabel] = useState('Staff tablet');
  const [busy, setBusy] = useState(false);
  const scannedOnce = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  const submit = useCallback(
    async (code: string) => {
      if (busy) return;
      setBusy(true);
      try {
        await pair({
          code,
          label: label.trim() || 'Staff device',
          platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : undefined,
        });
      } catch (err) {
        scannedOnce.current = false; // allow retry on failure
        const msg = err instanceof ApiError ? err.message : 'Pairing failed. Please try again.';
        Alert.alert('Pairing failed', msg);
      } finally {
        setBusy(false);
      }
    },
    [busy, label, pair],
  );

  const handleBarcode = useCallback(
    ({ data }: { data: string }) => {
      if (scannedOnce.current) return;
      const code = extractCode(data);
      if (!code) return;
      scannedOnce.current = true;
      void submit(code);
    },
    [submit],
  );

  const handleManualSubmit = useCallback(() => {
    const code = extractCode(manualCode);
    if (!code) {
      Alert.alert('Invalid code', 'Pairing codes are 8 letters/digits. Check the admin console.');
      return;
    }
    void submit(code);
  }, [manualCode, submit]);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Pair this device</Text>
      <Text style={styles.subtitle}>Ask your manager to tap "Pair device" in the admin console.</Text>

      <View style={styles.cameraWrap}>
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={busy ? undefined : handleBarcode}
          />
        ) : (
          <View style={styles.cameraFallback}>
            <Text style={styles.cameraFallbackText}>
              {permission?.canAskAgain === false
                ? 'Camera access blocked. Enter the code manually below.'
                : 'Requesting camera access…'}
            </Text>
          </View>
        )}
        {busy ? (
          <View style={styles.busyOverlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.busyText}>Pairing…</Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.sectionLabel}>Device label</Text>
      <TextInput
        value={label}
        onChangeText={setLabel}
        placeholder="e.g. Counter iPad"
        style={styles.input}
        editable={!busy}
      />

      <Text style={styles.sectionLabel}>Or enter code manually</Text>
      <TextInput
        value={manualCode}
        onChangeText={setManualCode}
        placeholder="ABCD2345"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={8}
        style={[styles.input, styles.codeInput]}
        editable={!busy}
      />
      <Pressable
        onPress={handleManualSubmit}
        disabled={busy}
        style={({ pressed }) => [
          styles.button,
          busy && styles.buttonDisabled,
          pressed && !busy && styles.buttonPressed,
        ]}
      >
        <Text style={styles.buttonText}>Pair</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 24, backgroundColor: '#0f172a' },
  title: { fontSize: 24, fontWeight: '700', color: '#fff', marginTop: 24 },
  subtitle: { fontSize: 14, color: '#94a3b8', marginTop: 8, marginBottom: 24 },
  cameraWrap: {
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1e293b',
    marginBottom: 24,
  },
  cameraFallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 16 },
  cameraFallbackText: { color: '#cbd5e1', textAlign: 'center' },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  busyText: { color: '#fff', marginTop: 12, fontSize: 16 },
  sectionLabel: { color: '#cbd5e1', fontSize: 12, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: '#1e293b',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  codeInput: { letterSpacing: 4, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) },
  button: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonPressed: { backgroundColor: '#1d4ed8' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
