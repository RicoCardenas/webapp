import { toast } from '/static/app.js';
import { on } from '../../lib/events.js';
import { requestWithAuth } from '../api-client.js';
import { ui } from '../ui.js';

const twoFAState = {
  bound: false,
  loading: false,
  enabled: false,
  secret: null,
  otpauthUrl: null,
  qrImage: null,
  backupCodes: [],
};

function setTwoFactorLoading(isLoading) {
  twoFAState.loading = Boolean(isLoading);
  if (ui.twofaSetupButton instanceof HTMLButtonElement) ui.twofaSetupButton.disabled = twoFAState.loading;
  if (ui.twofaVerifySubmit instanceof HTMLButtonElement) ui.twofaVerifySubmit.disabled = twoFAState.loading;
  if (ui.twofaDisableSubmit instanceof HTMLButtonElement) ui.twofaDisableSubmit.disabled = twoFAState.loading;
  if (ui.twofaRegenerateSubmit instanceof HTMLButtonElement) ui.twofaRegenerateSubmit.disabled = twoFAState.loading;
}

function showTwoFactorFeedback(message, variant = 'info') {
  if (!ui.twofaFeedback) return;
  ui.twofaFeedback.textContent = message;
  ui.twofaFeedback.dataset.variant = variant;
  ui.twofaFeedback.hidden = false;
}

function clearTwoFactorFeedback() {
  if (!ui.twofaFeedback) return;
  ui.twofaFeedback.textContent = '';
  ui.twofaFeedback.hidden = true;
  ui.twofaFeedback.removeAttribute('data-variant');
}

function renderTwoFactorStatus() {
  if (ui.twofaStatus) {
    ui.twofaStatus.textContent = twoFAState.enabled
      ? 'Autenticación en dos pasos activada'
      : 'Autenticación en dos pasos desactivada';
  }
  if (ui.twofaSetupButton) ui.twofaSetupButton.hidden = twoFAState.enabled;
  if (ui.twofaEnabledActions) ui.twofaEnabledActions.hidden = !twoFAState.enabled;
  if (ui.twofaSetupPanel) {
    ui.twofaSetupPanel.hidden = !twoFAState.secret || twoFAState.enabled;
  }
}

function renderTwoFactorSetup() {
  if (!ui.twofaSetupPanel) return;
  ui.twofaSetupPanel.hidden = false;
  if (ui.twofaSecret) ui.twofaSecret.textContent = twoFAState.secret || '';
  if (ui.twofaQr instanceof HTMLImageElement) {
    ui.twofaQr.src = twoFAState.qrImage || '';
    ui.twofaQr.hidden = !twoFAState.qrImage;
  }
  if (ui.twofaVerifyForm) ui.twofaVerifyForm.reset();
}

function renderBackupCodes(codes) {
  if (!ui.twofaBackupCodes || !ui.twofaCodesList) return;
  ui.twofaCodesList.innerHTML = '';
  if (!Array.isArray(codes) || !codes.length) {
    ui.twofaBackupCodes.hidden = true;
    return;
  }
  codes.forEach((code) => {
    const li = document.createElement('li');
    li.textContent = code;
    ui.twofaCodesList.appendChild(li);
  });
  ui.twofaBackupCodes.hidden = false;
}

async function loadTwoFactorStatus() {
  if (!ui.twofaSection) return;
  try {
    const res = await requestWithAuth('/api/account/2fa/status');
    if (!res) return;
    if (!res.ok) {
      showTwoFactorFeedback('No se pudo consultar el estado de 2FA.', 'error');
      return;
    }
    const data = await res.json().catch(() => ({}));
    twoFAState.enabled = Boolean(data?.enabled);
    twoFAState.backupCodes = Array.isArray(data?.backup_codes) ? data.backup_codes : [];
    twoFAState.secret = null;
    twoFAState.qrImage = null;
    renderTwoFactorStatus();
    renderBackupCodes(twoFAState.backupCodes);
  } catch (error) {
    console.error('[account] Error al cargar estado 2FA', error);
    showTwoFactorFeedback('No se pudo consultar el estado de 2FA.', 'error');
  }
}

