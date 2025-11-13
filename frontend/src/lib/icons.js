/**
 * Icon library - SVG icons optimized for performance
 * Replaces PNG icons with scalable, lightweight SVGs
 */

export const icons = {
  // Close icon (✕)
  close: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>`,

  // Hamburger menu icon (☰)
  menu: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="3" y1="6" x2="21" y2="6"></line>
    <line x1="3" y1="12" x2="21" y2="12"></line>
    <line x1="3" y1="18" x2="21" y2="18"></line>
  </svg>`,

  // Login icon (arrow into box)
  login: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
    <polyline points="10 17 15 12 10 7"></polyline>
    <line x1="15" y1="12" x2="3" y2="12"></line>
  </svg>`,

  // Logout icon (arrow out of box)
  logout: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
    <polyline points="16 17 21 12 16 7"></polyline>
    <line x1="21" y1="12" x2="9" y2="12"></line>
  </svg>`,

  // Sign up icon (user plus)
  signup: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
    <circle cx="8.5" cy="7" r="4"></circle>
    <line x1="20" y1="8" x2="20" y2="14"></line>
    <line x1="23" y1="11" x2="17" y2="11"></line>
  </svg>`,

  // User icon (account)
  user: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
    <circle cx="12" cy="7" r="4"></circle>
  </svg>`,

  // Sun icon (light mode)
  sun: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="5"></circle>
    <line x1="12" y1="1" x2="12" y2="3"></line>
    <line x1="12" y1="21" x2="12" y2="23"></line>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
    <line x1="1" y1="12" x2="3" y2="12"></line>
    <line x1="21" y1="12" x2="23" y2="12"></line>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
  </svg>`,

  // Moon icon (dark mode)
  moon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
  </svg>`,

  // Eye icon (show password)
  eye: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>`,

  // Eye off icon (hide password)
  eyeOff: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
    <line x1="1" y1="1" x2="23" y2="23"></line>
  </svg>`,
};

/**
 * Get an icon SVG string by name
 * @param {string} name - Icon name from the icons object
 * @returns {string} SVG markup
 */
export function getIcon(name) {
  return icons[name] || '';
}

/**
 * Insert an icon into a DOM element
 * @param {HTMLElement} element - Target element
 * @param {string} iconName - Icon name
 * @param {Object} options - Optional attributes (class, style, etc.)
 */
export function insertIcon(element, iconName, options = {}) {
  const svg = getIcon(iconName);
  if (!svg) {
    console.warn(`Icon "${iconName}" not found`);
    return;
  }
  
  // Limpiar contenido previo
  element.innerHTML = '';
  
  // Crear un div temporal para parsear el SVG
  const temp = document.createElement('div');
  temp.innerHTML = svg.trim();
  const svgElement = temp.querySelector('svg');
  
  if (!svgElement) {
    console.warn(`Invalid SVG for icon "${iconName}"`);
    return;
  }
  
  // Apply optional attributes to the SVG element
  if (options) {
    Object.entries(options).forEach(([key, value]) => {
      if (key === 'class') {
        svgElement.classList.add(...value.split(' '));
      } else {
        svgElement.setAttribute(key, value);
      }
    });
  }
  
  // Insertar el SVG en el elemento
  element.appendChild(svgElement);
}

/**
 * Replace all icon images with SVG equivalents
 * Maps PNG filenames to icon names
 * Handles theme-specific variants (light/dark)
 */
export function replaceIconImages() {
  const iconMap = {
    'closeclaro.png': 'close',
    'closeoscuro.png': 'close',
    'hamburgwhite.png': 'menu',
    'hamburgblack.png': 'menu',
    'loginclaro.png': 'login',
    'loginoscuro.png': 'login',
    'logoutclaro.png': 'logout',
    'logoutoscuro.png': 'logout',
    'signinclaro.png': 'signup',
    'signinoscuro.png': 'signup',
    'userclaro.png': 'user',
    'useroscuro.png': 'user',
    'sol.png': 'sun',
    'luna.png': 'moon',
    'seepassword.png': 'eye',
    'hidepassword.png': 'eyeOff',
  };

  // Track processed parent containers to avoid duplicates
  const processedContainers = new WeakSet();

  // Find all icon images
  const images = Array.from(document.querySelectorAll('img[src*="/static/images/"]'));
  
  images.forEach(img => {
    const filename = img.src.split('/').pop();
    const iconName = iconMap[filename];
    
    if (!iconName) return;

    const parent = img.parentNode;
    if (!parent) return;

    // Si el contenedor ya fue procesado, skip
    if (processedContainers.has(parent)) return;

    // Detectar si hay variantes claro/oscuro en el mismo contenedor
    const siblings = Array.from(parent.querySelectorAll('img[src*="/static/images/"]'));
    const variantImages = siblings.filter(sibling => {
      const siblingFilename = sibling.src.split('/').pop();
      return iconMap[siblingFilename] === iconName;
    });

    // Si hay múltiples variantes (claro/oscuro), usar solo una con SVG
    if (variantImages.length > 1) {
      // Crear un único SVG que heredará color del contexto
      const wrapper = document.createElement('span');
      wrapper.className = 'btn__icon-svg';
      wrapper.setAttribute('aria-hidden', 'true');
      
      // Copiar clases del primer icono (sin --light/--dark)
      const firstImg = variantImages[0];
      const classes = firstImg.className
        .split(' ')
        .filter(cls => !cls.includes('--light') && !cls.includes('--dark'))
        .join(' ');
      
      if (classes) {
        wrapper.className = classes.replace('btn__icon-img', 'btn__icon-svg');
      }
      
      insertIcon(wrapper, iconName);
      
      // Reemplazar el primer icono con el SVG
      firstImg.parentNode.replaceChild(wrapper, firstImg);
      
      // Eliminar los demás (variantes de tema)
      variantImages.slice(1).forEach(variant => {
        if (variant.parentNode) {
          variant.parentNode.removeChild(variant);
        }
      });
      
      processedContainers.add(parent);
    } else {
      // Solo un icono, reemplazo simple
      const wrapper = document.createElement('span');
      wrapper.className = img.className.replace('btn__icon-img', 'btn__icon-svg');
      wrapper.setAttribute('aria-hidden', 'true');
      
      insertIcon(wrapper, iconName);
      img.parentNode.replaceChild(wrapper, img);
      processedContainers.add(parent);
    }
  });
}
