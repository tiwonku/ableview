#!/usr/bin/env node
/**
 * Rewrite night 1–2 live_color chase samples into night 3 hold/move events.
 *
 *   node scripts/normalize-session-colors.mjs
 *
 * Originals stay put. Writes data/sessions/YD_N1.normalized.jsonl and
 * data/sessions/YD-N2.normalized.jsonl.
 *
 * Samples closer than 3s are one chase: a single phase "move" at the first
 * sample, with no colors. A sample followed by 3s or more of silence is a
 * phase "hold" carrying that sample's RGB. A move whose previous hold and
 * following hold are different palettes gets review: true.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const HOLD_GAP_MS = 3000;

const SLOT_IDS = ['main', 'secondary', 'accent'];

const DEFAULT_JOBS = [
  ['data/sessions/YD_N1.jsonl', 'data/sessions/YD_N1.normalized.jsonl'],
  ['data/sessions/YD-N2.jsonl', 'data/sessions/YD-N2.normalized.jsonl'],
];

export function quantizeChannel(value) {
  return Math.round(value / 16) * 16;
}

export function paletteKey(colors) {
  const slots = SLOT_IDS.map((slot) => {
    const color = colors?.[slot];
    if (!color) return '';
    return [quantizeChannel(color.r), quantizeChannel(color.g), quantizeChannel(color.b)].join(',');
  });
  return [...new Set(slots.filter(Boolean))].sort().join(' + ');
}

function colorEvent(sample, phase, { colors = null, review = false } = {}) {
  const record = {
    timestamp: sample.timestamp,
    timestampSource: sample.timestampSource,
    loggedAt: sample.loggedAt,
    event: 'live_color',
    phase,
    universe: sample.universe ?? null,
    clipName: sample.clipName ?? null,
    rowId: sample.rowId ?? null,
    simulated: sample.simulated === true,
    sessionName: sample.sessionName,
  };
  if (review) record.review = true;
  if (colors) record.colors = colors;
  return record;
}

function clusterColorSamples(records, colorIndexes) {
  const clusters = [];
  let start = 0;
  while (start < colorIndexes.length) {
    let end = start;
    while (end + 1 < colorIndexes.length) {
      const gap = new Date(records[colorIndexes[end + 1]].loggedAt)
        - new Date(records[colorIndexes[end]].loggedAt);
      if (gap >= HOLD_GAP_MS) break;
      end += 1;
    }
    const followedBySilence = end + 1 < colorIndexes.length;
    const loneSample = start === end;
    clusters.push({
      start,
      end,
      // A multi-sample run at end of file is still a chase. A lone last
      // sample is the last settled look.
      hold: followedBySilence || loneSample,
    });
    start = end + 1;
  }
  return clusters;
}

/**
 * @param {string[]} lines non-empty JSONL lines
 * @returns {string[]}
 */
export function normalizeLines(lines) {
  const records = lines.map((line) => JSON.parse(line));
  const colorIndexes = [];
  records.forEach((record, index) => {
    if (record.event === 'live_color' && record.colors) colorIndexes.push(index);
  });
  const colorIndexSet = new Set(colorIndexes);
  const replacements = new Map();

  let previousHoldColors = null;
  for (const cluster of clusterColorSamples(records, colorIndexes)) {
    const first = records[colorIndexes[cluster.start]];
    const last = records[colorIndexes[cluster.end]];
    const multi = cluster.end > cluster.start;
    if (multi) {
      const review = cluster.hold
        && previousHoldColors
        && paletteKey(previousHoldColors) !== paletteKey(last.colors);
      replacements.set(colorIndexes[cluster.start], colorEvent(first, 'move', { review }));
    }
    if (cluster.hold) {
      replacements.set(colorIndexes[cluster.end], colorEvent(last, 'hold', { colors: last.colors }));
      previousHoldColors = last.colors;
    }
  }

  const out = [];
  records.forEach((record, index) => {
    if (record.event === 'live_color' && colorIndexSet.has(index)) {
      if (replacements.has(index)) out.push(JSON.stringify(replacements.get(index)));
      return;
    }
    out.push(lines[index]);
  });
  return out;
}

export function summarizeLines(lines) {
  const counts = { holds: 0, moves: 0, review: 0 };
  const events = {};
  for (const line of lines) {
    const record = JSON.parse(line);
    events[record.event] = (events[record.event] ?? 0) + 1;
    if (record.event !== 'live_color') continue;
    if (record.phase === 'hold') counts.holds += 1;
    if (record.phase === 'move') counts.moves += 1;
    if (record.review === true) counts.review += 1;
  }
  return { lines: lines.length, ...counts, events };
}

function readLines(filePath) {
  return readFileSync(filePath, 'utf8').split(/\r?\n/).filter((line) => line.trim());
}

function convertFile(inputPath, outputPath) {
  const source = readLines(inputPath);
  const normalized = normalizeLines(source);
  writeFileSync(outputPath, `${normalized.join('\n')}\n`, 'utf8');
  const before = summarizeLines(source);
  const after = summarizeLines(normalized);
  return { inputPath, outputPath, before, after };
}

function isMain() {
  const entry = process.argv[1] ? resolve(process.argv[1]) : '';
  return entry.endsWith('normalize-session-colors.mjs');
}

if (isMain()) {
  const jobs = process.argv.slice(2).length > 0
    ? process.argv.slice(2).map((input) => [input, input.replace(/\.jsonl$/, '.normalized.jsonl')])
    : DEFAULT_JOBS;
  for (const [input, output] of jobs) {
    const result = convertFile(resolve(input), resolve(output));
    console.log(JSON.stringify(result, null, 2));
  }
}
