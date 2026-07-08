// View switcher — links to configured operator views (status bar, top right).

export function mountViewNav(viewId, views) {
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
    if (view.id === viewId) {
      link.className = 'is-active';
      link.setAttribute('aria-current', 'page');
    }
    nav.appendChild(link);
  }
}
