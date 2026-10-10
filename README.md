# Voice document assistant

Ask questions out loud about the documents in `docs/`; the assistant looks them up and
answers by voice. Built on the OpenAI Realtime API (`gpt-realtime-2.1-mini`).

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

## Banking assistant for blind customers

```bash
uv run bank_assistant.py                 # same audio options as realtime_demo.py
uv run bank_assistant.py --push-to-talk
```

A voice assistant for a bank's app, for blind and visually impaired customers: from
"I'm looking for" to "it's done", without looking for anything or clicking. It covers
four procedures (complaint, lost code, loan, wealth management) in five steps:

1. Express: the customer says what they need in their own words.
2. Understand: the assistant rephrases it and asks the useful details, one at a time.
3. Explain: it answers from the bank's procedure sheet (`get_procedure`) and names it.
4. Act: it files the request by voice (`start_request`: block a card, complaint, PIN
   by mail, password reset, appointment) after a clear yes, and reads the reference
   number in groups. For a loan, it first asks the five answers it needs (purpose,
   amount, duration, net monthly income, age; the rate comes from the purpose), then
   runs the simulation (`simulate_loan`), and runs it again as soon as the customer
   changes the duration.
5. Hand over: it passes the customer to a human (`transfer_to_advisor`) with a summary,
   so they don't have to repeat anything. A loan simulation is passed on to a loan
   advisor (`send_loan_to_advisor`), after reading the customer a recap.

It never refers to the screen, never lets the customer say a PIN or password, and
offers to block a lost card first. Files:

- `bank_assistant.py`: the terminal version; reuses the audio and Realtime loop of
  `realtime_demo.py`.
- `bank_tools.py`: the instructions and the five tools. Requests and handovers are
  simulated: the terminal (or `docker compose logs`) shows the case file the back
  office or the advisor would receive.
- `bank_docs/`: one procedure sheet per topic, in French. Their rates, fees, delays and
  phone numbers are fictional: replace them with the bank's. A new `.md` sheet becomes
  a new topic (its first line is the description the model sees). Loan rates and limits
  are also in `LOANS` in `bank_tools.py`.

Things to try: "J'ai perdu ma carte et quelqu'un a vu mon code", "Je voudrais
emprunter dix mille euros pour une voiture sur quatre ans", "J'ai hérité de huit cent
mille euros", "On m'a prélevé des frais que je ne comprends pas".

## On your phone (web version of the banking assistant)

https://voice-assistant.nathan-petitboulanger.fr (open to everyone, no code). Tap
« Appeler » and talk: the phone's browser cancels the echo, so you can use its speaker
and still interrupt the assistant. In a noisy room, tick « Pièce bruyante »: tap
« Parler », ask, tap « Envoyer ». Keep the screen on during a call (the page asks the
phone to): a locked phone stops the mic.

How it works: the phone talks to the Realtime API directly over WebRTC. `server.py`
(FastAPI) forwards its offer to OpenAI with the API key and the session (same
instructions and tools as the terminal version), then joins the call over a WebSocket
to run the tools of `bank_tools.py`. `web/` is the React page. Audio never goes through
the server. Phones only allow the mic over HTTPS (or on `localhost`).

```bash
uv run uvicorn server:app --reload    # dev: API on :8000
cd web && npm install && npm run dev  # dev: page on :5173 (laptop browser)
docker compose up --build             # the production image, on http://localhost:8098
./deploy/deploy.sh                    # build, ship to the VPS, start, check /api/health
```

`.env`: `OPENAI_API_KEY`, `APP_PORT` (see
`.env.example`). On the VPS: `/root/code/voice-assistant`, port 8098 on loopback,
behind the host Nginx (`deploy/nginx-host.conf.template`).

## Your own documents

Drop `.md` or `.txt` files into `docs/` (subfolders work too). The first line is used
as the title, so start each file with a heading. Each read is capped at 30,000
characters; for large document sets, add a search tool instead of reading whole files.

The sample documents describe Nordlys Bikes, a fictional e-bike company. Questions to
try: "My display shows E04, what do I do?", "How many vacation days do I get?",
"How much is a spare battery?".
