#!/usr/bin/env node
/**
 * Synthesizes every sound in the promo from scratch: a 120 BPM music bed plus
 * a handful of UI sound effects. No samples, no stock audio — the whole
 * soundtrack is reproducible from this file.
 *
 *   node scripts/make-audio.mjs
 *
 * Writes:
 *   public/audio/music.mp3        (full-length bed, encoded with Remotion's ffmpeg)
 *   public/audio/sfx/*.wav        (short one-shots placed by the composition)
 *
 * The music reads src/timeline.json so the drop lands exactly on the cut into
 * the "Promesa" scene and the outro starts with the CTA. If you retime scenes,
 * re-run this script.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "audio");
const SFX_DIR = join(OUT_DIR, "sfx");
const SR = 44100;

const timeline = JSON.parse(
  readFileSync(join(ROOT, "src", "timeline.json"), "utf8"),
);

// ---------------------------------------------------------------- helpers

/** Deterministic PRNG so every run produces byte-identical audio. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260924);
const noise = () => rand() * 2 - 1;

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** Stereo buffer with additive mixing helpers. */
function createBuffer(seconds) {
  const n = Math.ceil(seconds * SR);
  return { L: new Float32Array(n), R: new Float32Array(n), n };
}

function addMono(buf, startSec, samples, gain = 1, pan = 0) {
  const start = Math.round(startSec * SR);
  // Equal-power pan: -1 = left, 1 = right.
  const angle = ((pan + 1) / 2) * (Math.PI / 2);
  const gl = Math.cos(angle) * gain;
  const gr = Math.sin(angle) * gain;
  for (let i = 0; i < samples.length; i++) {
    const j = start + i;
    if (j < 0 || j >= buf.n) continue;
    buf.L[j] += samples[i] * gl;
    buf.R[j] += samples[i] * gr;
  }
}

/** One-pole low-pass, in place. */
function lowpass(samples, cutoffHz) {
  const a = Math.exp((-2 * Math.PI * cutoffHz) / SR);
  let y = 0;
  for (let i = 0; i < samples.length; i++) {
    y = (1 - a) * samples[i] + a * y;
    samples[i] = y;
  }
  return samples;
}

/** One-pole high-pass, in place. */
function highpass(samples, cutoffHz) {
  const a = Math.exp((-2 * Math.PI * cutoffHz) / SR);
  let lp = 0;
  for (let i = 0; i < samples.length; i++) {
    lp = (1 - a) * samples[i] + a * lp;
    samples[i] = samples[i] - lp;
  }
  return samples;
}

/** State-variable band-pass with a time-varying centre frequency. */
function sweepBandpass(samples, fromHz, toHz, q = 4) {
  let low = 0;
  let band = 0;
  const damp = 1 / q;
  for (let i = 0; i < samples.length; i++) {
    const t = i / samples.length;
    const fc = fromHz * Math.pow(toHz / fromHz, t);
    const f = 2 * Math.sin((Math.PI * Math.min(fc, SR / 6)) / SR);
    const high = samples[i] - low - damp * band;
    band += f * high;
    low += f * band;
    samples[i] = band;
  }
  return samples;
}

function normalize(samples, peak = 0.9) {
  let max = 0;
  for (const s of samples) max = Math.max(max, Math.abs(s));
  if (max === 0) return samples;
  const k = peak / max;
  for (let i = 0; i < samples.length; i++) samples[i] *= k;
  return samples;
}

// ---------------------------------------------------------------- voices

function kick(len = 0.42) {
  const n = Math.floor(len * SR);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 45 + 110 * Math.exp(-t * 28);
    phase += (2 * Math.PI * f) / SR;
    const body = Math.sin(phase) * Math.exp(-t * 7.5);
    const click = i < 90 ? noise() * (1 - i / 90) * 0.35 : 0;
    out[i] = Math.tanh((body + click) * 1.6);
  }
  return out;
}

