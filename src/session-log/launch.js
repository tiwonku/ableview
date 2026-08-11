import { launchLogKey } from '../ingest/scene-launch.js';

export { launchLogKey };

export function emptyLaunchSummary() {
  return {
    sceneLaunches: 0,
    clipLaunches: 0,
    totalLaunches: 0,
  };
}

export function incrementLaunchSummary(summary, launchType) {
  const next = { ...summary };
  if (launchType === 'scene') next.sceneLaunches += 1;
  else if (launchType === 'clip') next.clipLaunches += 1;
  next.totalLaunches = next.sceneLaunches + next.clipLaunches;
  return next;
}

export function buildLaunchRecord(scene, envelope, extras = {}) {
  return {
    ...envelope,
    event: 'launch',
    launchId: scene.launchId ?? null,
    launchType: scene.launchType,
    sceneIndex: scene.index,
    sceneName: scene.name ?? null,
    pendingLaunch: scene.pending === true,
    trackIndex: scene.trackIndex ?? null,
    trackName: scene.trackName ?? null,
    ...extras,
  };
}
