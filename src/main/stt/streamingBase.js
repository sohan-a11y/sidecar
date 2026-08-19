const WebSocket = require('ws');

const MAX_RECONNECTS = 3;
const BASE_RECONNECT_MS = 600;

/**
 * Shared plumbing for the streaming STT adapters: one socket per channel, buffering
 * while the socket opens, and reconnect with backoff before giving up so the caller
 * can fall back to batch mode (BUILD-PLAN 3.1).
 *
 * Electron's main process has no global WebSocket, hence the `ws` dependency. Keys must
 * not leave main, so the socket cannot live in the renderer.
 */
function createStreamingSession({ url, headers, protocols, onOpenMessage, parseMessage, encodeAudio }, handlers) {
  const state = {
    socket: null,
    open: false,
    closed: false,
    pending: [],
    attempts: 0
  };

  const emitError = (message) => {
    if (typeof handlers.onError === 'function') handlers.onError(new Error(message));
  };

  function connect() {
    try {
      state.socket = protocols
        ? new WebSocket(url, protocols, { headers })
        : new WebSocket(url, { headers });
    } catch (e) {
      emitError(e.message);
      return;
    }

    state.socket.on('open', () => {
      state.open = true;
      state.attempts = 0;
      if (onOpenMessage) {
        const message = onOpenMessage();
        if (message) state.socket.send(typeof message === 'string' ? message : JSON.stringify(message));
      }
      for (const chunk of state.pending) state.socket.send(chunk);
      state.pending = [];
      if (typeof handlers.onOpen === 'function') handlers.onOpen();
    });

    state.socket.on('message', (raw) => {
      let payload;
      try {
        payload = JSON.parse(raw.toString());
      } catch (e) {
        return; // binary or malformed frames are not results
      }
      try {
        const results = parseMessage(payload);
        for (const result of results || []) {
          if (result && result.text) handlers.onResult(result);
        }
      } catch (e) {
        console.warn('[STT] Could not read a result frame:', e.message);
      }
    });

    state.socket.on('error', (err) => {
      emitError(err.message);
    });

    state.socket.on('close', () => {
      state.open = false;
      if (state.closed) return;
      if (state.attempts >= MAX_RECONNECTS) {
        if (typeof handlers.onGiveUp === 'function') handlers.onGiveUp();
        return;
      }
      const delay = BASE_RECONNECT_MS * 2 ** state.attempts + Math.floor(Math.random() * 250);
      state.attempts += 1;
      const timer = setTimeout(() => { if (!state.closed) connect(); }, delay);
      if (timer.unref) timer.unref();
    });
  }

  connect();

  return {
    /** @param {Buffer} pcm 16 kHz mono Int16 LE */
    sendAudio(pcm) {
      if (state.closed) return;
      const frame = encodeAudio ? encodeAudio(pcm) : pcm;
      if (state.open && state.socket.readyState === WebSocket.OPEN) {
        state.socket.send(frame);
      } else if (state.pending.length < 200) {
        // Bounded: a socket that never opens must not eat memory for a whole call.
        state.pending.push(frame);
      }
    },
    send(message) {
      if (state.open && state.socket.readyState === WebSocket.OPEN) {
        state.socket.send(typeof message === 'string' ? message : JSON.stringify(message));
      }
    },
    isOpen() {
      return state.open;
    },
    close() {
      state.closed = true;
      state.pending = [];
      try {
        if (state.socket) state.socket.close();
      } catch (e) { /* already gone */ }
    }
  };
}

module.exports = { createStreamingSession };
