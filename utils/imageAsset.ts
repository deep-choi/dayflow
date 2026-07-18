const MAX_EMBEDDED_IMAGE_BYTES = 2 * 1024 * 1024;

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('이미지를 읽지 못했습니다.'));
    };
    reader.onerror = () => reject(reader.error || new Error('이미지를 읽지 못했습니다.'));
    reader.readAsDataURL(blob);
  });

export const readImageFileAsDataUrl = async (file: File): Promise<string> => {
  if (!file.type.startsWith('image/')) {
    throw new Error('이미지 파일만 업로드할 수 있습니다.');
  }

  return blobToDataUrl(file);
};

export const normalizePersistedImageSource = async (value?: string): Promise<string | undefined> => {
  const trimmed = (value || '').trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('data:image/')) return trimmed;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    return trimmed;
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return trimmed;
  }

  try {
    const response = await fetch(parsedUrl.toString());
    if (!response.ok) return trimmed;

    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) return trimmed;
    if (blob.size > MAX_EMBEDDED_IMAGE_BYTES) return trimmed;

    return blobToDataUrl(blob);
  } catch {
    return trimmed;
  }
};
