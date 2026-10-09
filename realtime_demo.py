# /// script
# requires-python = ">=3.10"
# dependencies = ["websockets>=14", "sounddevice", "numpy", "python-dotenv"]
# ///
"""Voice Q&A agent over the documents in docs/, using the OpenAI Realtime API.

Ask a question out loud; the agent looks it up with the list_documents and
read_document tools (see doc_tools.py) and answers. Interrupt it any time by talking.

    uv run realtime_demo.py              # headphones (full duplex, barge-in)
    uv run realtime_demo.py --speakers   # laptop speakers (mic muted while it talks)
"""

import argparse
import asyncio
import base64
import json
import os
import subprocess
import threading
import time

import numpy as np
import sounddevice as sd
import websockets
from dotenv import load_dotenv

from doc_tools import TOOLS, run_tool

RATE = 24000  # Realtime API audio: 24 kHz, 16-bit, mono PCM
CHUNK = 480  # 20 ms of audio per mic/speaker block

INSTRUCTIONS = """\
You are a voice assistant that answers questions about a set of documents.
Be concise and precise: every word you say costs the user time.

- To answer, always look the information up: call list_documents, then read_document
  on the documents that look relevant. Never answer from memory or general knowledge.
- Before looking things up, say at most two or three words ("Let me check.") once per
  question, not before every tool call.
- Answer in one or two short sentences. Start with the answer itself: no preamble,
  no restating the question, no summary of your search, no closing offer of help.
- Be precise: give the exact figures, dates, names and terms from the documents
  rather than vague paraphrases. Name the source document in a few words.
- If the documents don't contain the answer, say so in one sentence. If the question
  is ambiguous, ask one short clarifying question instead of guessing.
- Only give more detail when the user asks for it.
- Spoken style: no lists, no markdown.
- Speak in the same language as the user, even if the documents are in another one.
- When the conversation starts, greet the user in one short sentence that says what
  the documents are about.
"""

# Used with --no-tools: a plain voice assistant, to rule out the tools when debugging.
PLAIN_INSTRUCTIONS = (
    "You are a friendly voice assistant. Keep answers short and conversational, "
    "like a real phone call. Speak in the same language as the user."
)


class Player:
    """Plays streamed PCM16 audio and tracks how much of the current item was heard."""

    def __init__(self):
        self.buf = bytearray()
        self.lock = threading.Lock()
        self.item_id = None
        self.played = 0  # samples of item_id handed to the speakers
        self.interrupted = None  # item_id whose late audio deltas must be dropped
        self.last_sound = 0.0
        self.stream = sd.OutputStream(
            samplerate=RATE,
            channels=1,
            dtype="int16",
            blocksize=CHUNK,
            callback=self._callback,
        )

    def _callback(self, outdata, frames, _time, _status):
        n = frames * 2
        with self.lock:
            chunk = bytes(self.buf[:n])
            del self.buf[:n]
            self.played += len(chunk) // 2
            if chunk:
                self.last_sound = time.monotonic()
        outdata[:] = np.frombuffer(chunk.ljust(n, b"\0"), dtype=np.int16).reshape(-1, 1)

    def add(self, item_id, pcm):
        with self.lock:
            if item_id == self.interrupted:
                return
            if item_id != self.item_id:
                self.item_id, self.played = item_id, 0
            self.buf.extend(pcm)

    def interrupt(self):
        """Drop unplayed audio. Returns (item_id, ms actually played) or None if silent."""
        with self.lock:
            if not self.buf:
                return None
            self.buf.clear()
            self.interrupted = self.item_id
            return self.item_id, self.played * 1000 // RATE

    def is_speaking(self, tail=0.4):
        with self.lock:
            return bool(self.buf) or time.monotonic() - self.last_sound < tail


def pick_audio_device():
    """Raw ALSA hw devices often reject 24 kHz; PipeWire/Pulse resample for us."""
    names = [d["name"] for d in sd.query_devices()]
    return next((n for n in ("pipewire", "pulse", "default") if n in names), None)


def bluetooth_call_mode():
    """Put a Bluetooth headset in call mode (HFP) before any audio stream opens.

    Its mic only works in call mode. Left to PipeWire, the switch happens when the mic
    opens and freezes both streams, so the model never hears you. Some adapters also
    fail on the default mSBC codec ("SCO packet for unknown connection handle"), so use
    CVSD. Returns (card, previous profile) to restore on exit, or None.
    """
    try:
        source = subprocess.run(
            ["pactl", "get-default-source"], capture_output=True, text=True
        ).stdout.strip()
        cards = json.loads(
            subprocess.run(
                ["pactl", "-f", "json", "list", "cards"], capture_output=True, text=True
            ).stdout
        )
    except (FileNotFoundError, json.JSONDecodeError):  # no PulseAudio/PipeWire tools
        return None
    if not source.startswith("bluez_input."):
        return None
    # bluez_input.E8:9E:13:F6:58:17 (or E8_9E_...) belongs to bluez_card.E8_9E_...
    address = source.removeprefix("bluez_input.").split(".")[0].replace(":", "_")
    for card in cards:
        if card["name"] == f"bluez_card.{address}":
            if "headset-head-unit-cvsd" not in card["profiles"]:
                return None
            subprocess.run(
                ["pactl", "set-card-profile", card["name"], "headset-head-unit-cvsd"],
                check=True,
            )
            time.sleep(2)  # let PipeWire create the call-mode mic and speaker
            print("Bluetooth headset switched to call mode (restored on exit).")
            return card["name"], card["active_profile"]
    return None


async def send(ws, event):
    await ws.send(json.dumps(event))


