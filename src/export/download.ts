export function download(data: BlobPart, filename: string, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** En iPad: usa la hoja de compartir (AirDrop, Archivos/iCloud, Rhino…) si está disponible. */
export async function shareOrDownload(data: BlobPart, filename: string, type = 'application/octet-stream') {
  const file = new File([data], filename, { type });
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: filename }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
  }
  download(file, filename, type);
}

export const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'trazo';
