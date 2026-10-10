"""Tools the banking voice assistant can call, one per step of the journey.

- get_procedure: the bank's procedure sheet for a topic, from bank_docs/ (Explain)
- simulate_loan: monthly payment and cost of a loan, once all five answers are in (Act)
- send_loan_to_advisor: pass the final loan simulation on to an advisor (Hand over)
- start_request: block a card, file a complaint, reset a password... (Act)
- transfer_to_advisor: hand over to a human with the context (Hand over)

Requests, loan files and handovers are simulated for the demo: they print what the
back office or the advisor would receive, and return a reference number.
"""

import json
import random
import textwrap
from pathlib import Path

PROCEDURES_DIR = Path(__file__).parent / "bank_docs"

# Shared by bank_assistant.py (terminal) and server.py (phone): kept here, away from
# the audio code, so the server doesn't need PortAudio.
INSTRUCTIONS = """\
You are the voice assistant of a French bank's mobile app, made for blind and visually
impaired customers. The customer is already logged in to the app. Take them from "I'm
looking for" to "it's done" for four procedures: a complaint (réclamation), a lost or
forgotten code (code perdu), a loan (crédit), and savings and wealth management
(gestion privée). They never have to look for anything or click.

Follow five steps:
1. Express: let the customer describe their need in their own words.
2. Understand: rephrase the need in one short sentence, then ask the useful details,
   one question at a time. Ask only what the procedure sheet says is needed.
3. Explain: call get_procedure for the topic, then answer simply from the sheet only,
   and name it in a few words ("d'après la fiche Code perdu"). Never invent an amount,
   rate, delay, fee or phone number. If the sheet doesn't cover it, say so and offer
   an advisor.
4. Act: do the next step for them as soon as you have what it needs: run the loan
   simulation (see "Loan simulation" below), or file the request (start_request); you
   fill in the form by asking the questions out loud. Before start_request, say in one
   sentence exactly what you are about to do and wait for a clear yes. If the customer
   has just asked for that very action ("oui, bloquez-la"), that is the yes: don't ask
   again. Then give the reference number and what happens next.
5. Hand over: if the customer asks for a human, if the situation is complex,
   sensitive or urgent, if they sound distressed, or if you can't help, call
   transfer_to_advisor with a full summary, and tell them they won't have to repeat
   anything.

The customer can't see the screen:
- Never refer to anything visual: no "click", "button", "on screen", "menu", "see",
  no link to open. You do the steps yourself, by voice.
- Say amounts, rates and dates the way people say them ("deux cent trente-quatre
  euros par mois"). Read reference numbers and phone numbers slowly, in groups of two
  or three digits, and offer to repeat them.
- Keep each turn short: two or three sentences, ending with one clear question or a
  choice between at most three options. No lists, no markdown.
- Before calling a tool, say at most four words ("Je regarde.", "Je lance la
  simulation."), so a silence is never left unexplained.
- If the customer asks you to repeat, repeat the last important information word for
  word.
- Everything is driven by voice: at any time the customer can correct an answer
  ("non, j'ai quarante-deux ans"), change a choice, go back, start over or stop. Take
  it into account right away, without asking the other questions again.
- If the customer doesn't understand a word (TAEG, mensualité, opposition...), explain
  it in one simple sentence, with an example if it helps, then go back to where you
  were.

Loan simulation (crédit), when the customer wants to borrow or to know what a loan
would cost:
1. Collect: you need five answers: the purpose of the loan (motif), the amount, the
   duration (étalement), their net monthly income (ressources) and their age. Ask one
   question at a time, only for what they haven't said yet. Never ask for a rate: the
   bank sets it from the purpose. Don't calculate, estimate or announce any monthly
   payment before you have all five answers.
2. Calculate: as soon as you have them, call simulate_loan. Give the monthly payment,
   the rate and the total cost of the interest, then ask whether they want to change
   the duration, or that you pass this simulation on to an advisor.
3. Adjust: whenever the customer changes the duration (or the amount), call
   simulate_loan again right away with the new value and the same other answers.
   Don't ask anything again and don't ask for a confirmation. Give the new monthly
   payment and compare it with the previous one in one sentence.
4. Recap and hand over: when they ask you to pass it on, call send_loan_to_advisor
   with the final answers. Then, in this order: read them the recap it returns, word
   for word; say it has been passed on to an advisor, who will call them back, and
   when; give the reference number.
- If they ask why you need their age or income, reassure them: it's only for the
  calculation (the loan must be repaid before an age limit, and the monthly payment
  must stay affordable compared with their income), and nothing is passed on without
  their agreement. Then ask your question again.
- If the tool says the payment is over 35 % of their income, say so simply and offer a
  longer duration or a smaller amount.

Security:
- Never ask for a PIN, a password, a code received by text message, or a full card
  number. If the customer starts saying one, stop them politely: the bank never asks
  for them.
- A lost or stolen card or phone, or a code someone else may know, is urgent: your
  very first answer offers to block the card now. Ask the other questions afterwards.
- Don't give personalized investment advice: explain the options and offer the right
  advisor.
- After a consumer loan simulation, say the legal notice the tool returns, word for
  word.

Speak French, unless the customer speaks another language. When the conversation
starts, greet them in two short sentences: you are their voice banking assistant, you
can help with a complaint, a lost code, a loan, or savings and investments, and they
can interrupt you at any time.
"""

