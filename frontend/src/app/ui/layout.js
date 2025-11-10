import { qs, qsa, toggleClass, setAria, toggleAriaExpanded } from '../../lib/dom.js';
import { on } from '../../lib/events.js';
import { initThemeSync, setThemePreference, getThemePreference } from '../../lib/theme.js';

export function initLayout() {
  initThemeSync();
  bindThemeSelector();
  DrawerController.bind();
}

function bindThemeSelector() {
  const switcher = qs('[data-theme-switcher]');
  if (!switcher) return;
  const trigger = qs('[data-theme-menu-trigger]', switcher);
  const menu = qs('[data-theme-menu]', switcher);
  if (!trigger || !menu) return;
  const options = Array.from(qsa('[data-theme-option]', menu)).filter((n) => n instanceof HTMLElement);
  if (!options.length) return;
  let isOpen = false;
  const closeMenu = () => { if (!isOpen) return; isOpen = false; menu.hidden = true; trigger.setAttribute('aria-expanded','false'); };
  const openMenu = () => { if (isOpen) return; isOpen = true; menu.hidden = false; trigger.setAttribute('aria-expanded','true'); const active = options.find((opt) => opt.getAttribute('aria-checked')==='true'); (active || options[0]).focus({ preventScroll:true }); };
  const toggleMenu = () => (isOpen ? closeMenu() : openMenu());
  const THEME_LABELS = { light: 'Tema claro', dark: 'Tema oscuro', system: 'Tema según el sistema' };
  const describeSelection = (pref) => { const label = THEME_LABELS[pref] || 'Tema'; trigger.setAttribute('aria-label', `${label}. Cambiar tema`); trigger.dataset.themeCurrent = pref; };
  const updateActive = () => { const pref = getThemePreference(); options.forEach((opt)=>{ const value = opt.dataset.themeOption || ''; const isActive = value===pref; opt.setAttribute('aria-checked', String(isActive)); opt.classList.toggle('is-active', isActive); }); describeSelection(pref); };
  on(trigger,'click',(e)=>{ e.preventDefault(); toggleMenu(); });
  on(trigger,'keydown',(e)=>{ if(e.key==='ArrowDown'||e.key==='Enter'||e.key===' '){ e.preventDefault(); openMenu(); } if(e.key==='Escape'){ e.preventDefault(); closeMenu(); }});
  options.forEach((option)=>{
    on(option,'click', (e)=>{ e.preventDefault(); const pref = option.dataset.themeOption || 'system'; setThemePreference(pref); updateActive(); closeMenu(); });
    on(option,'keydown',(e)=>{ if(e.key==='Escape'){ e.preventDefault(); closeMenu(); trigger.focus(); } });
  });
  on(document,'click',(e)=>{ if(!isOpen) return; if(e.target instanceof Node && !switcher.contains(e.target)) closeMenu(); });
  on(document,'keydown',(e)=>{ if(isOpen && e.key==='Escape'){ e.preventDefault(); closeMenu(); trigger.focus(); } });
  updateActive();
}

// Simple drawer controller for mobile nav
const DrawerController = (()=>{
  let drawer, toggleBtn, overlay, openerBtn = null;
  function bind(){
    drawer = qs('#mobile-drawer');
    toggleBtn = qs('[data-drawer-toggle]');
    overlay = qs('.drawer__overlay', drawer || undefined);
    const closeBtn = drawer ? qs('.drawer__close', drawer) : null;
    if(!drawer || !toggleBtn) return;
    on(toggleBtn,'click',open);
    on(overlay,'click',close);
    on(closeBtn,'click',close);
    on(document,'keydown',(e)=>{ if(drawer?.classList.contains('is-open') && e.key==='Escape') close(); });
  }
  function open(){ if(!drawer || !toggleBtn) return; openerBtn = document.activeElement; toggleClass(drawer,'is-open',true); setAria(drawer,{hidden:false}); toggleAriaExpanded(toggleBtn,true); const panel = qs('.drawer__overlay', drawer)?.nextElementSibling; if(panel instanceof HTMLElement) panel.focus?.(); (qs('.drawer__link', drawer) || drawer).focus?.({ preventScroll:true }); }
  function close(){ if(!drawer || !toggleBtn) return; toggleClass(drawer,'is-open',false); setAria(drawer,{hidden:true}); toggleAriaExpanded(toggleBtn,false); openerBtn?.focus?.({ preventScroll:true }); openerBtn=null; }
  return { bind, open, close };
})();

