// NFR-1 structural enforcement: the ONLY outbound OSC addresses this process
// may emit. Every send in the Ableton-facing module goes through
// assertReadOnlyAddress(); there is no other code path that constructs an
// outbound OSC message. Write addresses (/live/**/set, fire, create_*,
// delete_*, transport) are not representable here.

export const OSC_READ_ALLOWLIST = Object.freeze([
  '/live/test',
  '/live/song/get/num_tracks',
  '/live/song/get/track_names',
  '/live/song/get/tempo',
  '/live/song/start_listen/tempo',
  '/live/song/stop_listen/tempo',
  '/live/song/get/is_playing',
  '/live/song/start_listen/is_playing',
  '/live/song/stop_listen/is_playing',
  '/live/song/start_listen/beat',
  '/live/song/stop_listen/beat',
  '/live/track/get/name',
  '/live/track/get/playing_slot_index',
  '/live/track/start_listen/playing_slot_index',
  '/live/track/stop_listen/playing_slot_index',
  '/live/track/get/fired_slot_index',
  '/live/track/start_listen/fired_slot_index',
  '/live/track/stop_listen/fired_slot_index',
  '/live/clip/get/name',
  '/live/view/get/selected_scene',
  '/live/view/start_listen/selected_scene',
  '/live/view/stop_listen/selected_scene',
  '/live/scene/get/name',
  '/live/scene/get/is_triggered',
]);

const ALLOWSET = new Set(OSC_READ_ALLOWLIST);

// Defense in depth: even if an address were added to the allowlist by
// mistake, these patterns can never pass.
const WRITE_PATTERNS = [/\/set(\/|$)/, /\/fire(\/|$)/, /\/create_/, /\/delete_/, /\/stop(\/|$)/, /\/start_playing/, /\/stop_playing/, /\/continue_playing/];

export function isReadOnlyAddress(address) {
  if (!ALLOWSET.has(address)) return false;
  return !WRITE_PATTERNS.some((re) => re.test(address));
}

export function assertReadOnlyAddress(address) {
  if (!isReadOnlyAddress(address)) {
    throw new Error(
      `NFR-1 violation blocked: attempted to send non-allowlisted OSC address "${address}"`
    );
  }
  return address;
}
