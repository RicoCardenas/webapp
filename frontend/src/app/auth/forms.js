import { qs } from '../../lib/dom.js';
import { on } from '../../lib/events.js';
import { authValidators, validate } from '../../lib/validators.js';
import { toast } from '../core/toast.js';
import { safeFetch } from '../core/http.js';
import { setSessionToken, clearSessionToken } from '../../lib/session.js';
import { eventStream } from '../core/stream.js';
import { setCurrentUser } from '../core/user-state.js';

function showFieldError(node, msg) { if (node) { node.textContent = msg || ''; node.hidden = !msg; } }

function evaluatePasswordStrength(password) {
  if (!password) return { level: 0, label: 'Sin contraseña', hint: 'Escribe una contraseña segura.' };
  const checks = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/];
  let score = checks.reduce((acc, rgx) => (rgx.test(password) ? acc + 1 : acc), 0);
  if (password.length >= 12) score += 1; if (password.length >= 16) score += 1;
  let level = 1; if (password.length < 8 || score <= 2) level = 1; else if (score === 3) level = 2; else if (score === 4) level = 3; else level = 4;
  const labels = { 0: 'Sin contraseña', 1: 'Débil', 2: 'Aceptable', 3: 'Buena', 4: 'Fuerte' }; return { level, label: labels[level] || labels[1], hint: level>=3?'Contraseña segura.':'Usa mayúsculas, minúsculas, números y símbolos.' };
}

function createPasswordMeter(input, idSuffix) {
  if (!input) return null;
  const wrapper = document.createElement('div'); wrapper.className='password-meter'; const meterId = `${input.id||'password'}-${idSuffix||'strength'}`; wrapper.id=meterId; wrapper.setAttribute('role','status'); wrapper.setAttribute('aria-live','polite'); wrapper.setAttribute('aria-atomic','true');
  const bar = document.createElement('div'); bar.className='password-meter__bar'; const fill=document.createElement('div'); fill.className='password-meter__fill'; fill.setAttribute('aria-hidden','true'); bar.appendChild(fill);
  const label=document.createElement('span'); label.className='password-meter__label'; label.textContent='Fortaleza: '; const value=document.createElement('strong'); value.className='password-meter__value'; label.appendChild(value); const hint=document.createElement('span'); hint.className='password-meter__hint';
  wrapper.appendChild(bar); wrapper.appendChild(label); wrapper.appendChild(hint);
  const container = input.closest('.password-input'); if (container instanceof HTMLElement) container.insertAdjacentElement('afterend', wrapper); else input.insertAdjacentElement('afterend', wrapper);
  const describedBy = input.getAttribute('aria-describedby'); if (describedBy) { if (!describedBy.includes(meterId)) input.setAttribute('aria-describedby', `${describedBy} ${meterId}`.trim()); } else input.setAttribute('aria-describedby', meterId);
  const update = (password) => { const s=evaluatePasswordStrength(password); const clamped=Math.max(0,Math.min(4,s.level)); wrapper.dataset.strength=String(clamped); fill.style.transform=`scaleX(${clamped/4})`; value.textContent=s.label; hint.textContent=s.hint; wrapper.setAttribute('aria-label',`Fortaleza de contraseña: ${s.label}. ${s.hint}`); return s; };
  update(input.value||'');
  return { update, element: wrapper };
}

