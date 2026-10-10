"""Phone version of the banking voice assistant (bank_assistant.py), for a browser.

The phone talks to the OpenAI Realtime API directly over WebRTC: audio both ways, with
the browser's echo cancellation, so the assistant can be interrupted on the phone's
speaker. This server only:

- forwards the phone's SDP offer to OpenAI with the API key and the session
  (POST /api/session), so the key, the instructions and the tools stay here;
- joins the same call over a WebSocket (its call_id) to run the tools of bank_tools.py;
- serves the React page (web/dist).

    uv run uvicorn server:app --reload   # with: cd web && npm run dev
"""

import asyncio
import json
import os
from pathlib import Path

import httpx
import websockets
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles

from bank_tools import INSTRUCTIONS, TOOLS, run_tool

load_dotenv()
OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
MODEL = os.environ.get("REALTIME_MODEL", "gpt-realtime-2.1-mini")
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
            "output": {"voice": "marin", "speed": 1.3},
        },
    }


async def send(ws, event):
    await ws.send(json.dumps(event))


async def run_tool_calls(ws, response):
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
                    "output": run_tool(call["name"], call["arguments"]),
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
            async for message in ws:
                event = json.loads(message)
                match event["type"]:
                    case "response.done":
                        await run_tool_calls(ws, event["response"])
                    case "error":
                        print(f"[error] {event['error'].get('message')}", flush=True)
    except websockets.ConnectionClosed:
        pass  # how a call ends when the phone drops off
    except (OSError, websockets.WebSocketException) as e:
        print(f"[call] {call_id}: {type(e).__name__}: {e}", flush=True)
    print(f"[call] {call_id} ended", flush=True)


@app.get("/api/health")
def health():
    return {"ok": True}


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
