// Manual simulation controls on admin (internal sim mode).

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function mountSimControls(rootSelector) {
  const root = document.querySelector(rootSelector);
  if (!root) return { setVisible() {} };

  let visible = false;
  let status = null;
  let simStatus = null;
  let banner = null;

  async function loadStatus() {
    const res = await fetch('/api/sim/status');
    if (!res.ok) return null;
    simStatus = await res.json();
    return simStatus;
  }

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Request failed');
    if (data.status) simStatus = data.status;
    return data;
  }

  function render() {
    root.innerHTML = '';
    root.hidden = !visible;

    if (!visible) return;

    const section = el('section', 'sim-controls');
    section.appendChild(el('h2', 'section-title', 'Simulation controls'));

    const stateLine = el('p', 'sim-controls-state');
    if (simStatus?.canAutoAdvance) {
      stateLine.textContent = simStatus.paused
        ? 'Auto-advance paused'
        : 'Auto-advance running';
    } else {
      stateLine.textContent = 'Manual driver — fire clips on demand';
    }
    section.appendChild(stateLine);

    if (banner?.message) {
      section.appendChild(el('div', `sim-controls-status ${banner.ok ? 'ok' : 'err'}`, banner.message));
    }

    if (simStatus?.canAutoAdvance) {
      const transport = el('div', 'sim-controls-transport');

      const pauseBtn = el(
        'button',
        'sim-controls-transport-btn',
        simStatus.paused ? 'Resume auto' : 'Pause auto',
      );
      pauseBtn.type = 'button';
      pauseBtn.addEventListener('click', () => runAction(async () => {
        if (simStatus?.paused) {
          await postJson('/api/sim/resume');
          banner = { ok: true, message: 'Auto-advance resumed.' };
        } else {
          await postJson('/api/sim/pause');
          banner = { ok: true, message: 'Auto-advance paused.' };
        }
      }));
      transport.appendChild(pauseBtn);

      const prevBtn = el('button', 'sim-controls-transport-btn', 'Previous');
      prevBtn.type = 'button';
      prevBtn.addEventListener('click', () => runAction(async () => {
        const data = await postJson('/api/sim/step', { direction: 'prev' });
        banner = { ok: true, message: `Previous: ${data.authoritativeClip ?? 'nothing playing'}` };
      }));
      transport.appendChild(prevBtn);

      const nextBtn = el('button', 'sim-controls-transport-btn', 'Next');
      nextBtn.type = 'button';
      nextBtn.addEventListener('click', () => runAction(async () => {
        const data = await postJson('/api/sim/step', { direction: 'next' });
        banner = { ok: true, message: `Next: ${data.authoritativeClip ?? 'nothing playing'}` };
      }));
      transport.appendChild(nextBtn);

      section.appendChild(transport);
    }

    const form = el('form', 'sim-controls-form');
    form.noValidate = true;

    if (simStatus?.clipNames?.length) {
      const picker = el('select');
      picker.name = 'clipPicker';
      picker.className = 'sim-controls-input sim-controls-select';

      const placeholder = el('option');
      placeholder.value = '';
      placeholder.textContent = 'Pick a clip…';
      picker.appendChild(placeholder);

      for (const name of simStatus.clipNames) {
        const option = el('option');
        option.value = name;
        option.textContent = name;
        picker.appendChild(option);
      }

      form.appendChild(fieldRow('From list', picker));

      const pickRow = el('div', 'sim-controls-actions');
      const pickFireBtn = el('button', 'sim-controls-fire', 'Fire selected');
      pickFireBtn.type = 'button';
      pickFireBtn.addEventListener('click', () => runAction(async () => {
        const clipName = picker.value.trim();
        if (!clipName) {
          banner = { ok: false, message: 'Select a clip from the list.' };
          render();
          return;
        }
        const data = await postJson('/api/sim/fire', { clipName });
        banner = { ok: true, message: `Fired: ${data.authoritativeClip}` };
      }));
      pickRow.appendChild(pickFireBtn);
      form.appendChild(pickRow);
    }

    const clipInput = el('input');
    clipInput.type = 'text';
    clipInput.name = 'clipName';
    clipInput.className = 'sim-controls-input';
    clipInput.placeholder = 'Custom clip name';
    clipInput.autocomplete = 'off';

    form.appendChild(fieldRow('Custom clip', clipInput));

    const actions = el('div', 'sim-controls-actions');
    const fireBtn = el('button', 'sim-controls-fire', 'Fire custom');
    fireBtn.type = 'submit';
    const clearBtn = el('button', 'sim-controls-clear', 'Clear');
    clearBtn.type = 'button';
    actions.appendChild(fireBtn);
    actions.appendChild(clearBtn);
    form.appendChild(actions);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await runAction(async () => {
        const clipName = clipInput.value.trim();
        if (!clipName) {
          banner = { ok: false, message: 'Enter a clip name.' };
          return;
        }
        const data = await postJson('/api/sim/fire', { clipName });
        banner = { ok: true, message: `Fired: ${data.authoritativeClip}` };
      });
    });

    clearBtn.addEventListener('click', () => runAction(async () => {
      await postJson('/api/sim/clear');
      banner = { ok: true, message: 'Cleared — nothing playing.' };
    }));

    section.appendChild(form);
    root.appendChild(section);
  }

  async function runAction(fn) {
    banner = null;
    root.querySelectorAll('button').forEach((btn) => { btn.disabled = true; });
    try {
      await fn();
      await loadStatus();
    } catch (err) {
      banner = { ok: false, message: err.message };
    } finally {
      render();
    }
  }

  async function setVisible(next) {
    if (!next) {
      visible = false;
      banner = null;
      simStatus = null;
      render();
      return;
    }

    const statusRes = await fetch('/api/sim/status');
    if (!statusRes.ok) {
      visible = false;
      banner = null;
      simStatus = null;
      render();
      return;
    }

    simStatus = await statusRes.json();
    visible = true;
    render();
  }

  render();

  return { setVisible };
}

function fieldRow(label, input) {
  const row = el('label', 'sim-controls-field');
  row.appendChild(el('span', 'sim-controls-label', label));
  row.appendChild(input);
  return row;
}