# Demo rates and limits, kept in sync with bank_docs/credit.md. purpose: (label,
# annual percentage rate (TAEG), min and max amount in euros, min and max months).
# The rate is the bank's: the customer is never asked for it.
LOANS = {
    "pret_personnel": ("prêt personnel", 5.9, 1_000, 75_000, 12, 84),
    "pret_auto": ("prêt auto", 4.9, 3_000, 75_000, 12, 84),
    "pret_travaux": ("prêt travaux", 4.5, 1_500, 75_000, 12, 120),
    "renovation_energetique": ("rénovation énergétique", 3.9, 1_500, 75_000, 12, 120),
    "pret_immobilier": ("prêt immobilier", 3.4, 50_000, 1_000_000, 84, 300),
}
MIN_AGE = 18
MAX_AGE_AT_END = 80  # the loan must be repaid before this age
MAX_DEBT_RATIO = 35  # percent of the net monthly income
CONSUMER_CREDIT_NOTICE = (
    "Un crédit vous engage et doit être remboursé. "
    "Vérifiez vos capacités de remboursement avant de vous engager."
)

# kind: (reference prefix, label, what happens next)
REQUESTS = {
    "card_block": (
        "OPP",
        "Opposition sur la carte",
        (
            "La carte est bloquée immédiatement. Une nouvelle carte avec un nouveau code"
            " arrive par courrier sous 7 jours ouvrés."
        ),
    ),
    "complaint": (
        "REC",
        "Réclamation",
        "Accusé de réception envoyé par SMS et e-mail. Réponse sous 10 jours ouvrés.",
    ),
    "pin_reissue": (
        "COD",
        "Réédition du code de la carte",
        (
            "Le code arrive par courrier sous 5 à 7 jours ouvrés, au format demandé"
            " (braille, gros caractères ou standard). Frais : 10 euros."
        ),
    ),
    "password_reset": (
        "MDP",
        "Réinitialisation du mot de passe",
        (
            "Un SMS avec un lien de réinitialisation, valable 30 minutes, vient d'être"
            " envoyé au numéro enregistré."
        ),
    ),
    "appointment": (
        "RDV",
        "Rendez-vous",
        (
            "Le conseiller appelle le client au numéro enregistré au créneau convenu."
            " Confirmation par SMS."
        ),
    ),
}

# team: (label, when the customer gets a human)
TEAMS = {
    "advisor": ("Conseiller clientèle", "mise en relation, attente estimée 3 minutes"),
    "credit": ("Conseiller crédit", "rappel sous 48 heures"),
    "fraud": ("Service fraude", "mise en relation, attente estimée 1 minute"),
    "complaints": (
        "Service relations clientèle",
        "mise en relation, attente estimée 5 minutes",
    ),
    "mortgage": ("Conseiller crédit immobilier", "rappel sous 24 heures"),
    "wealth": ("Conseiller en gestion de patrimoine", "rappel sous 7 jours"),
    "private_banking": ("Banque privée", "rappel sous 48 heures"),
}


def _sheets():
    return sorted(PROCEDURES_DIR.glob("*.md"))


def _title(path):
    lines = path.read_text().splitlines()
    first_line = next((line for line in lines if line.strip()), "")
    return first_line.lstrip("# ").strip() or path.stem


# The five answers a loan simulation needs, all asked to the customer.
LOAN_ANSWERS = {
    "type": "object",
    "properties": {
        "purpose": {
            "type": "string",
            "enum": list(LOANS),
            "description": "What the loan is for (motif): pret_auto for a car,"
            " pret_travaux for works, renovation_energetique for insulation or heating,"
            " pret_immobilier to buy a home, pret_personnel for anything else",
        },
        "amount": {"type": "number", "description": "Amount borrowed, in euros"},
        "months": {
            "type": "integer",
            "description": "Duration (étalement), in months: 4 years is 48",
        },
        "monthly_income": {
            "type": "number",
            "description": "Net monthly income (ressources), in euros",
        },
        "age": {"type": "integer", "description": "The customer's age, in years"},
    },
    "required": ["purpose", "amount", "months", "monthly_income", "age"],
}

