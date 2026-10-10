"""Web version of the banking assistant (bank_assistant.py): by voice or in writing.

Voice: the phone talks to the OpenAI Realtime API directly over WebRTC: audio both
ways, with the browser's echo cancellation, so the assistant can be interrupted on the
phone's speaker. This server only:

- forwards the phone's SDP offer to OpenAI with the API key and the session
  (POST /api/session), so the key, the instructions and the tools stay here;
- joins the same call over a WebSocket (its call_id) to run the tools of bank_tools.py.

Text (WebSocket /api/chat): the same assistant, model and tools, in a text-only
Realtime session that this server opens and relays to the page.

It also serves the recap PDFs, loan or complaint (GET /api/recaps/<name>), and the
React page (web/dist).

    uv run uvicorn server:app --reload   # with: cd web && npm run dev
"""

import asyncio
import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit

import httpx
import websockets
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from starlette.websockets import WebSocketDisconnect, WebSocketState

from bank_tools import (
    INSTRUCTIONS,
    RECAPS_DIR,
    TEXT_INSTRUCTIONS,
    TOOLS,
    Conversation,
    run_tool,
)

load_dotenv()
OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
MODEL = os.environ.get("REALTIME_MODEL", "gpt-realtime-2.1-mini")
VOICE = os.environ.get("REALTIME_VOICE", "marin")  # see realtime_demo.py --voice
REALTIME_URL = "https://api.openai.com/v1/realtime"
WEB_DIR = Path(os.environ.get("WEB_DIR", Path(__file__).parent / "web" / "dist"))

app = FastAPI()
call_tasks = set()  # running call tasks, kept so asyncio doesn't garbage-collect them


def session_config(push_to_talk):
    """Same session as the terminal version, minus the audio format: WebRTC uses Opus."""
    return {
        "type": "realtime",
        "model": MODEL,
        "instructions": INSTRUCTIONS,
        "tools": TOOLS,
        "tool_choice": "auto",
        "audio": {
            "input": {
                "noise_reduction": {"type": "near_field"},  # phone close to the mouth
                "transcription": {"model": "gpt-4o-mini-transcribe"},
                # Push-to-talk: the page commits the audio itself (Parler, Envoyer).
                "turn_detection": None
                if push_to_talk
                else {"type": "semantic_vad", "eagerness": "auto"},
            },
            "output": {"voice": VOICE, "speed": 1.3},
        },
    }


# The text chat: same instructions (plus a few lines on writing) and tools, no audio.
TEXT_SESSION = {
    "type": "realtime",
    "output_modalities": ["text"],
    "instructions": TEXT_INSTRUCTIONS,
    "tools": TOOLS,
    "tool_choice": "auto",
}
# What the chat page needs: the answer as it is written, the tool calls (response.done)
# and their results (conversation.item.done), and the errors.
CHAT_EVENTS = {
    "response.created",
    "response.output_text.delta",
    "response.output_text.done",
    "response.done",
    "conversation.item.done",
    "error",
}
MAX_MESSAGE = 2000  # characters: a customer's message, not a document


async def send(ws, event):
    await ws.send(json.dumps(event))


async def run_tool_calls(ws, response, conversation):
    """Run the tools the model asked for, send back the results, and let it answer."""
    calls = [item for item in response["output"] if item["type"] == "function_call"]
    if not calls or response["status"] != "completed":
        return
    for call in calls:
        print(f"[tool] {call['name']}({call['arguments']})", flush=True)
        await send(
            ws,
            {
                "type": "conversation.item.create",
                "item": {
                    "type": "function_call_output",
                    "call_id": call["call_id"],
                    # in a thread: a recap PDF takes half a second
                    "output": await asyncio.to_thread(
                        run_tool, call["name"], call["arguments"], conversation
                    ),
                },
            },
        )
    await send(ws, {"type": "response.create"})


async def run_call(call_id):
    """Run the tools of one call, until the phone hangs up (OpenAI closes the socket)."""
    try:
        async with websockets.connect(
            f"wss://api.openai.com/v1/realtime?call_id={call_id}",
            additional_headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            max_size=None,
        ) as ws:
            print(f"[call] {call_id} started", flush=True)
            conversation = Conversation()  # the procedure in progress in this call
            async for message in ws:
                event = json.loads(message)
                match event["type"]:
                    case "response.done":
                        await run_tool_calls(ws, event["response"], conversation)
                    case "error":
                        print(f"[error] {event['error'].get('message')}", flush=True)
    except websockets.ConnectionClosed:
        pass  # how a call ends when the phone drops off
    except (OSError, websockets.WebSocketException) as e:
        print(f"[call] {call_id}: {type(e).__name__}: {e}", flush=True)
    print(f"[call] {call_id} ended", flush=True)


