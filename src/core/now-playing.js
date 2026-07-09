// NowPlaying contract (spec §9.1). Both the real listener and the simulator
// emit exactly this shape; downstream code never knows which source is active.

export const SOURCES = Object.freeze({
  ABLETONOSC: 'abletonosc',
  SIMULATOR: 'simulator',
});

export function makeNowPlaying({
  source,
  tracks = [],
  authoritativeClip = null,
  tempo = null,
  beat = null,
  pendingLaunch = false,
}) {
  if (source !== SOURCES.ABLETONOSC && source !== SOURCES.SIMULATOR) {
    throw new Error(`Invalid NowPlaying source: ${source}`);
  }
  return {
    timestamp: new Date().toISOString(),
    source,
    tracks,
    authoritativeClip,
    tempo,
    beat,
    pendingLaunch,
  };
}
