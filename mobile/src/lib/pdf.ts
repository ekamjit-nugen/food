import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { ApiError, apiUrl, getAuthToken } from './api';

/**
 * PDF viewer bridge.
 *
 * React Native has no built-in PDF view, and the bill/KOT endpoints are
 * bearer-protected so we cannot just open them in the system browser. The
 * path that works cross-platform without extra native dependencies:
 *
 *   1. FileSystem.downloadAsync with an Authorization header
 *   2. Sharing.shareAsync on the resulting file URI
 *
 * iOS opens the system share sheet with "Quick Look" preview inline.
 * Android opens the PDF in whatever viewer the user has installed (or
 * surfaces a chooser if none is default).
 *
 * Files land in the cache directory so they are garbage-collected by the OS
 * — we never persist bills to the device.
 */

async function downloadAndShare(
  path: string,
  filename: string,
  dialogTitle: string,
): Promise<void> {
  const token = getAuthToken();
  if (!token) throw new ApiError('unauthorized', 'not signed in', 401);

  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) throw new Error('no cache directory available');

  const localUri = cacheDir + filename;
  const result = await FileSystem.downloadAsync(apiUrl(path), localUri, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (result.status < 200 || result.status >= 300) {
    // Best-effort cleanup; ignore failures.
    try {
      await FileSystem.deleteAsync(result.uri, { idempotent: true });
    } catch {}
    throw new ApiError('pdf_download_failed', `server returned ${result.status}`, result.status);
  }

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    // On simulators without a share extension we cannot open the file.
    // Surface a clear error so the caller can message the user.
    throw new Error('sharing is not available on this device');
  }

  await Sharing.shareAsync(result.uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle,
  });
}

export function viewBillPdf(billId: string, billNumber: number): Promise<void> {
  return downloadAndShare(
    `/bills/${billId}/pdf`,
    `bill-${billNumber}.pdf`,
    `Bill #${billNumber}`,
  );
}

export function viewKotPdf(kotId: string, kotNumber: number): Promise<void> {
  return downloadAndShare(
    `/kots/${kotId}/pdf`,
    `kot-${kotNumber}.pdf`,
    `KOT #${kotNumber}`,
  );
}
