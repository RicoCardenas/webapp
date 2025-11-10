import { qs } from '../../lib/dom.js';
import { on } from '../../lib/events.js';
import { authValidators, validate } from '../../lib/validators.js';
import { toast } from '../core/toast.js';
import { safeFetch } from '../core/http.js';

export function initForgotPassword() {
  const forgotForm = qs('#forgot-form');
  if (!forgotForm) return;
  const emailInput = qs('#forgot-email', forgotForm);
  const submitBtn = qs('button[type="submit"]', forgotForm);
  const errorEmail = qs('#error-forgot-email', forgotForm);

  on(forgotForm, 'submit', async (event) => {
    event.preventDefault();
    if (!emailInput || !submitBtn) return;
    const values = { email: emailInput.value };
    const errors = validate({ email: authValidators.email }, values);
    if (errorEmail) {
      if (errors.email) { errorEmail.textContent = errors.email; errorEmail.hidden = false; }
      else { errorEmail.textContent = ''; errorEmail.hidden = true; }
    }
    if (errors.email) return;
    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando...';
    try {
      const res = await safeFetch('/api/password/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: values.email }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(data.message || 'Si existe una cuenta con ese correo, enviaremos instrucciones.', 8000);
        forgotForm.reset();
        if (errorEmail) { errorEmail.textContent = ''; errorEmail.hidden = true; }
      } else {
        toast.error(data.error || 'No se pudo enviar la solicitud de restablecimiento.');
      }
    } catch (error) {
      console.error('Password reset request failed', error);
      toast.error('Error de red.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel || 'Enviar instrucciones';
    }
  });
}

