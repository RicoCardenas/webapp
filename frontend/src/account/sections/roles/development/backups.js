import { toast } from '/static/app.js';
import { on } from '../../../../lib/events.js';
import { requestWithAuth } from '../../../api-client.js';
import { ui } from '../../../ui.js';
import { loadOperationsSummary } from './ops.js';

export function bindBackups() {
  if (ui.developmentBackupBtn) on(ui.developmentBackupBtn, 'click', onDevelopmentCreateBackup);
  if (ui.developmentRestoreForm) on(ui.developmentRestoreForm, 'submit', onDevelopmentRestore);
}

function onDevelopmentCreateBackup() {
  handleDevelopmentCreateBackup();
}

async function handleDevelopmentCreateBackup() {
  const desiredName = ui.developmentBackupName instanceof HTMLInputElement ? ui.developmentBackupName.value.trim() : '';
  const options = { method: 'POST' };
  if (desiredName) options.body = JSON.stringify({ backup_name: desiredName });

  if (ui.developmentBackupBtn instanceof HTMLButtonElement) {
    ui.developmentBackupBtn.disabled = true;
    ui.developmentBackupBtn.textContent = 'Creando backup...';
  }

  try {
    const res = await requestWithAuth('/api/development/backups/run', {
      ...options,
      headers: desiredName ? { 'Content-Type': 'application/json' } : undefined,
    });
    if (!res) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast?.error?.(data?.error || 'No se pudo crear el backup.');
      return;
    }
    toast?.success?.(data?.message || 'Backup creado.');
    if (ui.developmentBackupName instanceof HTMLInputElement) ui.developmentBackupName.value = '';
    await loadOperationsSummary({ fetch: true });
  } finally {
    if (ui.developmentBackupBtn instanceof HTMLButtonElement) {
      ui.developmentBackupBtn.disabled = false;
      ui.developmentBackupBtn.textContent = 'Crear backup';
    }
  }
}

function onDevelopmentRestore(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) return;
  const nameInput = ui.developmentBackupName;
  const backupName = nameInput instanceof HTMLInputElement ? nameInput.value.trim() : '';
  if (!backupName) {
    toast?.error?.('Ingresa el nombre del backup a restaurar.');
    return;
  }
  handleDevelopmentRestore(backupName);
}

async function handleDevelopmentRestore(backupName) {
  const button = ui.developmentRestoreForm?.querySelector('button[type="submit"]');
  const originalLabel = button?.textContent || 'Restaurar backup';
  if (button instanceof HTMLButtonElement) {
    button.disabled = true;
    button.textContent = 'Restaurando...';
  }
  try {
    const res = await requestWithAuth('/api/development/backups/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backup_name: backupName }),
    });
    if (!res) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast?.error?.(data?.error || 'No se pudo restaurar el backup.');
      return;
    }
    toast?.success?.(data?.message || 'Backup restaurado.');
    await loadOperationsSummary({ fetch: true });
  } finally {
    if (button instanceof HTMLButtonElement) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}
