"""
Servicio de validación y normalización de datos.
"""


def normalize_email(value):
    """
    Normaliza una dirección de email removiendo espacios y convirtiendo a minúsculas.
    
    Args:
        value: Email a normalizar
        
    Returns:
        Email normalizado en minúsculas sin espacios
    """
    return (value or "").strip().lower()


def validate_contact_submission(name, email, message):
    """
    Valida los datos de un formulario de contacto.
    
    Args:
        name: Nombre del contacto
        email: Email del contacto
        message: Mensaje del contacto
        
    Returns:
        Diccionario con errores de validación, vacío si todo es válido
    """
    errors = {}
    if len(name) < 2:
        errors['name'] = 'Ingresa tu nombre (mínimo 2 caracteres).'
    if not email or '@' not in email:
        errors['email'] = 'Proporciona un correo válido.'
    if len(message) < 10:
        errors['message'] = 'El mensaje debe tener al menos 10 caracteres.'
    return errors