function clap(len = 0.28) {
  const n = Math.floor(len * SR);
  const out = new Float32Array(n);
  // Three quick bursts then a tail: the classic hand-clap envelope.
  const bursts = [0, 0.011, 0.022];
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let env = 0;
    for (const b of bursts)
      if (t >= b) env = Math.max(env, Math.exp(-(t - b) * 180));
    env = Math.max(env, t >= 0.03 ? 0.5 * Math.exp(-(t - 0.03) * 22) : 0);
    out[i] = noise() * env;
  }
  highpass(out, 900);
  sweepBandpass(out, 1500, 1200, 1.2);
  return normalize(out, 0.9);
}

function hat(len = 0.06, bright = 1) {
  const n = Math.floor(len * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] = noise() * Math.exp(-t * (70 / bright));
  }
  highpass(out, 7000);
  return normalize(out, 0.8);
}

/** Marimba-ish mallet: fundamental plus the characteristic ~4x partial. */
function mallet(freq, len = 0.6, soft = false) {
  const n = Math.floor(len * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const attack = Math.min(1, t / 0.003);
    const fund = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 6);
    const p4 =
      Math.sin(2 * Math.PI * freq * 3.93 * t) *
      Math.exp(-t * 38) *
      (soft ? 0.15 : 0.35);
    const p10 =
      Math.sin(2 * Math.PI * freq * 9.2 * t) *
      Math.exp(-t * 90) *
      (soft ? 0.03 : 0.08);
    out[i] = attack * (fund + p4 + p10);
  }
  return out;
}

/** Karplus-Strong plucked string for short off-beat stabs. */
function pluck(freq, len = 0.35, brightness = 0.5) {
  const n = Math.floor(len * SR);
  const out = new Float32Array(n);
  const period = Math.max(2, Math.round(SR / freq));
  const ring = new Float32Array(period);
  for (let i = 0; i < period; i++) ring[i] = noise();
  lowpass(ring, 2000 + brightness * 6000);
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const next = (idx + 1) % period;
    const v = 0.5 * (ring[idx] + ring[next]) * 0.996;
    out[i] = ring[idx];
    ring[idx] = v;
    idx = next;
  }
  const fade = Math.floor(0.03 * SR);
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
  return out;
}

function bassNote(freq, len) {
  const n = Math.floor(len * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.005) * Math.exp(-t * 3.2);
    const s =
      Math.sin(2 * Math.PI * freq * t) +
      0.35 * Math.sin(4 * Math.PI * freq * t);
    out[i] = Math.tanh(s * 1.4) * env;
  }
  const fade = Math.min(n, Math.floor(0.012 * SR));
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
  return out;
}

/** Warm detuned pad for the outro. */
function pad(freqs, len) {
  const n = Math.floor(len * SR);
  const out = new Float32Array(n);
  const detune = [-0.12, 0, 0.12];
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    for (const f of freqs) {
      for (const d of detune) {
        const ff = f * Math.pow(2, d / 12);
        // Band-limited-ish saw: first five harmonics.
        for (let h = 1; h <= 5; h++)
          s += Math.sin(2 * Math.PI * ff * h * t) / h;
      }
    }
    const env = Math.min(1, t / 0.4) * Math.min(1, (len - t) / 0.8);
    out[i] = s * env;
  }
  lowpass(out, 1800);
  return normalize(out, 0.9);
}

function riser(len) {
  const n = Math.floor(len * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    out[i] = noise() * Math.pow(t, 2.2);
  }
  sweepBandpass(out, 300, 7000, 3);
  return normalize(out, 0.9);
}

// ---------------------------------------------------------------- music

