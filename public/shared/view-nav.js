// View switcher — links to configured operator views (status bar, top right).

const GEAR_ICON = `<svg class="view-nav-gear-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`;

export function mountViewNav(viewId, views, { settingsActive = false } = {}) {
  const bar = document.getElementById('status-bar');
  if (!bar || !views?.length) return;

  let nav = bar.querySelector('.view-nav');
  if (!nav) {
    nav = document.createElement('nav');
    nav.className = 'view-nav';
    nav.setAttribute('aria-label', 'Views');
    bar.appendChild(nav);
  }

  nav.replaceChildren();
  for (const view of views) {
    const link = document.createElement('a');
    link.href = `/views/${encodeURIComponent(view.id)}`;
    link.textContent = view.title ?? view.id;
    if (!settingsActive && view.id === viewId) {
      link.className = 'is-active';
      link.setAttribute('aria-current', 'page');
    }
    nav.appendChild(link);
  }

  const settingsLink = document.createElement('a');
  settingsLink.href = '/views/settings';
  settingsLink.className = 'view-nav-settings' + (settingsActive ? ' is-active' : '');
  settingsLink.setAttribute('aria-label', 'Settings');
  settingsLink.title = 'Settings';
  if (settingsActive) settingsLink.setAttribute('aria-current', 'page');
  settingsLink.innerHTML = GEAR_ICON;
  nav.appendChild(settingsLink);
}
