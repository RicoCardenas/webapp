const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    return value && value.length >= 8 ? '' : 'La contraseña debe tener al menos 8 caracteres';
  },
  loginPassword(value) {
    return value && value.length > 0 ? '' : 'Ingresa tu contraseña';
  },
  name(value) {
    return value && value.length >= 2 ? '' : 'El nombre debe tener al menos 2 caracteres';
  },
  terms(checked) {
    return checked ? '' : 'Debes aceptar los términos';
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
    errors[key] = validator(values[key]);
  }
  return /** @type {Record<keyof T, string>} */ (errors);
}
