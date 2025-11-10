import { qs } from '../../lib/dom.js';
import { on } from '../../lib/events.js';
import { authValidators, validate } from '../../lib/validators.js';
import { toast } from '../core/toast.js';
import { safeFetch } from '../core/http.js';
import { bindPasswordToggles } from './forms.js';

function evaluatePasswordStrength(password) {
  if (!password) {
    return { level: 0, label: 'Sin contraseña', hint: 'Escribe una contraseña segura.' };
  }
  const checks = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/];
  let score = checks.reduce((acc, regex) => (regex.test(password) ? acc + 1 : acc), 0);
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;
  let level = 1;
  if (password.length < 8 || score <= 2) level = 1;
  else if (score === 3) level = 2;
  else if (score === 4) level = 3;
  else level = 4;
  const labels = { 0: 'Sin contraseña', 1: 'Débil', 2: 'Aceptable', 3: 'Buena', 4: 'Fuerte' };
  return { level, label: labels[level] || labels[1], hint: level >= 3 ? 'Contraseña segura.' : 'Usa mayúsculas, minúsculas, números y símbolos.' };
}

function createPasswordMeter(input, idSuffix) {
  if (!input) return null;
  const wrapper = document.createElement('div');
  wrapper.className = 'password-meter';
  const meterId = `${input.id || 'password'}-${idSuffix || 'strength'}`;
  wrapper.id = meterId;
  wrapper.setAttribute('role', 'status');
  wrapper.setAttribute('aria-live', 'polite');
  wrapper.setAttribute('aria-atomic', 'true');
  const bar = document.createElement('div');
  bar.className = 'password-meter__bar';
  const fill = document.createElement('div');
  fill.className = 'password-meter__fill';
  fill.setAttribute('aria-hidden', 'true');
  bar.appendChild(fill);
  const label = document.createElement('span');
  label.className = 'password-meter__label';
  label.textContent = 'Fortaleza: ';
  const value = document.createElement('strong');
  value.className = 'password-meter__value';
  label.appendChild(value);
  const hint = document.createElement('span');
  hint.className = 'password-meter__hint';
  wrapper.appendChild(bar); wrapper.appendChild(label); wrapper.appendChild(hint);
  const container = input.closest('.password-input');
  if (container instanceof HTMLElement) container.insertAdjacentElement('afterend', wrapper); else input.insertAdjacentElement('afterend', wrapper);
  const describedBy = input.getAttribute('aria-describedby');
  if (describedBy) { if (!describedBy.includes(meterId)) input.setAttribute('aria-describedby', `${describedBy} ${meterId}`.trim()); }
  else input.setAttribute('aria-describedby', meterId);
  const update = (password) => { const s = evaluatePasswordStrength(password); const clamped = Math.max(0, Math.min(4, s.level)); wrapper.dataset.strength = String(clamped); fill.style.transform = `scaleX(${clamped / 4})`; value.textContent = s.label; hint.textContent = s.hint; wrapper.setAttribute('aria-label', `Fortaleza de contraseña: ${s.label}. ${s.hint}`); return s; };
  update(input.value || '');
  return { update, element: wrapper };
}

export function initResetPasswordPage() {
  const form = qs('#reset-password-form');
  if (!form) return;
  const passwordInput = /** @type {HTMLInputElement|null} */ (qs('#reset-password', form));
  const confirmInput = /** @type {HTMLInputElement|null} */ (qs('#reset-password-confirm', form));
  const submitBtn = qs('button[type="submit"]', form);
  const tokenField = /** @type {HTMLInputElement|null} */ (qs('#reset-token', form));
  const errorPassword = qs('#error-reset-password', form);
  const errorConfirm = qs('#error-reset-password-confirm', form);
  const statusMessage = qs('#reset-password-status');

  bindPasswordToggles(form);

  const resetMeter = passwordInput ? createPasswordMeter(passwordInput, 'reset-strength') : null;
  if (resetMeter && passwordInput) {
    on(passwordInput, 'input', () => resetMeter.update(passwordInput.value));
    on(form, 'reset', () => resetMeter.update(passwordInput.value || ''));
  }
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (!token) {
    if (statusMessage) { statusMessage.textContent = 'El enlace de restablecimiento no es válido.'; statusMessage.classList.add('status-message', 'status-message--error'); }
    if (submitBtn) submitBtn.disabled = true; return;
  }
  if (tokenField) tokenField.value = token;

  const setFieldError = (node, message) => {
    if (!node) return;
    node.textContent = message;
    node.hidden = !message;
    node.setAttribute('aria-hidden', message ? 'false' : 'true');
  };

  on(form, 'submit', async (event) => {
    event.preventDefault();
    if (!passwordInput || !confirmInput || !tokenField || !(submitBtn instanceof HTMLButtonElement)) return;

    const values = {
      password: passwordInput.value || '',
      password_confirm: confirmInput.value || '',
    };

    const errors = validate({
      password: authValidators.password,
      password_confirm: authValidators.passwordConfirm,
    }, values);

    setFieldError(errorPassword, errors.password);
    setFieldError(errorConfirm, errors.password_confirm);

    if (errors.password || errors.password_confirm) return;

    submitBtn.disabled = true;
    const originalLabel = submitBtn.textContent;
    submitBtn.textContent = 'Actualizando...';
    if (statusMessage) {
      statusMessage.textContent = '';
      statusMessage.classList.add('status-message');
      statusMessage.classList.remove('status-message--error', 'status-message--success');
    }

    try {
      const payload = {
        token: tokenField.value.trim(),
        password: values.password,
        password_confirm: values.password_confirm,
      };
      const res = await safeFetch('/api/password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, 8000);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const message = data?.error || 'No se pudo restablecer la contraseña.';
        if (statusMessage) {
          statusMessage.textContent = message;
          statusMessage.classList.add('status-message');
          statusMessage.classList.remove('status-message--success');
          statusMessage.classList.add('status-message--error');
        }
        toast.error(message);
        return;
      }

      toast.success(data?.message || 'Contraseña actualizada. Usa tu nueva contraseña para ingresar.');
      if (statusMessage) {
        statusMessage.textContent = data?.message || 'Contraseña actualizada correctamente.';
        statusMessage.classList.add('status-message');
        statusMessage.classList.remove('status-message--error');
        statusMessage.classList.add('status-message--success');
      }
      form.reset();
      resetMeter?.update('');
      try {
        setTimeout(() => { window.location.href = '/login'; }, 1500);
      } catch {}
    } catch (error) {
      console.error('Password reset failed', error);
      const message = 'No se pudo restablecer la contraseña. Intenta de nuevo.';
      if (statusMessage) {
        statusMessage.textContent = message;
        statusMessage.classList.add('status-message');
        statusMessage.classList.remove('status-message--success');
        statusMessage.classList.add('status-message--error');
      }
      toast.error(message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel || 'Actualizar contraseña';
    }
  });
}