TOOLS = [
    {
        "type": "function",
        "name": "get_procedure",
        "description": (
            "Read the bank's procedure sheet for a topic: what to ask, the rules, delays"
            " and fees, and what you can do for the customer. Call it before explaining"
            " anything about the topic."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "topic": {
                    "type": "string",
                    "enum": [path.stem for path in _sheets()],
                    "description": "; ".join(
                        f"{path.stem}: {_title(path)}" for path in _sheets()
                    ),
                }
            },
            "required": ["topic"],
        },
    },
    {
        "type": "function",
        "name": "simulate_loan",
        "description": (
            "Simulate a loan: monthly payment, rate and total cost. No commitment. Only"
            " call it once the customer has given all five answers, and again right away"
            " each time they change the duration or the amount."
        ),
        "parameters": LOAN_ANSWERS,
    },
    {
        "type": "function",
        "name": "send_loan_to_advisor",
        "description": (
            "Pass the final loan simulation on to a loan advisor, who calls the customer"
            " back. Returns the recap to read to the customer and a reference number."
            " Only call it when the customer asked for it."
        ),
        "parameters": LOAN_ANSWERS,
    },
    {
        "type": "function",
        "name": "start_request",
        "description": (
            "File a request for the customer, who is logged in to the app. Only call it"
            " after telling the customer exactly what you will do and getting a clear yes."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "kind": {
                    "type": "string",
                    "enum": list(REQUESTS),
                    "description": "card_block: block a lost or stolen card (opposition);"
                    " complaint: file a complaint; pin_reissue: send the card PIN again"
                    " by mail; password_reset: text a password reset link;"
                    " loan_application: apply for a consumer loan; appointment: book"
                    " a call with an advisor",
                },
                "summary": {
                    "type": "string",
                    "description": "In French, everything the back office needs: the"
                    " facts, dates, amounts, choices and preferences the customer gave",
                },
            },
            "required": ["kind", "summary"],
        },
    },
    {
        "type": "function",
        "name": "transfer_to_advisor",
        "description": (
            "Hand the conversation over to a human advisor, with the context so the"
            " customer doesn't have to repeat anything."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "team": {"type": "string", "enum": list(TEAMS)},
                "urgency": {"type": "string", "enum": ["normal", "urgent"]},
                "summary": {
                    "type": "string",
                    "description": "In French: the customer's need, what you explained,"
                    " what was done (with reference numbers) and what is left to do",
                },
            },
            "required": ["team", "urgency", "summary"],
        },
    },
]


def get_procedure(topic):
    for path in _sheets():
        if path.stem == topic.strip().lower():
            name = _title(path).split(":")[0].strip()
            return {"source": f"fiche {name}", "content": path.read_text()}
    topics = [path.stem for path in _sheets()]
    return {"error": f"No procedure sheet {topic!r}. Topics: {topics}"}


def simulate_loan(
    purpose=None, amount=None, months=None, monthly_income=None, age=None
):
    answers = {
        "purpose": purpose,
        "amount": amount,
        "months": months,
        "monthly_income": monthly_income,
        "age": age,
    }
    missing = [name for name, value in answers.items() if not value]
    if missing:  # no calculation on half the answers
        return {
            "error": f"Missing: {', '.join(missing)}. Ask the customer, one question at"
            " a time, then simulate."
        }
    label, rate, min_amount, max_amount, min_months, max_months = LOANS[purpose]
    amount, months, age = float(amount), int(months), int(age)
    if age < MIN_AGE:
        return {"error": f"Loans are for customers aged {MIN_AGE} or over."}
    if not (min_amount <= amount <= max_amount and min_months <= months <= max_months):
        return {
            "error": f"{label}: from {min_amount} to {max_amount} euros, over"
            f" {min_months} to {max_months} months"
        }
    if age * 12 + months > MAX_AGE_AT_END * 12:
        return {
            "error": f"The loan must be repaid before age {MAX_AGE_AT_END}: at {age},"
            f" at most {(MAX_AGE_AT_END - age) * 12} months"
        }
    # The TAEG is an annual equivalent rate: turn it into the matching monthly one.
    monthly_rate = (1 + rate / 100) ** (1 / 12) - 1
    payment = amount * monthly_rate / (1 - (1 + monthly_rate) ** -months)
    ratio = 100 * payment / float(monthly_income)  # this loan only, not other loans
    result = {
        "purpose": label,
        "amount_eur": amount,
        "months": months,
        "annual_rate_percent": rate,
        "monthly_payment_eur": round(payment, 2),
        "total_interest_eur": round(payment * months - amount, 2),
        "monthly_income_eur": float(monthly_income),
        "age": age,
        "debt_ratio_percent": round(ratio, 1),
        f"under_{MAX_DEBT_RATIO}_percent": ratio <= MAX_DEBT_RATIO,
        "note": "Simulation indicative sans engagement, taux de démo.",
    }
    if purpose != "pret_immobilier":
        result["say_word_for_word"] = CONSUMER_CREDIT_NOTICE
    return result


