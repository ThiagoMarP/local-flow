// Owns the microphone side of a dictation. The AudioContext and the capture
// worklet live for the whole session (suspended between dictations, so they
// cost nothing at rest); only the input stream is opened per dictation.
//
// Opening that stream still takes 150-450 ms on Windows. A shortcut press can
// call prepare() before the gesture is known, so the stream opens during the
// hold threshold instead of after it. What the microphone hears in the
// meantime is kept as a short pre-roll and handed to start(). A prepared
// stream nobody starts is closed by release() or after PREPARED_TTL_MS.
const PREROLL_MS = 500;
const PREPARED_TTL_MS = 2500;

function stopTracks(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

// Some Windows USB drivers reject Chromium's processing constraints with
// "Could not start audio source", so each attempt is a fallback for the last.
async function openStream(attempts, isCurrent) {
  let lastError;
  for (const constraints of attempts) {
    try {
      const acquired = await navigator.mediaDevices.getUserMedia(constraints);
      if (!isCurrent()) {
        stopTracks(acquired);
        return null;
      }
      return acquired;
    } catch (error) {
      if (!isCurrent()) return null;
      lastError = error;
      if (error.name === "NotAllowedError") break;
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    }
  }
  throw lastError;
}

export function createMicrophone({ onFrame, workletUrl = "./capture-worklet.js" }) {
  let context = null;
  let processor = null;
  let graphPending = null;
  let stream = null;
  let source = null;
  // True while frames belong to a recording; otherwise they feed the pre-roll.
  let live = false;
  let prepared = null;
  // Opens still in flight; warmUp() must not park the context under them.
  let opening = 0;

  function handleFrame(frame) {
    if (live) {
      onFrame(frame);
      return;
    }
    if (!prepared) return;
    prepared.frames.push(frame);
    prepared.sampleCount += frame.samples.length;
    const limit = (context.sampleRate * PREROLL_MS) / 1000;
    while (prepared.sampleCount - prepared.frames[0].samples.length >= limit) {
      prepared.sampleCount -= prepared.frames.shift().samples.length;
    }
  }

  async function ensureGraph() {
    if (context && context.state !== "closed") {
      if (context.state === "suspended") await context.resume();
      return;
    }
    if (!graphPending) {
      graphPending = (async () => {
        const next = new AudioContext();
        try {
          // AudioWorklet runs capture on the audio thread, so a busy main
          // thread cannot cause dropouts.
          await next.audioWorklet.addModule(workletUrl);
          const node = new AudioWorkletNode(next, "capture-processor", {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            channelCount: 1,
          });
          // A muted sink keeps the graph pulling audio through the worklet.
          const sink = next.createGain();
          sink.gain.value = 0;
          node.connect(sink);
          sink.connect(next.destination);
          node.port.onmessage = (event) => handleFrame(event.data);
          context = next;
          processor = node;
        } catch (error) {
          next.close().catch(() => {});
          throw error;
        }
      })().finally(() => {
        graphPending = null;
      });
    }
    await graphPending;
  }

  // The graph and the stream are independent, so they open in parallel.
  async function openInput(attempts, isCurrent) {
    opening += 1;
    const [graph, opened] = await Promise.allSettled([
      ensureGraph(),
      openStream(attempts, isCurrent),
    ]).finally(() => {
      opening -= 1;
    });
    const input = opened.status === "fulfilled" ? opened.value : null;
    if (graph.status === "rejected") {
      stopTracks(input);
      throw graph.reason;
    }
    if (opened.status === "rejected") throw opened.reason;
    if (input && !isCurrent()) {
      stopTracks(input);
      return null;
    }
    return input;
  }

  function attach(input) {
    // Drop a partial frame the worklet kept from the previous dictation.
    processor.port.postMessage("reset");
    stream = input;
    source = context.createMediaStreamSource(input);
    source.connect(processor);
    // A suspend() from the previous dictation may still be queued; this resume
    // lands after it, so the new input always plays through.
    context.resume().catch(() => {});
  }

  function disconnect() {
    live = false;
    source?.disconnect();
    source = null;
    stopTracks(stream);
    stream = null;
    if (context?.state === "running") context.suspend().catch(() => {});
  }

  function release() {
    const entry = prepared;
    if (!entry) return;
    prepared = null;
    window.clearTimeout(entry.timer);
    // Still opening: the pending open sees it was released and closes itself.
    if (entry.attached) disconnect();
  }

  function prepare(attempts) {
    if (stream || prepared) return;
    const entry = { frames: [], sampleCount: 0, attached: false, taken: false };
    prepared = entry;
    entry.opening = openInput(attempts, () => prepared === entry || entry.taken)
      .catch(() => null)
      .then((input) => {
        if (input && prepared === entry) {
          attach(input);
          entry.attached = true;
        } else if (!entry.taken) {
          stopTracks(input);
        }
        return input;
      });
    entry.timer = window.setTimeout(release, PREPARED_TTL_MS);
  }

  // Resolves to the pre-roll frames once the microphone is live, or to null
  // when the dictation was cancelled (isCurrent() turned false) meanwhile.
  async function start(attempts, isCurrent) {
    const entry = prepared;
    if (entry) {
      prepared = null;
      entry.taken = true;
      window.clearTimeout(entry.timer);
      const input = await entry.opening;
      if (input) {
        if (!entry.attached) attach(input);
        if (!isCurrent()) {
          disconnect();
          return null;
        }
        live = true;
        return entry.frames;
      }
      // The early open failed; retry so the error reaches the user.
    }
    const input = await openInput(attempts, isCurrent);
    if (!input) return null;
    attach(input);
    live = true;
    return [];
  }

  function stop() {
    release();
    if (stream) disconnect();
    live = false;
  }

  // Builds the context ahead of the first dictation, then parks it.
  function warmUp() {
    ensureGraph()
      .then(() => {
        if (!stream && !prepared && !opening && context.state === "running") {
          return context.suspend();
        }
        return undefined;
      })
      .catch(() => {});
  }

  return {
    prepare,
    release,
    start,
    stop,
    warmUp,
    get sampleRate() {
      return context?.sampleRate;
    },
  };
}
