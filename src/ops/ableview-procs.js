/** Classify local AbleView node processes so leftover agent sims can be listed/killed. */

export const DEFAULT_KEEP_HTTP_PORT = 8080;

const INDEX_RE = /src[/\\]index\.js/;
const NPM_CLI_RE = /npm-cli\.js/i;

export function classifyNodeProcess(row, keepPort = DEFAULT_KEEP_HTTP_PORT) {
  const pid = Number(row?.pid ?? row?.ProcessId);
  const commandLine = String(row?.commandLine ?? row?.CommandLine ?? '');
  const listenPorts = [...new Set(
    (row?.listenPorts ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0),
  )];
  if (!Number.isInteger(pid) || pid <= 0) return null;

  const isIndex = INDEX_RE.test(commandLine);
  const isNpmSim = NPM_CLI_RE.test(commandLine) && /\brun sim\b/.test(commandLine);
  if (!isIndex && !isNpmSim) return null;

  const kind = isNpmSim ? 'npm-sim' : (/\s--sim\b/.test(commandLine) ? 'sim' : 'live');
  const keep = kind === 'live' && (listenPorts.length === 0 || listenPorts.includes(Number(keepPort)));

  return { pid, commandLine, listenPorts, kind, keep };
}

export function extrasToStop(rows, keepPort = DEFAULT_KEEP_HTTP_PORT) {
  return (rows ?? [])
    .map((row) => classifyNodeProcess(row, keepPort))
    .filter((row) => row && !row.keep);
}

/** Live show processes (the keep port). Explicit restart only — never stop-extras. */
export function liveToRestart(rows, keepPort = DEFAULT_KEEP_HTTP_PORT) {
  return (rows ?? [])
    .map((row) => classifyNodeProcess(row, keepPort))
    .filter((row) => row && row.kind === 'live' && row.keep);
}

/** Map owning PID → listening TCP ports from `netstat -ano` output. */
export function listenPortsByPidFromNetstat(text) {
  const byPid = new Map();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!/\bLISTENING\b/i.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5 || parts[0] !== 'TCP') continue;
    const local = parts[1];
    const port = Number(local.slice(local.lastIndexOf(':') + 1));
    const pid = Number(parts[parts.length - 1]);
    if (!Number.isInteger(port) || port <= 0 || !Number.isInteger(pid) || pid <= 0) continue;
    const list = byPid.get(pid) ?? [];
    if (!list.includes(port)) list.push(port);
    byPid.set(pid, list);
  }
  return byPid;
}

export function formatProcLine(proc) {
  const ports = proc.listenPorts.length ? proc.listenPorts.join(',') : '—';
  const role = proc.keep ? 'keep' : 'extra';
  return `${proc.pid}\t:${ports}\t${proc.kind}\t${role}`;
}
