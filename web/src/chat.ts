// Text mode: the page talks to our server over a WebSocket (/api/chat), which relays
// to a text-only Realtime session and runs the tools. The events are the Realtime
// API's (see CHAT_EVENTS in server.py).

import type { ServerEvent } from "./tools";

export type Chat = {
  send: (text: string) => void;
  cancel: () => void;
  close: () => void;
};

export function openChat(options: {
  onOpen: () => void;
  onEvent: (event: ServerEvent) => void;
  onEnd: (opened: boolean) => void;
}): Chat {
  const { onOpen, onEvent, onEnd } = options;
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${scheme}://${location.host}/api/chat`);
  let opened = false;
  let closed = false;

  socket.onopen = () => {
    opened = true;
    onOpen();
  };
  socket.onmessage = (message) => onEvent(JSON.parse(message.data));
  socket.onclose = () => {
    if (!closed) onEnd(opened); // not when the page closed it itself
    closed = true;
  };

  const post = (event: object) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
  };
  return {
    send: (text) => post({ type: "message", text }),
    cancel: () => post({ type: "cancel" }),
    close: () => {
      closed = true;
      socket.close();
    },
  };
}
