export type PhotoUpload = {
  name: string;
  mimeType: string;
  /** Raw base64 (no data URL prefix). */
  base64: string;
};

function readFileAsBase64Data(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Could not read file as data URL'));
        return;
      }
      const comma = result.indexOf('base64,');
      resolve(comma >= 0 ? result.slice(comma + 'base64,'.length) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

/** Encode captured / gallery images for Google Apps Script → DriveApp.createFile. */
export async function encodePhotosForDrive(
  files: readonly File[],
): Promise<PhotoUpload[]> {
  return Promise.all(
    files.map(async (file) => ({
      name: file.name.replace(/[^\w.-]+/g, '_').slice(0, 180) || 'photo.jpg',
      mimeType:
        file.type && file.type.startsWith('image/')
          ? file.type
          : 'image/jpeg',
      base64: await readFileAsBase64Data(file),
    })),
  );
}
