// Lightweight WebSocket listener for session log state (settings page, M14).

export function subscribeSessionLog(onUpdate) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}/ws?view=band`;
  const ws = new WebSocket(url);

  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === 'init' && msg.sessionLog) {
      onUpdate(msg.sessionLog);
    }
    if (msg.type === 'sessionLog' && msg.sessionLog) {
      onUpdate(msg.sessionLog);
    }
  });

  return () => {
    ws.close();
  };
}
