// Voice mode: the phone talks to the OpenAI Realtime API directly over WebRTC. Our
// server only forwards the offer (with the API key and the session) and runs the tools
// on its own connection to the call; this side plays the audio and shows the events.

import type { ServerEvent } from "./tools";

export type Call = {
  send: (event: object) => void;
  setMic: (on: boolean) => void;
  hangUp: () => void;
};

export async function startCall(options: {
  pushToTalk: boolean;
  audio: HTMLAudioElement;
  onEvent: (event: ServerEvent) => void;
  onEnd: (reason?: string) => void;
}): Promise<Call> {
  const { pushToTalk, audio, onEvent, onEnd } = options;
  // The browser cancels the echo of the assistant's voice: no need for headphones.
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const track = mic.getAudioTracks()[0];
  track.enabled = !pushToTalk; // push-to-talk: silent until "Parler"

  const pc = new RTCPeerConnection();
  pc.addTrack(track, mic);
  pc.ontrack = (event) => {
    audio.srcObject = event.streams[0];
    audio.play().catch(() => {}); // autoplay already allowed: the call started on a tap
  };

  const channel = pc.createDataChannel("oai-events");
  const send = (event: object) => {
    if (channel.readyState === "open") channel.send(JSON.stringify(event));
  };
  channel.onopen = () => send({ type: "response.create" }); // the assistant says hi first
  channel.onmessage = (message) => onEvent(JSON.parse(message.data));

  let ended = false;
  const end = (reason?: string) => {
    if (ended) return;
    ended = true;
    pc.close();
    mic.getTracks().forEach((t) => t.stop());
    audio.srcObject = null;
    onEnd(reason);
  };
  channel.onclose = () => end("L'appel a été coupé.");
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed") end("La connexion a été perdue.");
  };

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const response = await fetch(`/api/session?ptt=${pushToTalk ? 1 : 0}`, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: offer.sdp,
    });
    if (!response.ok) throw new Error("Le serveur n'a pas pu ouvrir l'appel.");
    await pc.setRemoteDescription({ type: "answer", sdp: await response.text() });
  } catch (error) {
    ended = true; // failed before the call started: nothing to report
    pc.close();
    mic.getTracks().forEach((t) => t.stop());
    throw error;
  }

  return { send, setMic: (on) => (track.enabled = on), hangUp: () => end() };
}
