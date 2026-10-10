# Notes for agents

Voice Q&A demo over `docs/` with the OpenAI Realtime API (`realtime_demo.py`).
`bank_assistant.py` reuses its audio loop (`parse_args`, `run`) for a banking assistant
for blind customers: tools in `bank_tools.py`, procedure sheets in `bank_docs/`.
`server.py` + `web/` is the web version of the bank assistant: a public site (no login),
IAIMPACT's front (BPCE Compass: a banking app in a phone frame, Compass as a sheet over
it), by voice (WebRTC to OpenAI, tools run server-side over the call's `call_id`
WebSocket) or in writing (`/api/chat` WebSocket: the server relays a text-only Realtime
session, same model and tools, `TEXT_INSTRUCTIONS`); deployed with `deploy/deploy.sh`.
The host Nginx needs the Upgrade headers for `/api/chat` (see
`deploy/nginx-host.conf.template`), or the written chat gets a 404. The screens show a
read-only fictional customer (`demo_customer.py`, `GET /api/customer`); the assistant
never reads it. In `web/src/lib`, `tools.ts` turns the tool calls into chips, cards,
démarches and the app's response (card opposed, Mes démarches) for both modes, keep its
labels in sync with `bank_tools.py`; the app's texts (`site.ts`) give no figures, the
assistant does. `INSTRUCTIONS` lives in `bank_tools.py` so the server doesn't import the
audio code.
Keep it short (gpt-realtime mini follows fewer rules well): topic rules go in the
procedure sheets, and fixed wording (loan figures, legal notice, recap) goes in the
tools' `say_word_for_word`. Everything the model reads (`INSTRUCTIONS`, tool and
parameter descriptions, tool errors) is in French, for a French accent; names and
enum values stay in English. The recap PDFs, loan and complaint (`recap_pdf.py`,
WeasyPrint, needs Pango) go to `RECAPS_DIR` (`recaps/`, `/tmp/recaps` in Docker), served
at `/api/recaps/`. One procedure (démarche) at a time per call: `Conversation` in
`bank_tools.py` (one per call in `server.py`, one per run in `bank_assistant.py`) only
runs a procedure's tools while it is in progress, and makes `get_procedure` say that it
stops the unfinished one.
Dev machine: Arch, PipeWire 1.6.9, MediaTek MT7921 Wi-Fi/Bluetooth card (USB `13d3:3563`,
`btusb`), Sony WH-CH520 Bluetooth headset, built-in laptop mic.

## Which mic is used

The headset is the default mic, so the script records from the laptop mic instead
(`alsa_input.pci-0000_06_00.6.analog-stereo`) and plays the answers in the headset (A2DP).
`--headset-mic` records from the headset (call mode, HFP) instead.

## Laptop mic in a noisy room (hackathon)

- The laptop mic picks up nearby conversations clearly (they get transcribed). The voice
  detection takes them for the user: it stays on `[hearing you...]` for 10 to 20+ s, and
  `turn_detected` cancels answers, including the greeting.
- A higher `server_vad` threshold (0.7, 0.85) doesn't help: the background is real speech.
- Room measured at -21 dBFS median, -13 dBFS p90 (20 ms blocks). `NoiseGate` sends silence
  below `--noise-gate` (default -10 dBFS). Longest time stuck listening on the live room:
  17 s at -15, 6 s at -12, 3.5 s at -10. Downsides: the user must talk close to the
  laptop, and loud bursts from the room still get through now and then.
- `--levels` shows the mic level, to tune the gate. `--push-to-talk` (Enter to talk,
  Enter to send, no voice detection) works whatever the noise.

## Headset mic (`--headset-mic`)

- Symptom: `[mic froze, reopening it]` every 10 to 20 s. Logs: wireplumber
  `Failure in Bluetooth audio transport`, then kernel `corrupted SCO packet` and
  `SCO packet for unknown connection handle 3584`.
- Trigger: playing audio into the headset in call mode. With silence played, the call link
  held for 40 to 45 s with zero errors (CVSD and mSBC, `pulse` and `pipewire` devices).
  With speech-like audio played, it failed twice in 40 s. So the assistant's own voice
  breaks the link, and reopening the streams can't fix it.
- Not a Wi-Fi conflict (Wi-Fi is on 5 GHz) and not USB power saving (active during calls).
  The kernel's SCO workaround is already in 7.2. The cause is likely the MT7921 driver or
  firmware (USB call audio in both directions at once). Not fixable in the app: use the
  laptop mic, or a wired headset.
- Untested: whether quieter playback avoids it, and the HCI disconnect reason (`btmon`
  needs root).

## Wired USB headset (the fix)

C-Media USB Audio Device (`0d8c:0012`): PipeWire makes its mic the default source, so the
script records from it. The room through it is about -64 dBFS (vs -21 on the laptop mic),
so the noise gate is off by default with any mic other than the laptop's (it would mute the
user's voice). The output follows the default sink, which may still be the Bluetooth headset.

## Debugging tips

- `[hearing you...]` followed by nothing means the server is still detecting speech.
  Log every server event except the `.delta` ones (`speech_started/stopped`, and
  `response.done` status and reason) to see what the server is doing.
- Talking over the greeting does cancel it server-side (`response.done` status
  `cancelled`, reason `turn_detected`, tested over WebSocket). When it can't be stopped,
  the voice isn't reaching the voice detection (noise gate, `--speakers`, phone echo
  cancellation): Enter (terminal) and « Interrompre » (phone) cut it off without the mic.
- `journalctl -k | grep SCO` and `journalctl --user | grep "audio transport"` for the
  headset.
