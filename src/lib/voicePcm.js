// voicePcm.js — turns a recorded voice note into what the host's recogniser reads.
//
// The leaf takes 16kHz mono signed 16-bit PCM, whisper's native input, and carries no audio codec:
// what `MediaRecorder` produces is webm/opus (or mp4/aac on Safari), which nothing on the host can
// open. The conversion happens here because the browser already has a decoder for whatever it just
// recorded — it is one pass over a buffer this process is holding, against a codec dependency the
// leaf would otherwise have to grow.
//
// It imports nothing on purpose. Both surfaces record voice notes, and the standalone assistant may
// not reach the Control Panel's data layer (`npm run check:assistant`) — a shared module that pulled
// in `apiClient` would fail that check whether or not its exports were read.

// The recogniser's input rate. Not a preference: the leaf documents this rate and sends no header
// restating it, so resampling to anything else transcribes at the wrong speed rather than failing.
const RATE = 16000;

// The leaf refuses more than three minutes. Checked here as well so a long note is reported before it
// is uploaded — 3.8MB spent to be told it was too long is a slow way to learn it.
const MAX_SECONDS = 180;

function contextClass() {
  return window.OfflineAudioContext || window.webkitOfflineAudioContext || null;
}

// Float samples in [-1, 1] → signed 16-bit little-endian.
//
// The asymmetry is deliberate: a signed 16-bit sample runs -32768..32767, so scaling both directions
// by 32768 clips every positive peak by one count and scaling both by 32767 never reaches the floor.
function toInt16(samples) {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm.buffer;
}

// Mix to mono and resample by hand, for a browser that will not build an OfflineAudioContext at
// 16kHz. Linear interpolation between neighbouring samples — the audio is speech being handed to a
// recogniser, not something anybody listens to, and the alternative is no voice note at all.
function resampleByHand(buffer) {
  const channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));

  const ratio = buffer.sampleRate / RATE;
  const frames = Math.floor(buffer.length / ratio);
  const out = new Float32Array(frames);

  for (let i = 0; i < frames; i++) {
    const at = i * ratio;
    const a = Math.floor(at);
    const b = Math.min(a + 1, buffer.length - 1);
    const f = at - a;

    let sum = 0;
    for (const channel of channels) sum += channel[a] * (1 - f) + channel[b] * f;
    out[i] = sum / channels.length;
  }

  return out;
}

// Decode whatever the recorder produced and hand back the samples the leaf reads.
//
// Throws with a `reason` the caller can show. Every failure here is one the person can act on — the
// recording is empty, it is too long, this browser cannot decode what it just wrote — so none of them
// are swallowed into an empty transcript.
async function toPcm16k(blob) {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) {
    const e = new Error("This browser has no audio decoder.");
    e.reason = "unsupported";
    throw e;
  }

  // A short-lived context, closed as soon as the decode is done: an open one holds an audio device,
  // and a note recorded every few minutes would otherwise leave one behind each time. `decodeAudioData`
  // detaches the buffer it is given, which is fine — this one is read once and dropped.
  const ctx = new Ctor();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  } catch {
    const e = new Error("That recording could not be decoded.");
    e.reason = "undecodable";
    throw e;
  } finally {
    try { ctx.close(); } catch { /* already closed */ }
  }

  if (!decoded || !decoded.length) {
    const e = new Error("That recording is empty.");
    e.reason = "empty";
    throw e;
  }
  if (decoded.duration > MAX_SECONDS) {
    const e = new Error("That recording is too long — keep it under three minutes.");
    e.reason = "too-long";
    throw e;
  }

  const Offline = contextClass();
  if (Offline) {
    try {
      // One mono channel at the target rate: connecting a stereo buffer to a mono destination
      // downmixes it, so this is the mix and the resample in one render.
      const frames = Math.max(1, Math.ceil(decoded.duration * RATE));
      const offline = new Offline(1, frames, RATE);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start();
      const rendered = await offline.startRendering();
      return toInt16(rendered.getChannelData(0));
    } catch {
      // Some browsers refuse an OfflineAudioContext outside a narrow band of sample rates. That is a
      // reason to do the arithmetic here, not a reason to have no voice note.
    }
  }

  return toInt16(resampleByHand(decoded));
}

export { toPcm16k, RATE, MAX_SECONDS };