async def page_to_openai(page, ws):
    """What the customer writes ({"type": "message", "text": ...}), and « Arrêter »
    ({"type": "cancel"}). Nothing else reaches OpenAI: the page can't change the session."""
    async for message in page.iter_text():  # ends when the page leaves
        try:
            event = json.loads(message)
        except json.JSONDecodeError:
            continue
        if not isinstance(event, dict):
            continue
        text = event.get("text")
        if event.get("type") == "cancel":
            await send(ws, {"type": "response.cancel"})
        elif event.get("type") == "message" and isinstance(text, str) and text.strip():
            item = {
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": text.strip()[:MAX_MESSAGE]}],
            }
            await send(ws, {"type": "conversation.item.create", "item": item})
            await send(ws, {"type": "response.create"})


async def openai_to_page(ws, page, conversation):
    """Relay the answer to the page, and run the tools as in a call."""
    async for message in ws:  # ends when OpenAI closes the session
        event = json.loads(message)
        if event["type"] in CHAT_EVENTS:
            await page.send_text(message)
        match event["type"]:
            case "response.done":
                await run_tool_calls(ws, event["response"], conversation)
            case "error":
                print(f"[chat error] {event['error'].get('message')}", flush=True)


@app.websocket("/api/chat")
async def chat(page: WebSocket):
    """The text chat: one Realtime session in text mode per page, until either side
    leaves."""
    # Only our own page: another site can't open a chat with our key in its visitors'
    # browsers (browsers don't apply CORS to WebSockets).
    origin = page.headers.get("origin")
    if origin and urlsplit(origin).netloc != page.headers.get("host"):
        await page.close(code=1008)
        return
    await page.accept()
    try:
        async with websockets.connect(
            f"wss://api.openai.com/v1/realtime?model={MODEL}",
            additional_headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            max_size=None,
        ) as ws:
            print("[chat] started", flush=True)
            await send(ws, {"type": "session.update", "session": TEXT_SESSION})
            await send(ws, {"type": "response.create"})  # the assistant says hi first
            conversation = Conversation()  # the procedure in progress in this chat
            tasks = [
                asyncio.create_task(page_to_openai(page, ws)),
                asyncio.create_task(openai_to_page(ws, page, conversation)),
            ]
            done, pending = await asyncio.wait(
                tasks, return_when=asyncio.FIRST_COMPLETED
            )
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            for task in done:
                error = task.exception()
                if error and not isinstance(
                    error, (WebSocketDisconnect, websockets.ConnectionClosed)
                ):
                    print(f"[chat] {type(error).__name__}: {error}", flush=True)
    except (OSError, websockets.WebSocketException) as e:  # OpenAI unreachable
        print(f"[chat] {type(e).__name__}: {e}", flush=True)
    print("[chat] ended", flush=True)
    if page.client_state == WebSocketState.CONNECTED:  # OpenAI left first
        try:
            await page.close()
        except RuntimeError:  # the page left meanwhile
            pass


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/recaps/{name}")
def recap(name: str):
    """A recap PDF (loan, complaint). Its random name is the key: there is no login."""
    path = RECAPS_DIR / name
    if not re.fullmatch(r"[A-Za-z0-9_-]{22}\.pdf", name) or not path.is_file():
        raise HTTPException(404, "Ce récapitulatif n'existe plus.")
    return FileResponse(path, media_type="application/pdf")


@app.post("/api/session")
async def create_session(request: Request, ptt: bool = False):
    """Body: the phone's SDP offer. Returns OpenAI's SDP answer."""
    offer = (await request.body()).decode()
    async with httpx.AsyncClient(timeout=20) as client:
        answer = await client.post(
            f"{REALTIME_URL}/calls",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            # multipart form fields, without file names
            files={
                "sdp": (None, offer),
                "session": (None, json.dumps(session_config(ptt))),
            },
        )
    if answer.is_error:
        print(f"[session] OpenAI {answer.status_code}: {answer.text}", flush=True)
        raise HTTPException(502, "OpenAI a refusé l'appel.")
    # Location: /v1/realtime/calls/rtc_... is the call our WebSocket joins.
    call_id = answer.headers["location"].rstrip("/").rsplit("/", 1)[-1]
    task = asyncio.create_task(run_call(call_id))
    call_tasks.add(task)
    task.add_done_callback(call_tasks.discard)
    return PlainTextResponse(answer.text, media_type="application/sdp")


if WEB_DIR.is_dir():  # after the API routes, so /api/... isn't served as a file
    app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
