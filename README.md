# Voice document assistant

Ask questions out loud about the documents in `docs/`; the assistant looks them up and
answers by voice. Built on the OpenAI Realtime API (`gpt-realtime-2.1`).

## Setup

Put your key in `.env` (ignored by git):

```
OPENAI_API_KEY=sk-...
```

## Run

```bash
uv run realtime_demo.py              # headset: interrupt the assistant any time
uv run realtime_demo.py --speakers   # laptop speakers: mic muted while it talks
uv run realtime_demo.py --push-to-talk  # noisy room: Enter to talk, Enter to send
```

Other options: `--model`, `--voice`, `--eagerness`, `--device`, `--mic`,
`--headset-mic` (see `--help`).

Noisy room (hackathon, open space): the laptop mic picks up the conversations around
you, and the voice detection takes them for you: it waits for you to finish while they
talk (stuck on `[hearing you...]`), and cancels its answers when they speak up. So the
mic goes through a noise gate: anything quieter than `--noise-gate` (default -10 dBFS)
is sent as silence, and you need to talk close to the laptop. To tune it, run
`uv run realtime_demo.py --levels`, stay silent then talk, and set the gate between the
two levels: raise it (e.g. `-6`) if it stays on `[hearing you...]`, lower it (e.g.
`-20`) if it doesn't hear you, `-90` turns it off in a quiet room. If the room is too
loud for any gate, use `--push-to-talk`: the model only hears you between two presses
of Enter, and pressing Enter while it talks interrupts it.

Bluetooth headset: by default you hear the assistant in the headset (music mode) and
talk into the laptop mic. The headset's own mic only works in call mode (HFP), whose
audio link fails every few seconds on some laptops (`corrupted SCO packet` in
`journalctl -k`), so the model stops hearing you. To use it anyway, pass
`--headset-mic`: the script switches the headset to call mode (CVSD codec) before
opening the audio streams and back on exit, and when PipeWire stops the headset's mic or
speaker it prints `[mic froze, reopening it]` and reopens the stream. To pick another
mic, pass `--mic <source>` (see `pactl list short sources`).

## How it works

- `realtime_demo.py` streams the mic to the Realtime API and plays the answer.
- `doc_tools.py` defines the two tools the model can call:
  - `list_documents`: names and titles of the files in `docs/`
  - `read_document`: full text of one file
- The instructions tell the model to always look things up, answer only from the
  documents, cite the document it used, and say when the answer isn't there.

## Your own documents

Drop `.md` or `.txt` files into `docs/` (subfolders work too). The first line is used
as the title, so start each file with a heading. Each read is capped at 30,000
characters; for large document sets, add a search tool instead of reading whole files.

The sample documents describe Nordlys Bikes, a fictional e-bike company. Questions to
try: "My display shows E04, what do I do?", "How many vacation days do I get?",
"How much is a spare battery?".