async function startTwoFactorSetup() {
  if (twoFAState.loading) return;
  setTwoFactorLoading(true);
  clearTwoFactorFeedback();
  try {
    const res = await requestWithAuth('/api/account/2fa/setup');
    if (!res) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showTwoFactorFeedback(data?.error || 'No se pudo iniciar la configuración 2FA.', 'error');
      return;
    }
    twoFAState.secret = data?.secret || null;
    twoFAState.otpauthUrl = data?.otpauth_url || null;
    twoFAState.qrImage = data?.qr || null;
    renderTwoFactorStatus();
    renderTwoFactorSetup();
    showTwoFactorFeedback(data?.message || 'Escanea el código y confirma con tu app 2FA.', 'info');
  } catch (err) {
    console.error('[account] Error al iniciar configuración 2FA', err);
    showTwoFactorFeedback('No se pudo iniciar la configuración 2FA.', 'error');
  } finally {
    setTwoFactorLoading(false);
  }
}

async function handleTwoFactorVerify(event) {
  event.preventDefault();
  if (twoFAState.loading) return;
  if (!(ui.twofaVerifyInput instanceof HTMLInputElement)) return;
  const code = ui.twofaVerifyInput.value.trim();
  if (!code) {
    showTwoFactorFeedback('Ingresa el código generado por tu aplicación 2FA.', 'error');
    return;
  }

  setTwoFactorLoading(true);
  clearTwoFactorFeedback();
  try {
    const res = await requestWithAuth('/api/account/2fa/enable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!res) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showTwoFactorFeedback(data?.error || 'El código proporcionado no es válido.', 'error');
      return;
    }
    twoFAState.enabled = true;
    twoFAState.backupCodes = Array.isArray(data?.backup_codes) ? data.backup_codes : [];
    renderTwoFactorStatus();
    if (ui.twofaSetupPanel) ui.twofaSetupPanel.hidden = true;
    renderBackupCodes(twoFAState.backupCodes);
    showTwoFactorFeedback(data?.message || 'Autenticación en dos pasos activada.', 'success');
  } catch (err) {
    console.error('[account] Error al activar 2FA', err);
    showTwoFactorFeedback('No se pudo activar la autenticación en dos pasos.', 'error');
  } finally {
    setTwoFactorLoading(false);
  }
}

async function handleTwoFactorDisable(event) {
  event.preventDefault();
  if (twoFAState.loading) return;
  const codeInput = ui.twofaDisableInput instanceof HTMLInputElement ? ui.twofaDisableInput.value.trim() : '';
  if (!codeInput) {
    showTwoFactorFeedback('Ingresa un código para desactivar la autenticación en dos pasos.', 'error');
    return;
  }

  setTwoFactorLoading(true);
  clearTwoFactorFeedback();
  try {
    const res = await requestWithAuth('/api/account/2fa/disable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: codeInput }),
    });
    if (!res) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showTwoFactorFeedback(data?.error || 'No se pudo desactivar la autenticación en dos pasos.', 'error');
      return;
    }
    twoFAState.enabled = false;
    twoFAState.secret = null;
    twoFAState.otpauthUrl = null;
    twoFAState.qrImage = null;
    twoFAState.backupCodes = [];
    if (ui.twofaDisableForm) {
      ui.twofaDisableForm.hidden = true;
      ui.twofaDisableForm.reset();
    }
    renderTwoFactorStatus();
    renderBackupCodes([]);
    showTwoFactorFeedback(data?.message || 'Autenticación en dos pasos desactivada.', 'success');
    await loadTwoFactorStatus();
  } catch (err) {
    console.error('[account] Error al desactivar 2FA', err);
    showTwoFactorFeedback('No se pudo desactivar la autenticación en dos pasos.', 'error');
  } finally {
    setTwoFactorLoading(false);
  }
}

async function handleTwoFactorRegenerate(event) {
  event.preventDefault();
  if (twoFAState.loading) return;
  const codeInput = ui.twofaRegenerateInput instanceof HTMLInputElement ? ui.twofaRegenerateInput.value.trim() : '';
  if (!codeInput) {
    showTwoFactorFeedback('Ingresa un código para regenerar los códigos de respaldo.', 'error');
    return;
  }

  setTwoFactorLoading(true);
  clearTwoFactorFeedback();
  try {
    const res = await requestWithAuth('/api/account/2fa/backup-codes/regenerate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: codeInput }),
    });
    if (!res) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showTwoFactorFeedback(data?.error || 'No se pudieron regenerar los códigos de respaldo.', 'error');
      return;
    }
    twoFAState.backupCodes = Array.isArray(data?.backup_codes) ? data.backup_codes : [];
    if (ui.twofaRegenerateForm) {
      ui.twofaRegenerateForm.hidden = true;
      ui.twofaRegenerateForm.reset();
    }
    renderBackupCodes(twoFAState.backupCodes);
    showTwoFactorFeedback(data?.message || 'Códigos de respaldo regenerados.', 'success');
  } catch (err) {
    console.error('[account] Error al regenerar códigos de respaldo', err);
    showTwoFactorFeedback('No se pudieron regenerar los códigos de respaldo.', 'error');
  } finally {
    setTwoFactorLoading(false);
  }
}

