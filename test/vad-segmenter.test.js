import { describe, it, expect } from 'vitest';
import { createSegmenter } from '../src/renderer/lib/vadSegmenter.js';

const FRAME = 1024;
const RATE = 16000;
const FRAME_MS = (FRAME / RATE) * 1000; // 64 ms

function frame(amplitude) {
  const buf = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i += 1) {
    // Alternating sign gives a stable RMS equal to the amplitude.
    buf[i] = i % 2 === 0 ? amplitude : -amplitude;
  }
  return buf;
}

/** Feed n frames, collecting every boundary the segmenter reports. */
function feed(segmenter, amplitude, count) {
  const events = [];
  for (let i = 0; i < count; i += 1) {
    const event = segmenter.push(frame(amplitude), FRAME_MS);
    if (event) events.push(event);
  }
  return events;
}

const SILENCE = 0.001;
const SPEECH = 0.2;

describe('VAD segmenter', () => {
  it('stays quiet through silence', () => {
    const vad = createSegmenter();
    expect(feed(vad, SILENCE, 40)).toEqual([]);
    expect(vad.isSpeaking()).toBe(false);
  });

  it('opens a segment when speech starts and closes it after the hangover', () => {
    const vad = createSegmenter();
    feed(vad, SILENCE, 20);

    expect(feed(vad, SPEECH, 10)).toEqual(['start']);
    expect(vad.isSpeaking()).toBe(true);

    // Hangover is 700 ms; ~11 frames of silence must close it.
    const events = feed(vad, SILENCE, 15);
    expect(events).toEqual(['end']);
    expect(vad.isSpeaking()).toBe(false);
  });

  it('rides through a short pause instead of cutting mid-sentence', () => {
    const vad = createSegmenter();
    feed(vad, SILENCE, 20);
    feed(vad, SPEECH, 10);

    // ~320 ms of quiet, well inside the 700 ms hangover.
    expect(feed(vad, SILENCE, 5)).toEqual([]);
    expect(vad.isSpeaking()).toBe(true);

    expect(feed(vad, SPEECH, 5)).toEqual([]);
    expect(vad.isSpeaking()).toBe(true);
  });

  it('discards a blip too short to be speech', () => {
    const vad = createSegmenter({ minSpeechMs: 400, hangoverMs: 200 });
    feed(vad, SILENCE, 20);

    feed(vad, SPEECH, 1); // 64 ms
    const events = feed(vad, SILENCE, 6);
    expect(events).toEqual(['abort']);
  });

  it('force-cuts a monologue at the maximum segment length', () => {
    const vad = createSegmenter({ maxSegmentMs: 1000 });
    feed(vad, SILENCE, 20);

    const events = feed(vad, SPEECH, 30); // ~1.9 s of continuous speech
    expect(events[0]).toBe('start');
    expect(events).toContain('end');
  });

  it('raises its threshold in a noisy room', () => {
    const quiet = createSegmenter();
    const noisy = createSegmenter();

    feed(quiet, 0.002, 60);
    feed(noisy, 0.05, 60); // constant background hiss

    // A voice at 0.03 is speech in a quiet room and background in a loud one.
    expect(feed(quiet, 0.03, 3)).toEqual(['start']);
    expect(feed(noisy, 0.03, 3)).toEqual([]);
    expect(noisy.levels().noiseFloor).toBeGreaterThan(quiet.levels().noiseFloor);
  });

  it('resets cleanly between captures', () => {
    const vad = createSegmenter();
    feed(vad, SILENCE, 20);
    feed(vad, SPEECH, 5);
    expect(vad.isSpeaking()).toBe(true);

    vad.reset();
    expect(vad.isSpeaking()).toBe(false);
  });
});
