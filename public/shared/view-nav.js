// View switcher — links to configured operator views (status bar, top right).

import { withKioskQuery } from './kiosk-controls.js';

const GEAR_ICON = `<svg class="view-nav-gear-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`;

export function viewIdFromPath(pathname) {
  const parts = String(pathname ?? '').split('/').filter(Boolean);
  if (parts[0] !== 'views' || !parts[1]) return null;
  return decodeURIComponent(parts[1]);
}

function bindNavClick(link, id, onNavigate) {
  if (!onNavigate) return;
  link.addEventListener('click', (event) => {
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (onNavigate(id, link.href) === false) event.preventDefault();
  });
}

export function mountViewNav(viewId, views, { settingsActive = false, search, onNavigate } = {}) {
  const bar = document.getElementById('status-bar');
  if (!bar || !views?.length) return;

  let nav = bar.querySelector('.view-nav');
  if (!nav) {
    nav = document.createElement('nav');
    nav.className = 'view-nav';
    nav.setAttribute('aria-label', 'Views');
    const kiosk = bar.querySelector('.kiosk-controls');
    if (kiosk) bar.insertBefore(nav, kiosk);
    else bar.appendChild(nav);
  }

  nav.replaceChildren();
  for (const view of views) {
    const link = document.createElement('a');
    link.href = withKioskQuery(`/views/${encodeURIComponent(view.id)}`, search);
    link.textContent = view.title ?? view.id;
    if (!settingsActive && view.id === viewId) {
      link.className = 'is-active';
      link.setAttribute('aria-current', 'page');
    }
    bindNavClick(link, view.id, onNavigate);
    nav.appendChild(link);
  }

  const settingsLink = document.createElement('a');
  settingsLink.href = withKioskQuery('/views/settings', search);
  settingsLink.className = 'view-nav-settings' + (settingsActive ? ' is-active' : '');
  settingsLink.setAttribute('aria-label', 'Settings');
  settingsLink.title = 'Settings';
  if (settingsActive) settingsLink.setAttribute('aria-current', 'page');
  settingsLink.innerHTML = GEAR_ICON;
  bindNavClick(settingsLink, 'settings', onNavigate);
  nav.appendChild(settingsLink);
}
