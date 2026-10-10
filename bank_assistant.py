# /// script
# requires-python = ">=3.10"
# dependencies = ["websockets>=14", "sounddevice", "numpy", "python-dotenv", "weasyprint"]
# ///
"""Voice banking assistant for blind and visually impaired customers.

From "I'm looking for" to "it's done", without looking for anything or clicking: the
customer says what they need, and the assistant understands, explains from the bank's
procedure sheets (bank_docs/), acts (simulation, request), or hands over to a human
with the context. Four procedures: complaint, lost code, loan, wealth management.
Same audio options as realtime_demo.py.

    uv run bank_assistant.py
    uv run bank_assistant.py --push-to-talk  # noisy room: Enter to talk, Enter to send
"""

from functools import partial

from bank_tools import INSTRUCTIONS, TOOLS, Conversation, run_tool
from realtime_demo import parse_args, run

if __name__ == "__main__":
    # One conversation per run: it keeps the procedure (démarche) in progress.
    run_in_conversation = partial(run_tool, conversation=Conversation())
    run(parse_args(__doc__), INSTRUCTIONS, TOOLS, run_in_conversation)