export function initAuthForms() {
  const signupForm = qs('#signup-form');
  const loginForm = qs('#login-form');

  if (signupForm) {
    const signupErrors = {
      name: qs('#error-signup-name', signupForm),
      email: qs('#error-signup-email', signupForm),
      password: qs('#error-signup-password', signupForm),
      passwordConfirm: qs('#error-signup-password-confirm', signupForm),
      terms: qs('#error-signup-terms', signupForm),
      role: qs('#error-signup-role', signupForm),
    };
    const signupPasswordInput = qs('#signup-password', signupForm);
    const signupPasswordMeter = signupPasswordInput instanceof HTMLInputElement ? createPasswordMeter(signupPasswordInput,'signup-strength') : null;
    if (signupPasswordMeter && signupPasswordInput) on(signupPasswordInput,'input',()=> signupPasswordMeter.update(signupPasswordInput.value));
    on(signupForm,'submit', async (e)=>{
      e.preventDefault();
      const submitBtn = qs('button[type="submit"]', signupForm);
      const values = {
        name: qs('#signup-name', signupForm)?.value?.trim() || '',
        email: qs('#signup-email', signupForm)?.value?.trim() || '',
        password: qs('#signup-password', signupForm)?.value || '',
        passwordConfirm: qs('#signup-password-confirm', signupForm)?.value || '',
        terms: !!(qs('#signup-terms', signupForm)?.checked),
        role: (qs('input[name="signup-role"]:checked', signupForm)?.value) || '',
      };
      const signupSchema = {
        name: authValidators.name,
        email: authValidators.email,
        password: authValidators.password,
        passwordConfirm: authValidators.passwordConfirm,
        terms: authValidators.terms,
      };
  const errors = validate(signupSchema, values);
      errors.role = '';
      Object.entries(signupErrors).forEach(([k, node]) => showFieldError(node, errors?.[k] || ''));
      if (Object.values(errors).some(Boolean)) return;
      const originalLabel = submitBtn?.textContent || 'Crear cuenta'; if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creando...'; }
      try {
        const payload = {
          name: values.name,
          email: values.email,
          password: values.password,
          password_confirm: values.passwordConfirm,
          terms: values.terms,
          role: values.role,
        };
        // Puede tardar más si el servidor envía correo; damos un margen mayor para evitar abortar
        const res = await safeFetch('/api/register', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(payload) }, 20000);
        const data = await res.json().catch(()=>({}));
        if (res.ok) {
          toast.success(data.message || '¡Registro exitoso! Revisa tu correo.');
          signupForm.reset();
        } else {
          toast.error(data.error || 'No se pudo completar el registro.');
        }
      } catch (err) {
        console.error('Signup failed', err);
        if (err?.name === 'AbortError') {
          toast.error('El servidor tardó en responder. Revisa tu correo por si ya se creó la cuenta antes de reintentar para evitar duplicados.');
        } else {
          toast.error('Error de red.');
        }
      } finally { if (submitBtn) { submitBtn.disabled=false; submitBtn.textContent=originalLabel; } }
    });
  }

  if (loginForm) {
    const loginErrors = {
      email: qs('#error-login-email', loginForm),
      password: qs('#error-login-password', loginForm),
      otp: qs('#error-login-otp', loginForm),
    };
    const loginOtpField = qs('[data-otp-field]', loginForm);
    const loginOtpInput = /** @type {HTMLInputElement|null} */ (qs('#login-otp', loginForm));
    const loginOtpHelp = qs('[data-otp-help]', loginForm);

    const revealOtpField = (message) => {
      if (loginOtpField) {
        loginOtpField.hidden = false;
        loginOtpField.classList.add('is-visible');
      }
      if (loginOtpHelp) loginOtpHelp.hidden = false;
      showFieldError(loginErrors.otp, message || 'Ingresa el código de autenticación.');
      if (loginOtpInput instanceof HTMLInputElement) {
        requestAnimationFrame(() => {
          loginOtpInput.focus({ preventScroll: true });
          loginOtpInput.select();
        });
      }
    };

    const ensureOtpToast = (message) => {
      if (!loginForm) return;
      if (loginForm.dataset.otpToastShown === 'true') return;
      loginForm.dataset.otpToastShown = 'true';
      toast.info(message || 'Tu cuenta requiere un código 2FA. Ingresa el código de autenticación.');
    };

    on(loginForm, 'submit', async (e)=>{
      e.preventDefault();
      const submitBtn = qs('button[type="submit"]', loginForm);
      const values = {
        email: qs('#login-email', loginForm)?.value?.trim() || '',
        password: qs('#login-password', loginForm)?.value || '',
        otp: loginOtpInput?.value?.trim() || '',
      };
      const loginSchema = { email: authValidators.email, password: authValidators.loginPassword };
      const errors = validate(loginSchema, values);
      Object.entries(loginErrors).forEach(([k, node]) => showFieldError(node, errors?.[k] || ''));
      if (Object.values(errors).some(Boolean)) return;
      const originalLabel = submitBtn?.textContent || 'Iniciar sesión'; if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent='Ingresando...'; }
      try {
        const res = await safeFetch('/api/login', {
          method:'POST',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify(values),
        });
        const data = await res.json().catch(()=>({}));
        if (res.ok) {
          if (loginOtpField) {
            loginOtpField.hidden = true;
            loginOtpField.classList.remove('is-visible');
          }
          if (loginOtpHelp) loginOtpHelp.hidden = true;
          if (loginOtpInput) loginOtpInput.value = '';
          showFieldError(loginErrors.otp, '');
          if (loginForm?.dataset) delete loginForm.dataset.otpToastShown;
          setSessionToken();
          eventStream.ensure?.();
          setCurrentUser(data?.user || null);
          window.dispatchEvent(new CustomEvent('ecuplot:login'));
          toast.success(data.message || '¡Bienvenido de nuevo!');
          setTimeout(()=>{ window.location.href = '/account'; }, 200);
        } else {
          if (res.status === 401 && data?.requires_2fa) {
            ensureOtpToast(data?.error || 'Tu cuenta tiene 2FA. Ingresa el código para continuar.');
            revealOtpField(data?.error || 'Tu cuenta tiene 2FA. Ingresa el código para continuar.');
            return;
          }
          clearSessionToken();
          setCurrentUser(null);
          if (res.status === 403) {
            const message = data?.error || 'Tu cuenta aún no ha sido verificada. Revisa tu correo para activarla.';
            showFieldError(loginErrors.password, message);
            toast.error(message);
            return;
          }
          toast.error(data.error || 'No se pudo iniciar sesión.');
        }
      } catch (err) {
        console.error('Login failed', err);
        toast.error('Error de red.');
      } finally { if (submitBtn) { submitBtn.disabled=false; submitBtn.textContent=originalLabel; } }
    });
  }
  // Bind toggles de contraseña si existen
  bindPasswordToggles();
}

export function bindPasswordToggles(root = document) {
  const scope = root instanceof Element || root instanceof DocumentFragment ? root : document;
  const buttons = Array.from(scope.querySelectorAll('button.password-toggle[data-password-toggle]'));
  buttons.forEach((btn) => {
    const inputId = btn.getAttribute('data-password-toggle');
    if (!inputId) return;
    let input = null;
    if (scope instanceof Document) {
      input = scope.getElementById(inputId);
    }
    if (!input) {
      const escapedId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(inputId) : inputId;
      const selector = `#${escapedId}`;
      input = scope.querySelector(selector) || document.getElementById(inputId);
    }
    if (!(input instanceof HTMLInputElement)) return;
    const showIcon = btn.querySelector('[data-icon="show"]');
    const hideIcon = btn.querySelector('[data-icon="hide"]');
    const update = () => {
      const visible = input.type === 'text';
      if (showIcon instanceof HTMLElement) showIcon.hidden = visible;
      if (hideIcon instanceof HTMLElement) hideIcon.hidden = !visible;
      btn.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
    };
    update();
    on(btn, 'click', (e) => {
      e.preventDefault();
      input.type = input.type === 'password' ? 'text' : 'password';
      update();
      input.focus({ preventScroll: true });
    });
  });
}