function buildMusic() {
  const fps = timeline.fps;
  const beat = 60 / timeline.bpm;
  const starts = [];
  let acc = 0;
  for (const s of timeline.scenes) {
    starts.push({ id: s.id, start: acc / fps });
    acc += s.durationInFrames;
  }
  const total = acc / fps;
  const drop = starts.find((s) => s.id === "Promesa").start;
  const outro = starts.find((s) => s.id === "Cta").start;
  const finalHit = total - 1.25;

  const buf = createBuffer(total + 0.01);
  const mallets = createBuffer(total + 0.01);

  // I–vi–IV–V in F major, one chord per bar.
  const chords = [
    { root: 41, tones: [65, 69, 72] }, // F
    { root: 38, tones: [62, 65, 69] }, // Dm
    { root: 34, tones: [58, 62, 65] }, // Bb
    { root: 36, tones: [60, 64, 67] }, // C
  ];
  const chordAt = (t) => chords[Math.floor(t / (beat * 4)) % chords.length];

  const K = kick();
  const C = clap();
  const Hc = hat(0.05);
  const Ho = hat(0.16, 2.2);

  // Sidechain envelope: the bed ducks under each kick, which is what gives
  // four-on-the-floor its pump.
  const duck = new Float32Array(buf.n).fill(1);
  const addDuck = (t) => {
    const s = Math.round(t * SR);
    const len = Math.round(0.22 * SR);
    for (let i = 0; i < len && s + i < duck.length; i++) {
      duck[s + i] = Math.min(duck[s + i], 0.35 + 0.65 * (i / len));
    }
  };

  const beats = Math.floor(total / beat);
  for (let b = 0; b < beats; b++) {
    const t = b * beat;
    const chord = chordAt(t);
    const beatInBar = b % 4;
    const inIntro = t < drop - 1e-6;
    const inOutroTail = t >= finalHit - 1e-6;

    if (inOutroTail) continue;

    // ---- intro: the "lista eterna" — soft mallets that keep asking.
    if (inIntro) {
      const tone = chord.tones[(b * 2) % 3] + 12;
      addMono(mallets, t, mallet(midiToHz(tone), 0.7, true), 0.22, -0.2);
      addMono(
        mallets,
        t + beat / 2,
        mallet(midiToHz(chord.tones[(b + 1) % 3] + 12), 0.5, true),
        0.14,
        0.25,
      );
      if (t >= drop - beat * 8) {
        addMono(buf, t + beat / 2, Hc, 0.06, 0.3);
        if (beatInBar === 0 || beatInBar === 2) {
          addMono(buf, t, K, 0.45);
          addDuck(t);
        }
      }
      continue;
    }

    // ---- groove.
    const outroFade = t >= outro ? 0.8 : 1;
    addMono(buf, t, K, 0.85 * outroFade);
    addDuck(t);
    if (beatInBar === 1 || beatInBar === 3)
      addMono(buf, t, C, 0.28 * outroFade, 0.05);
    addMono(buf, t + beat / 2, Ho, 0.07 * outroFade, 0.25);
    addMono(buf, t + beat / 4, Hc, 0.03 * outroFade, -0.3);
    addMono(buf, t + (3 * beat) / 4, Hc, 0.03 * outroFade, -0.3);

    // Bass: root on the off-beat 8ths, octave pop on the last one of the bar.
    const bassRoot = midiToHz(chord.root + 12);
    addMono(
      buf,
      t + beat / 2,
      bassNote(beatInBar === 3 ? bassRoot * 2 : bassRoot, beat * 0.45),
      0.34 * outroFade,
    );
    addMono(buf, t, bassNote(bassRoot / 2, beat * 0.3), 0.14 * outroFade);

    // Off-beat string stabs.
    for (const [k, tone] of chord.tones.entries()) {
      addMono(
        buf,
        t + beat / 2,
        pluck(midiToHz(tone), 0.26, 0.4),
        0.05 * outroFade,
        k - 1,
      );
    }

    // Mallet hook: 8th-note arpeggio over the chord.
    const pattern = [0, 1, 2, 1, 3, 2, 1, 2];
    for (let e = 0; e < 2; e++) {
      const step = pattern[(beatInBar * 2 + e) % pattern.length];
      const tone = step === 3 ? chord.tones[0] + 12 : chord.tones[step];
      addMono(
        mallets,
        t + (e * beat) / 2,
        mallet(midiToHz(tone + 12), 0.5),
        0.2 * outroFade,
        e ? 0.2 : -0.2,
      );
    }
  }

  // Riser + snare-roll into the drop.
  addMono(buf, drop - beat * 4, riser(beat * 4), 0.2);
  for (let i = 0; i < 16; i++) {
    const t = drop - beat * 2 + (i * beat) / 8;
    addMono(buf, t, C, 0.06 + (i / 16) * 0.22, 0);
  }

  // Outro: pad under the CTA and a final hit that rings out.
  const F = chords[0];
  addMono(
    buf,
    outro,
    pad(
      F.tones.map((m) => midiToHz(m - 12)),
      total - outro,
    ),
    0.12,
  );
  addMono(buf, finalHit, K, 0.9);
  for (const tone of [...F.tones, F.tones[0] + 12]) {
    addMono(mallets, finalHit, mallet(midiToHz(tone + 12), 1.2), 0.18);
  }
  addMono(buf, finalHit, bassNote(midiToHz(F.root + 12), 1.2), 0.4);

  // Dotted-8th ping-pong echo on the mallets.
  const echoL = Math.round(beat * 0.75 * SR);
  const echoR = Math.round(beat * 0.5 * SR);
  for (let i = 0; i < mallets.n; i++) {
    if (i >= echoL) mallets.L[i] += mallets.R[i - echoL] * 0.28;
    if (i >= echoR) mallets.R[i] += mallets.L[i - echoR] * 0.28;
  }

  for (let i = 0; i < buf.n; i++) {
    const d = duck[i];
    buf.L[i] = buf.L[i] + mallets.L[i] * d;
    buf.R[i] = buf.R[i] + mallets.R[i] * d;
  }

  // Gentle bus saturation, a short fade-in and a final fade-out.
  let peak = 0;
  for (let i = 0; i < buf.n; i++) {
    buf.L[i] = Math.tanh(buf.L[i] * 1.15);
    buf.R[i] = Math.tanh(buf.R[i] * 1.15);
    peak = Math.max(peak, Math.abs(buf.L[i]), Math.abs(buf.R[i]));
  }
  const gain = 0.89 / peak;
  const fadeOut = Math.round(0.6 * SR);
  for (let i = 0; i < buf.n; i++) {
    let g = gain * Math.min(1, i / (0.02 * SR));
    if (i > buf.n - fadeOut) g *= (buf.n - i) / fadeOut;
    buf.L[i] *= g;
    buf.R[i] *= g;
  }
  return buf;
}