def _reference(prefix):
    """E.g. "OPP 34 15 87": the voice reads it in groups, as people dictate numbers."""
    digits = str(random.randint(100_000, 999_999))
    return f"{prefix} {digits[:2]} {digits[2:4]} {digits[4:]}"


def _print_case(title, lines):
    """Show what the back office or the advisor receives."""
    print(f"\n  ╭─ {title}")
    for line in lines:
        for row in textwrap.wrap(line, 84) or [""]:
            print(f"  │ {row}")
    print("  ╰─")


def start_request(kind, summary):
    prefix, label, next_steps = REQUESTS[kind]
    reference = _reference(prefix)
    _print_case(f"Demande : {label} · {reference}", [summary])
    return {"reference": reference, "request": label, "next_steps": next_steps}


def _euros(amount):
    """French style, as read out: 1266.0 -> "1 266 euros", 187.77 -> "187,77 euros"."""
    text = f"{amount:,.2f}".replace(",", " ").replace(".", ",").removesuffix(",00")
    return f"{text} euros"


def send_loan_to_advisor(
    purpose=None, amount=None, months=None, monthly_income=None, age=None
):
    loan = simulate_loan(purpose, amount, months, monthly_income, age)
    if "error" in loan:
        return loan
    team, when = TEAMS["mortgage" if purpose == "pret_immobilier" else "credit"]
    reference = _reference("CRE")
    rate = f"{loan['annual_rate_percent']:g}".replace(".", ",")
    # Built here rather than by the model, so the customer hears every figure.
    recap = (
        f"{loan['purpose'].capitalize()} : {_euros(loan['amount_eur'])} sur"
        f" {loan['months']} mois, pour {_euros(loan['monthly_income_eur'])} de revenus"
        f" nets par mois, à {loan['age']} ans : mensualité de"
        f" {_euros(loan['monthly_payment_eur'])}, taux de {rate} %, coût des intérêts"
        f" de {_euros(loan['total_interest_eur'])}."
    )
    ratio = f"{loan['debt_ratio_percent']:g}".replace(".", ",")
    _print_case(
        f"Simulation de crédit : {team} · {reference}",
        [recap, f"Taux d'endettement (ce crédit seul) : {ratio} %"],
    )
    result = {
        "recap_say_word_for_word": recap,
        "request": f"Simulation transmise au {team.lower()}",
        "advisor": team,
        "when": when,
        "reference": reference,
    }
    if "say_word_for_word" in loan:
        result["say_word_for_word"] = loan["say_word_for_word"]
    return result


def transfer_to_advisor(team, urgency, summary):
    label, wait = TEAMS[team]
    ticket = _reference("HUM")
    level = {"normal": "normale", "urgent": "urgente"}.get(urgency, urgency)
    _print_case(f"Transfert : {label} · {ticket} · urgence {level}", [summary])
    return {
        "ticket": ticket,
        "team": label,
        "when": wait,
        "context": "L'interlocuteur a reçu le résumé : le client n'a rien à répéter.",
    }


FUNCTIONS = {
    "get_procedure": get_procedure,
    "simulate_loan": simulate_loan,
    "send_loan_to_advisor": send_loan_to_advisor,
    "start_request": start_request,
    "transfer_to_advisor": transfer_to_advisor,
}


def run_tool(name, arguments):
    """Run a tool call from the model. Returns the result as a JSON string."""
    try:
        result = FUNCTIONS[name](**json.loads(arguments or "{}"))
    except Exception as e:  # report errors to the model instead of crashing the call
        result = {"error": f"{type(e).__name__}: {e}"}
    return json.dumps(result, ensure_ascii=False)
