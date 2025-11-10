import { qs } from '../lib/dom.js';
import { on } from '../lib/events.js';
import { contactValidators, validate } from '../lib/validators.js';
import { safeFetch } from './core/http.js';
import { toast } from './core/toast.js';

export function initContactForm() {
  const form = qs('#contact-form');
  if (!form) return;
  const errorName = qs('#error-contact-name', form);
  const errorEmail = qs('#error-contact-email', form);
  const errorMessage = qs('#error-contact-message', form);
  const fieldErrors = { name: errorName, email: errorEmail, message: errorMessage };
  const globalError = qs('#contact-form-errors', form);

  function hideFieldError(target) {
    if (target instanceof HTMLElement) {
      target.textContent = '';
      target.hidden = true;
    }
  }
  function renderErrors(errors, targets = {}) {
    let hasError = false;
    Object.entries(targets).forEach(([key, node]) => {
      const msg = errors?.[key];
      if (node instanceof HTMLElement) {
        if (msg) {
          hasError = true;
          node.textContent = msg;
          node.hidden = false;
        } else hideFieldError(node);
      }
    });
    return hasError;
  }

  function showGlobalMessage(message) {
    if (!globalError) return;
    globalError.textContent = message;
    globalError.hidden = false;
  }

  on(form, 'submit', async (event) => {
    event.preventDefault();
    const submitBtn = qs('button[type="submit"]', form);
    const originalLabel = submitBtn?.textContent || 'Enviar';
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Enviando...'; }

    try {
      const values = {
        name: qs('#contact-name', form)?.value?.trim() || '',
        email: qs('#contact-email', form)?.value?.trim() || '',
        message: qs('#contact-message', form)?.value?.trim() || '',
      };

      const errors = validate(contactValidators, values);
      if (renderErrors(errors, fieldErrors)) { return; }

      const res = await safeFetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) }, 5000);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(data.message || 'Mensaje enviado. Gracias por escribirnos.');
        form.reset();
        return;
      }
      if (data?.fields && typeof data.fields === 'object') {
        renderErrors({ name: data.fields.name || '', email: data.fields.email || '', message: data.fields.message || '' }, fieldErrors);
      }
      const errorMsg = data.error || 'No se pudo enviar tu mensaje.';
      if (!globalError) toast.error(errorMsg); else showGlobalMessage(errorMsg);
    } catch (err) {
      console.error('Contact request failed', err);
      toast.error('Error de red al enviar tu mensaje.');
      showGlobalMessage('No se pudo enviar el mensaje. Intenta nuevamente.');
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalLabel; }
    }
  });
}

