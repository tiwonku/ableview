/** Admin / session list of clip names that must not auto-match. */

export function renderDeadlistList({ clips, onAllowClip } = {}) {
  const list = Array.isArray(clips) ? clips.filter((entry) => entry?.norm) : [];
  if (!list.length || typeof document === 'undefined') return null;

  const section = document.createElement('section');
  section.className = 'deadlist';
  section.setAttribute('aria-label', "Clips that don't match");

  const title = document.createElement('h2');
  title.className = 'deadlist-title';
  title.textContent = "Don't match";
  section.appendChild(title);

  const hint = document.createElement('p');
  hint.className = 'deadlist-hint';
  hint.textContent = 'These clips stay off the cue sheet until you allow them.';
  section.appendChild(hint);

  const items = document.createElement('ul');
  items.className = 'deadlist-items';
  for (const entry of list) {
    const row = document.createElement('li');
    row.className = 'deadlist-item';
    const name = document.createElement('span');
    name.className = 'deadlist-name';
    name.textContent = entry.clipName || entry.norm;
    row.appendChild(name);
    if (typeof onAllowClip === 'function') {
      const allowBtn = document.createElement('button');
      allowBtn.type = 'button';
      allowBtn.className = 'deadlist-allow';
      allowBtn.textContent = 'Allow';
      allowBtn.title = 'Let this clip match the cue sheet again';
      allowBtn.addEventListener('click', () => onAllowClip(entry.norm));
      row.appendChild(allowBtn);
    }
    items.appendChild(row);
  }
  section.appendChild(items);
  return section;
}
