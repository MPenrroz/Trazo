import { store } from './core/store';
import { shareOrDownload, slug } from './export/download';
import { toast } from './ui';

const DAY = 86400000;

/** Exporta el proyecto completo (.trazo.json) a Archivos/iCloud y registra la fecha del respaldo. */
export async function backupProject() {
  store.update((p) => { p.backupAt = Date.now(); }, 'backup');
  await shareOrDownload(JSON.stringify(store.project), `${slug(store.project.name)}.trazo.json`, 'application/json');
  toast('Respaldo generado. Guárdalo en iCloud Drive o Archivos.');
  document.dispatchEvent(new Event('trazo:backup'));
}

const ago = (t: number) => {
  const d = Math.floor((Date.now() - t) / DAY);
  return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`;
};

/** Estado del respaldo del proyecto actual y si conviene recordarlo. */
export function backupStatus(): { text: string; nag: boolean } {
  const p = store.project;
  if (!store.persist) return { text: 'Este navegador no permite guardar: respalda antes de cerrar.', nag: true };
  let snoozed = false;
  try { snoozed = Date.now() - Number(localStorage.getItem(`trazo:snooze:${p.id}`) ?? 0) < 7 * DAY; } catch { /* */ }
  const changedSince = p.updatedAt > (p.backupAt ?? 0) + 60000;
  const text = p.backupAt ? `Último respaldo: ${ago(p.backupAt)}.` : 'Este proyecto aún no tiene respaldo.';
  // recordar: nunca respaldado tras 30 min de trabajo, o respaldo de más de 7 días con cambios posteriores
  const due = p.backupAt ? Date.now() - p.backupAt > 7 * DAY : Date.now() - p.createdAt > 30 * 60000;
  return { text, nag: changedSince && due && !snoozed };
}
