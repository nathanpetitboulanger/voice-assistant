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
```

Other options: `--model`, `--voice`, `--eagerness`, `--device`, `--mic` (see `--help`).

Bluetooth headset: its mic only works in call mode (HFP), so the script switches the
headset to call mode (CVSD codec) before opening the audio streams and back on exit.
Letting PipeWire switch on its own freezes the streams, and the default mSBC codec fails
on some laptops. To use another mic instead, pass `--mic <source>` (see
`pactl list short sources`).

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
