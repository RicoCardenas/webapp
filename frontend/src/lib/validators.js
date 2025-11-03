const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_POLICY_MESSAGE = 'La contraseña debe tener al menos 8 caracteres, e incluir una letra mayúscula, una letra minúscula, un número y un carácter especial.';
const PASSWORD_COMPLEXITY_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{8,}$/;
const TOTP_CODE_RE = /^\d{6}$/;
const BACKUP_CODE_RE = /^[A-Za-z0-9]{8,16}$/;

export const contactValidators = {
  name(value) {
    return value && value.trim().length >= 2 ? '' : 'Ingresa tu nombre (mín. 2 caracteres)';
  },
  email(value) {
    return EMAIL_RE.test(value || '') ? '' : 'Ingresa un correo válido';
  },
  message(value) {
    return value && value.trim().length >= 10 ? '' : 'Escribe un mensaje (mín. 10 caracteres)';
  },
};

export const authValidators = {
  email(value) {
    return EMAIL_RE.test(value || '') ? '' : 'Ingresa un correo válido';
  },
  password(value) {
    return PASSWORD_COMPLEXITY_RE.test(value || '') ? '' : PASSWORD_POLICY_MESSAGE;
  },
  loginPassword(value) {
    return value && value.length > 0 ? '' : 'Ingresa tu contraseña';
  },
  passwordConfirm(value, values = {}) {
    if (!value) return 'Confirma tu contraseña';
    if (value !== values.password) return 'Las contraseñas no coinciden';
    return '';
  },
  name(value) {
    return value && value.length >= 2 ? '' : 'El nombre debe tener al menos 2 caracteres';
  },
  terms(checked) {
    return checked ? '' : 'Debes aceptar los términos';
  },
  otp(value) {
    const code = (value || '').trim();
    if (!code) return 'Ingresa el código de verificación';
    if (TOTP_CODE_RE.test(code) || BACKUP_CODE_RE.test(code)) return '';
    return 'Ingresa un código de 6 dígitos o un código de respaldo válido';
  },
};

/**
 * @template T 
 * @param {Record<keyof T, (value: T[keyof T]) => string>} schema
 * @param {T} values
 * @returns {Record<keyof T, string>}
 */
export function validate(schema, values) {
  /** @type {Record<string, string>} */
  const errors = {};
  for (const [key, validator] of Object.entries(schema)) {
    errors[key] = validator(values[key], values);
  }
  return /** @type {Record<keyof T, string>} */ (errors);
}