async def stream_mic(ws, player, half_duplex):
    loop = asyncio.get_running_loop()
    q = asyncio.Queue()

    def callback(indata, _frames, _time, _status):
        loop.call_soon_threadsafe(q.put_nowait, bytes(indata))

    with sd.RawInputStream(
        samplerate=RATE, channels=1, dtype="int16", blocksize=CHUNK, callback=callback
    ):
        while True:
            pcm = await q.get()
            if half_duplex and player.is_speaking():
                continue  # don't let the model hear itself through the speakers
            await send(
                ws,
                {
                    "type": "input_audio_buffer.append",
                    "audio": base64.b64encode(pcm).decode(),
                },
            )


async def run_tool_calls(ws, response):
    """Run the tools the model asked for, send back the results, and let it answer."""
    calls = [item for item in response["output"] if item["type"] == "function_call"]
    if not calls or response["status"] != "completed":
        return
    for call in calls:
        print(f"\n  [tool] {call['name']}({call['arguments']})")
        await send(
            ws,
            {
                "type": "conversation.item.create",
                "item": {
                    "type": "function_call_output",
                    "call_id": call["call_id"],
                    "output": run_tool(call["name"], call["arguments"]),
                },
            },
        )
    await send(ws, {"type": "response.create"})


async def handle_events(ws, player):
    speaking_item = None
    async for message in ws:
        event = json.loads(message)
        match event["type"]:
            case "response.output_audio.delta":
                player.add(event["item_id"], base64.b64decode(event["delta"]))
            case "response.output_audio_transcript.delta":
                if event["item_id"] != speaking_item:
                    speaking_item = event["item_id"]
                    print("\nassistant> ", end="")
                print(event["delta"], end="", flush=True)
            case "response.output_audio_transcript.done":
                print()
            case "input_audio_buffer.speech_started":
                print("\n  [hearing you...]", flush=True)
                # User started talking: stop playback and tell the server what was actually heard,
                # so the conversation history matches reality.
                if cut := player.interrupt():
                    item_id, played_ms = cut
                    await send(
                        ws,
                        {
                            "type": "conversation.item.truncate",
                            "item_id": item_id,
                            "content_index": 0,
                            "audio_end_ms": played_ms,
                        },
                    )
                    print(" [interrupted]")
            case "conversation.item.input_audio_transcription.completed":
                print(f"\n  you> {event['transcript'].strip()}")
            case "response.done":
                # Tool calls are handled once the response is complete: sending
                # response.create while one is still active would be rejected.
                await run_tool_calls(ws, event["response"])
            case "error":
                print(f"\n[error] {event['error'].get('message')}")


def session_config(args):
    tools = {} if args.no_tools else {"tools": TOOLS, "tool_choice": "auto"}
    return {
        "type": "session.update",
        "session": {
            "type": "realtime",
            "instructions": PLAIN_INSTRUCTIONS if args.no_tools else INSTRUCTIONS,
            **tools,
            "audio": {
                "input": {
                    "format": {"type": "audio/pcm", "rate": RATE},
                    "noise_reduction": {
                        "type": "far_field" if args.speakers else "near_field"
                    },
                    "transcription": {"model": "gpt-4o-mini-transcribe"},
                    # semantic_vad waits until you've finished your thought, not just a pause
                    "turn_detection": {
                        "type": "semantic_vad",
                        "eagerness": args.eagerness,
                    },
                },
                "output": {
                    "format": {"type": "audio/pcm", "rate": RATE},
                    "voice": args.voice,
                    "speed": args.speed,
                },
            },
        },
    }


async def main(args):
    load_dotenv()
    key = os.environ["OPENAI_API_KEY"]
    if args.mic:
        os.environ["PULSE_SOURCE"] = args.mic  # read by the "pulse" device on open
    sd.default.device = args.device or ("pulse" if args.mic else pick_audio_device())
    url = f"wss://api.openai.com/v1/realtime?model={args.model}"

    async with websockets.connect(
        url, additional_headers={"Authorization": f"Bearer {key}"}, max_size=None
    ) as ws:
        await send(ws, session_config(args))
        await send(ws, {"type": "response.create"})  # let the assistant say hi first

        player = Player()
        with player.stream:
            print(f"Connected to {args.model}. Start talking (Ctrl+C to quit).")
            await asyncio.gather(
                stream_mic(ws, player, args.speakers), handle_events(ws, player)
            )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--model", default="gpt-realtime-2.1")
    parser.add_argument(
        "--voice", default="marin", help="e.g. marin, cedar, alloy, verse"
    )
    parser.add_argument(
        "--speed",
        type=float,
        default=1.3,
        help="speaking speed, 0.25 (slow) to 1.5 (fast)",
    )
    parser.add_argument(
        "--eagerness",
        default="auto",
        choices=["low", "medium", "high", "auto"],
        help="how quickly the model jumps in after you stop talking",
    )
    parser.add_argument(
        "--speakers",
        action="store_true",
        help="no headphones: mute the mic while the assistant talks to avoid echo",
    )
    parser.add_argument(
        "--device", help="sounddevice name/index (see: python -m sounddevice)"
    )
    parser.add_argument(
        "--mic",
        help="PulseAudio/PipeWire source to record from instead of the default one"
        " (see: pactl list short sources)",
    )
    parser.add_argument(
        "--no-tools",
        action="store_true",
        help="plain voice assistant without the document tools (for debugging)",
    )
    args = parser.parse_args()
    restore = None if args.mic or args.device else bluetooth_call_mode()
    try:
        asyncio.run(main(args))
    except KeyboardInterrupt:
        print("\nbye")
    finally:
        if restore:  # back to the headset's normal (music) profile
            subprocess.run(["pactl", "set-card-profile", *restore])
