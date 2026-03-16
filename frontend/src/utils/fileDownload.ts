import { isNativePlatform } from './platform';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function showNativeToast(message: string): Promise<void> {
  try {
    const { Toast } = await import('@capacitor/toast');
    await Toast.show({ text: message });
  } catch {
    // Toast not available, ignore
  }
}

/** Sanitize filename to prevent path traversal and filesystem issues */
function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9._\-\s]/g, '_')
    .replace(/\.{2,}/g, '_')
    .substring(0, 200) || 'download';
}

/** SECURITY: Validate URL is a safe relative API path (no external origin) */
function isSafeApiUrl(url: string): boolean {
  // Must start with /api/ (relative path, no host component)
  // Reject any URL with protocol, host, or double-slash that could redirect externally
  return url.startsWith('/api/') && !url.includes('//') && !url.includes('\\');
}

export async function downloadFile(
  url: string,
  filename: string,
  authToken?: string
): Promise<void> {
  const safeFilename = sanitizeFilename(filename);

  if (isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');

    const headers: Record<string, string> = {};
    // SECURITY: Only send auth token to our own API endpoints
    if (authToken && isSafeApiUrl(url)) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(url, { headers, credentials: 'include' });
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }
    const blob = await response.blob();
    const base64 = await blobToBase64(blob);

    await Filesystem.writeFile({
      path: safeFilename,
      data: base64,
      directory: Directory.Documents,
      recursive: true,
    });

    await showNativeToast(`File salvato: ${safeFilename}`);
  } else {
    // Web: if URL is a safe API endpoint requiring auth, use fetch with token
    if (isSafeApiUrl(url) && authToken) {
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${authToken}` },
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', safeFilename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      // SECURITY: Delay revocation to allow browser to initiate download
      setTimeout(() => URL.revokeObjectURL(blobUrl), 500);
    } else {
      // External URL or no auth needed — direct link click (no token sent)
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', safeFilename);
      link.setAttribute('rel', 'noopener noreferrer');
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  }
}

export async function downloadBlob(
  blob: Blob,
  filename: string
): Promise<void> {
  const safeFilename = sanitizeFilename(filename);

  if (isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const base64 = await blobToBase64(blob);

    await Filesystem.writeFile({
      path: safeFilename,
      data: base64,
      directory: Directory.Documents,
      recursive: true,
    });

    await showNativeToast(`File salvato: ${safeFilename}`);
  } else {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', safeFilename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }
}