function bindTwoFactorSection() {
  if (twoFAState.bound) return;
  twoFAState.bound = true;

  if (ui.twofaSetupButton) {
    on(ui.twofaSetupButton, 'click', async (event) => {
      event.preventDefault();
      await startTwoFactorSetup();
    });
  }
  if (ui.twofaVerifyForm) {
    on(ui.twofaVerifyForm, 'submit', handleTwoFactorVerify);
  }
  if (ui.twofaShowDisable) {
    on(ui.twofaShowDisable, 'click', (event) => {
      event.preventDefault();
      if (ui.twofaDisableForm) {
        ui.twofaDisableForm.hidden = !ui.twofaDisableForm.hidden;
        if (!ui.twofaDisableForm.hidden && ui.twofaRegenerateForm) ui.twofaRegenerateForm.hidden = true;
        const input = ui.twofaDisableForm.querySelector('input');
        if (input instanceof HTMLInputElement) input.focus();
      }
    });
  }
  if (ui.twofaShowRegenerate) {
    on(ui.twofaShowRegenerate, 'click', (event) => {
      event.preventDefault();
      if (ui.twofaRegenerateForm) {
        ui.twofaRegenerateForm.hidden = !ui.twofaRegenerateForm.hidden;
        if (!ui.twofaRegenerateForm.hidden && ui.twofaDisableForm) ui.twofaDisableForm.hidden = true;
        const input = ui.twofaRegenerateForm.querySelector('input');
        if (input instanceof HTMLInputElement) input.focus();
      }
    });
  }
  if (ui.twofaDisableForm) {
    on(ui.twofaDisableForm, 'submit', handleTwoFactorDisable);
    const cancel = ui.twofaDisableForm.querySelector('[data-twofa-cancel]');
    if (cancel instanceof HTMLButtonElement) {
      on(cancel, 'click', (event) => {
        event.preventDefault();
        ui.twofaDisableForm.hidden = true;
        ui.twofaDisableForm.reset();
      });
    }
  }
  if (ui.twofaRegenerateForm) {
    on(ui.twofaRegenerateForm, 'submit', handleTwoFactorRegenerate);
    const cancel = ui.twofaRegenerateForm.querySelector('[data-twofa-cancel]');
    if (cancel instanceof HTMLButtonElement) {
      on(cancel, 'click', (event) => {
        event.preventDefault();
        ui.twofaRegenerateForm.hidden = true;
        ui.twofaRegenerateForm.reset();
      });
    }
  }
}

function resetTwoFactor() {
  twoFAState.loading = false;
  twoFAState.secret = null;
  twoFAState.otpauthUrl = null;
  twoFAState.qrImage = null;
  twoFAState.backupCodes = [];
  if (ui.twofaSetupPanel) ui.twofaSetupPanel.hidden = true;
  if (ui.twofaEnabledActions) ui.twofaEnabledActions.hidden = true;
  if (ui.twofaBackupCodes) ui.twofaBackupCodes.hidden = true;
  if (ui.twofaQr instanceof HTMLImageElement) ui.twofaQr.src = '';
  if (ui.twofaSecret) ui.twofaSecret.textContent = '';
  if (ui.twofaVerifyForm) ui.twofaVerifyForm.reset();
  if (ui.twofaDisableForm) ui.twofaDisableForm.reset();
  if (ui.twofaRegenerateForm) ui.twofaRegenerateForm.reset();
  if (ui.twofaFeedback) {
    ui.twofaFeedback.textContent = '';
    ui.twofaFeedback.hidden = true;
    ui.twofaFeedback.removeAttribute('data-variant');
  }
  renderTwoFactorStatus();
  renderBackupCodes([]);
}

export function createTwoFactorSection() {
  return {
    init: bindTwoFactorSection,
    load: loadTwoFactorStatus,
    reset: resetTwoFactor,
  };
}
