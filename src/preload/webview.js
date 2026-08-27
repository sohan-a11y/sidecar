console.log("[SidecarWebview] Preload script loaded successfully.");

const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

navigator.mediaDevices.getUserMedia = async function (constraints) {
  // If the page requests audio and NOT video, we override it to mix system loopback audio
  if (constraints && constraints.audio && !constraints.video) {
    console.log("[SidecarWebview] Overriding getUserMedia to mix system loopback audio.");
    try {
      // 1. Capture the physical microphone stream
      const micStream = await originalGetUserMedia(constraints);
      
      // 2. Capture the system loopback audio stream
      let loopbackStream;
      try {
        console.log("[SidecarWebview] Requesting getDisplayMedia for system audio loopback...");
        loopbackStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: {
            systemAudio: "include"
          }
        });
      } catch (err) {
        console.error("[SidecarWebview] Failed to acquire system loopback stream:", err);
        // Fall back to pure microphone stream if loopback capture fails or is cancelled
        return micStream;
      }
      
      const systemAudioTracks = loopbackStream.getAudioTracks();
      if (systemAudioTracks.length === 0) {
        console.warn("[SidecarWebview] No audio tracks found in loopback stream. Using pure mic.");
        // Stop loopback tracks to clean up the screen share session
        loopbackStream.getTracks().forEach(t => t.stop());
        return micStream;
      }
      
      console.log("[SidecarWebview] Mixing microphone and loopback streams...");
      
      // 3. Mix physical microphone and system loopback stream using Web Audio API
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      
      const micSource = audioCtx.createMediaStreamSource(micStream);
      const systemSource = audioCtx.createMediaStreamSource(loopbackStream);
      const destination = audioCtx.createMediaStreamDestination();
      
      micSource.connect(destination);
      systemSource.connect(destination);
      
      const mixedTrack = destination.stream.getAudioTracks()[0];
      const originalStop = mixedTrack.stop.bind(mixedTrack);
      
      // Wrap stop method of the mixed track to clean up all source streams and release resources
      mixedTrack.stop = function () {
        console.log("[SidecarWebview] mixedTrack.stop() called. Cleaning up streams...");
        try {
          originalStop();
        } catch (e) {
          console.error(e);
        }
        try {
          micStream.getTracks().forEach(t => t.stop());
        } catch (e) {
          console.error(e);
        }
        try {
          loopbackStream.getTracks().forEach(t => t.stop());
        } catch (e) {
          console.error(e);
        }
        try {
          audioCtx.close().catch(() => {});
        } catch (e) {
          console.error(e);
        }
      };
      
      console.log("[SidecarWebview] Mixed audio stream ready.");
      return destination.stream;
    } catch (e) {
      console.error("[SidecarWebview] Error overriding getUserMedia:", e);
      return originalGetUserMedia(constraints);
    }
  }
  
  // For any other case, use original getUserMedia
  return originalGetUserMedia(constraints);
};