// ---------------------------------------------------------------- sfx

function monoBuffer(samples) {
  return { L: samples, R: samples, n: samples.length };
}

function sfxPop() {
  const n = Math.floor(0.12 * SR);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 420 + 900 * (1 - Math.exp(-t * 60));
    phase += (2 * Math.PI * f) / SR;
    out[i] = Math.sin(phase) * Math.exp(-t * 38) * Math.min(1, t / 0.002);
  }
  return normalize(out, 0.8);
}

function sfxTick() {
  const n = Math.floor(0.03 * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] =
      (Math.sin(2 * Math.PI * 2600 * t) * 0.6 + noise() * 0.4) *
      Math.exp(-t * 260);
  }
  return normalize(out, 0.6);
}

function sfxTap() {
  const n = Math.floor(0.09 * SR);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 900 - 500 * (1 - Math.exp(-t * 80));
    phase += (2 * Math.PI * f) / SR;
    out[i] =
      Math.sin(phase) * Math.exp(-t * 55) + noise() * Math.exp(-t * 400) * 0.3;
  }
  return normalize(out, 0.8);
}

function sfxWhoosh() {
  const len = 0.5;
  const n = Math.floor(len * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const env = Math.sin(Math.PI * Math.pow(t, 0.7));
    out[i] = noise() * env * env;
  }
  sweepBandpass(out, 400, 4200, 2.5);
  return normalize(out, 0.7);
}

