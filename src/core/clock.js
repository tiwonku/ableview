// Live transport bar/beat from AbletonOSC's integer song beat
// (`int(current_song_time)`, 0-based quarter notes) plus time signature.
// Output is 1-based, matching Live's bars.beats display (1.1.1 at song start).

export function liveTransportClock(songBeat, numerator = 4, denominator = 4) {
  if (songBeat == null || !Number.isFinite(Number(songBeat))) {
    return { bar: null, beat: null, songBeat: null, quartersPerBar: null };
  }
  const num = Number(numerator);
  const den = Number(denominator);
  const quartersPerBar = (num > 0 && den > 0) ? num * (4 / den) : 4;
  if (!(quartersPerBar > 0)) {
    return { bar: null, beat: null, songBeat: null, quartersPerBar: null };
  }
  const sb = Math.floor(Number(songBeat));
  return {
    bar: Math.floor(sb / quartersPerBar) + 1,
    beat: Math.floor(sb % quartersPerBar) + 1,
    songBeat: sb,
    quartersPerBar,
  };
}
