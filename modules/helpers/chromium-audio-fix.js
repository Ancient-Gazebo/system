/**
 * Chromium audio buffer end fix.
 *
 * Chromium (seen in 152) works out where an AudioBufferSourceNode's buffer ends as
 * `(length / sampleRate) * sampleRate`: a duration in seconds turned back into frames. For about one
 * buffer length in eight that floating-point round trip lands a hair ABOVE `length`. The play head
 * then reaches the last frame without ever counting as past the end, the node's bounds check stops it
 * writing, and it repeats its last 128-frame block for ever:
 *   - a sound on Repeat plays once, then goes (nearly) silent while Foundry still has it playing;
 *   - a sound that does not loop never fires `ended`, so a sequential playlist cannot move on.
 * Which tracks are hit depends on the decoded length, and a track is decoded at the output device's
 * sample rate - so one player's 48 kHz copy of a track sticks while everyone else's 44.1 kHz copy
 * loops. Chromium's own source has since moved loop bounds to whole frames.
 *
 * Fix: a buffer whose length would overrun is swapped, before it is played, for a copy trimmed by the
 * frame or two that brings it to a length that rounds correctly (well under a millisecond, inaudible).
 * The copy replaces the original in Foundry's buffer cache, so each track is copied once. A tiny
 * offline render at start-up checks whether this browser has the bug at all: Firefox, and Chromium
 * once it ships its fix, are left alone.
 */

/** Whether this browser has the bug: null until the probe has answered, and treated as yes meanwhile. */
let affected = null;

/**
 * @param {number} length       buffer length in frames
 * @param {number} sampleRate
 * @returns {boolean} whether Chromium would place the end of such a buffer past its last frame
 */
function overruns(length, sampleRate) {
  return (length / sampleRate) * sampleRate > length;
}

/**
 * Loop a short buffer whose length overruns and see whether the play head comes back to its first
 * frame.
 * @returns {Promise<boolean>} true when the browser sticks at the end instead
 */
async function probe() {
  const rate = 44100;
  let length = 4096;
  while (!overruns(length, rate)) length++;
  const context = new OfflineAudioContext(1, 1024, rate);
  const buffer = context.createBuffer(1, length, rate);
  buffer.getChannelData(0)[0] = 1;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(context.destination);
  // 512 frames before the end, so frame 512 of the render is the first one after the wrap
  source.start(0, (length - 512) / rate);
  const rendered = await context.startRendering();
  return rendered.getChannelData(0)[512] !== 1;
}

/** original buffer -> its trimmed copy, so a buffer shared by several Sounds is copied once */
const trimmed = new WeakMap();

/**
 * @param {AudioBuffer} buffer
 * @returns {AudioBuffer} the buffer itself, or a copy a frame or two shorter whose end rounds correctly
 */
function safeBuffer(buffer) {
  if (!overruns(buffer.length, buffer.sampleRate)) return buffer;
  let copy = trimmed.get(buffer);
  if (!copy) {
    let length = buffer.length - 1;
    while (length > 1 && overruns(length, buffer.sampleRate)) length--;
    copy = new AudioBuffer({ length, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      copy.copyToChannel(buffer.getChannelData(channel).subarray(0, length), channel);
    }
    trimmed.set(buffer, copy);
  }
  return copy;
}

/** Call once, at init. */
export function registerChromiumAudioFix() {
  const Sound = foundry.audio?.Sound;
  if (typeof Sound?.prototype?._createNodes !== "function" || typeof OfflineAudioContext !== "function") return;

  probe()
    .then((result) => {
      affected = result;
      if (result) CONFIG.logger?.log?.("This browser sticks at the end of some audio buffers; affected sounds are trimmed by a frame or two so they loop and end.");
    })
    .catch((err) => {
      affected = false;
      CONFIG.logger?.debug?.("Audio buffer end probe failed; leaving sounds untouched", err);
    });

  // Every Sound builds a fresh AudioBufferSourceNode from `this.buffer` here, whether it was just
  // decoded, came out of the cache, or was handed over by a module.
  const createNodes = Sound.prototype._createNodes;
  Sound.prototype._createNodes = function (...args) {
    if (affected !== false && this.buffer instanceof AudioBuffer) {
      const buffer = safeBuffer(this.buffer);
      if (buffer !== this.buffer) {
        // the next load of this track should find the safe copy, and the original can be freed
        if (this.src && game.audio?.buffers?.getBuffer?.(this.src) === this.buffer) game.audio.buffers.setBuffer(this.src, buffer);
        this.buffer = buffer;
      }
    }
    return createNodes.apply(this, args);
  };
}
