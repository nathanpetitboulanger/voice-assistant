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
uv run realtime_demo.py              # headset: interrupt the assistant any time (or Enter)
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
2. Understand: as soon as it knows the topic, the assistant reads the bank's procedure
   sheet (`get_procedure`) and asks the details it lists, one at a time. It repeats
   each number it hears ("Dix mille euros, noté."), so a misheard one gets corrected.
   One procedure (démarche) at a time: to start another before the current one is
   finished, it first says it stops it ("J'arrête la démarche crédit en cours, pour
   commencer la démarche réclamation.").
3. Explain: it answers from the sheet only, and names it.
4. Act: it files the request by voice (`start_request`: block a card, PIN by mail,
   password reset, appointment) after a clear yes, always asked for a card block (it
   can't be undone), and reads the reference number in groups. For a loan, it first
   asks the five answers it needs (purpose, amount, duration, net monthly income, age;
   the rate comes from the purpose), then runs the simulation (`simulate_loan`), and
   runs it again as soon as the customer changes the duration.
5. Hand over: it passes the customer to a human (`transfer_to_advisor`) with a summary,
   so they don't have to repeat anything. A loan simulation is passed on to a loan
   advisor (`send_loan_to_advisor`): the assistant reads the recap and the reference
   number, and the phone page offers the recap as a PDF to download (tagged PDF/UA, so
   screen readers read it; `recap_pdf.py`, saved under `recaps/` in the terminal).
   A complaint takes four answers (reason, facts, date of the problem, product), then
   goes to an advisor at once (`send_complaint`): the assistant says it will be handled
   as soon as possible, reads the recap and the reference number, and the phone page
   offers the recap as a PDF too. A complaint that isn't about the bank is turned down.
   Anything else (balance, transfers...) gets an advisor, not a pretend answer.

It greets in one sentence, never refers to the screen, never lets the customer say a
PIN or password, and offers to block a lost card first. Files:

- `bank_assistant.py`: the terminal version; reuses the audio and Realtime loop of
  `realtime_demo.py`.
- `bank_tools.py`: the instructions and the six tools. Requests and handovers are
  simulated: the terminal (or `docker compose logs`) shows the case file the back
  office or the advisor would receive.
- `bank_docs/`: one procedure sheet per topic, in French. Their rates, fees, delays and
  phone numbers are fictional: replace them with the bank's. A new `.md` sheet becomes
  a new topic (its first line is the description the model sees). Loan rates and limits
  are also in `LOANS` in `bank_tools.py`.

Things to try: "J'ai perdu ma carte et quelqu'un a vu mon code", "Je voudrais
emprunter dix mille euros pour une voiture sur quatre ans", "J'ai hérité de huit cent
mille euros", "On m'a prélevé des frais que je ne comprends pas".

## On the web (by voice or in writing)

https://voice-assistant.nathan-petitboulanger.fr (open to everyone, no login): a public
information site with the look of Banque Populaire (their blue `#051b71`, sky blue
`#369ad4`, the Ubuntu font), marked « Démo », built around the assistant. Its pages:

- Accueil: the four démarches, with questions to tap (they open the written chat with
  the question asked), « Parler à l'assistant » / « Écrire à l'assistant », and an
  urgent « Faire opposition ». No rates or fees on the page: the assistant gives them
  from the procedure sheets, so they can't drift apart.
- Assistant, two modes with the same assistant (instructions, tools, one démarche at a
  time):
  - Voix: tap « Appeler » and talk. The phone's browser cancels the echo, so you can
    use its speaker and still interrupt the assistant. The echo cancellation can also
    muffle your voice while the assistant talks, so « Interrompre » (or Escape) cuts it
    off too, greeting included. In a noisy room, turn on « Pièce bruyante »: tap
    « Parler », ask, tap « Envoyer ». Keep the screen on during a call (the page asks the
    phone to): a locked phone stops the mic.
  - Écrit: a classic chat. The answers are read by screen readers once written, in
    full; « Arrêter » stops one.
  In both, each tool shows as a chip, a loan simulation as a card, and the recap PDFs
  as download links. A call or a chat goes on while you browse the other pages.
- Mes démarches: what the assistant did (opposition, loan passed on, complaint...),
  with the reference number and the PDF. No login: kept in this browser for 24 hours,
  like the PDFs on the server, and nothing personal (no income, age or facts).
- Accessibilité: text size, high contrast, the default mode, « Pièce bruyante ». Light
  and dark follow the phone.

How it works: by voice, the phone talks to the Realtime API directly over WebRTC.
`server.py` (FastAPI) forwards its offer to OpenAI with the API key and the session
(same instructions and tools as the terminal version), then joins the call over a
WebSocket to run the tools of `bank_tools.py`. Audio never goes through the server.
Phones only allow the mic over HTTPS (or on `localhost`). In writing, the page opens a
WebSocket to `server.py` (`/api/chat`), which opens a text-only Realtime session (same
model, `TEXT_INSTRUCTIONS`: the instructions plus a few lines on writing), relays the
customer's messages and the answers, and runs the tools the same way. `web/` is the
React page.

```bash
uv run uvicorn server:app --reload    # dev: API on :8000
cd web && npm install && npm run dev  # dev: page on :5173 (laptop browser)
docker compose up --build             # the production image, on http://localhost:8098
./deploy/deploy.sh                    # build, ship to the VPS, start, check /api/health
```

`.env`: `OPENAI_API_KEY`, `APP_PORT` (see
`.env.example`). On the VPS: `/root/code/voice-assistant`, port 8098 on loopback,
behind the host Nginx (`deploy/nginx-host.conf.template`). The written chat is a
WebSocket: Nginx needs the `location /api/chat` block of the template (Upgrade
headers), or the chat says it can't reach the assistant.

## Your own documents

Drop `.md` or `.txt` files into `docs/` (subfolders work too). The first line is used
as the title, so start each file with a heading. Each read is capped at 30,000
characters; for large document sets, add a search tool instead of reading whole files.

The sample documents describe Nordlys Bikes, a fictional e-bike company. Questions to
try: "My display shows E04, what do I do?", "How many vacation days do I get?",
"How much is a spare battery?".