function sfxImpact() {
  const n = Math.floor(0.8 * SR);
  const out = new Float32Array(n);
  let phase = 0;
  const hiss = new Float32Array(n);
  for (let i = 0; i < n; i++) hiss[i] = noise() * Math.exp((-i / SR) * 16);
  lowpass(hiss, 1400);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 38 + 90 * Math.exp(-t * 18);
    phase += (2 * Math.PI * f) / SR;
    out[i] =
      Math.tanh(Math.sin(phase) * Math.exp(-t * 4.5) * 1.8) + hiss[i] * 0.6;
  }
  return normalize(out, 0.9);
}

function sfxDing() {
  const n = Math.floor(0.9 * SR);
  const out = new Float32Array(n);
  const notes = [
    { f: midiToHz(84), at: 0 },
    { f: midiToHz(91), at: 0.085 },
  ];
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    for (const note of notes) {
      if (t < note.at) continue;
      const tt = t - note.at;
      s +=
        (Math.sin(2 * Math.PI * note.f * tt) +
          0.25 *
            Math.sin(2 * Math.PI * note.f * 2.76 * tt) *
            Math.exp(-tt * 12)) *
        Math.exp(-tt * 5.5);
    }
    out[i] = s * Math.min(1, t / 0.002);
  }
  return normalize(out, 0.75);
}

function sfxSuccess() {
  const tones = [72, 76, 79, 84];
  const out = new Float32Array(Math.floor(1.1 * SR));
  tones.forEach((m, k) => {
    const note = mallet(midiToHz(m + 12), 0.8);
    const start = Math.floor(k * 0.07 * SR);
    for (let i = 0; i < note.length && start + i < out.length; i++)
      out[start + i] += note[i] * 0.6;
  });
  return normalize(out, 0.8);
}

// ---------------------------------------------------------------- io

function writeWav(path, buf) {
  const channels = 2;
  const bytesPerSample = 2;
  const dataLen = buf.n * channels * bytesPerSample;
  const out = Buffer.alloc(44 + dataLen);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + dataLen, 4);
  out.write("WAVE", 8);
  out.write("fmt ", 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(SR, 24);
  out.writeUInt32LE(SR * channels * bytesPerSample, 28);
  out.writeUInt16LE(channels * bytesPerSample, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(dataLen, 40);
  let o = 44;
  for (let i = 0; i < buf.n; i++) {
    for (const ch of [buf.L, buf.R]) {
      const v = Math.max(-1, Math.min(1, ch[i]));
      out.writeInt16LE(Math.round(v * 32767), o);
      o += 2;
    }
  }
  writeFileSync(path, out);
}

mkdirSync(SFX_DIR, { recursive: true });

const sfx = {
  pop: sfxPop(),
  tick: sfxTick(),
  tap: sfxTap(),
  whoosh: sfxWhoosh(),
  impact: sfxImpact(),
  ding: sfxDing(),
  success: sfxSuccess(),
};
for (const [name, samples] of Object.entries(sfx)) {
  writeWav(join(SFX_DIR, `${name}.wav`), monoBuffer(samples));
}

const tmpWav = join(OUT_DIR, "music.tmp.wav");
writeWav(tmpWav, buildMusic());
execFileSync(
  "npx",
  [
    "remotion",
    "ffmpeg",
    "-y",
    "-loglevel",
    "error",
    "-i",
    tmpWav,
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "192k",
    join(OUT_DIR, "music.mp3"),
  ],
  { cwd: ROOT, stdio: "inherit" },
);
rmSync(tmpWav);

console.log(`Wrote music.mp3 and ${Object.keys(sfx).length} sfx to ${OUT_DIR}`);
