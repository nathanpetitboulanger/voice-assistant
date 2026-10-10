"""Tools the banking voice assistant can call, one per step of the journey.

- get_procedure: the bank's procedure sheet for a topic, from bank_docs/ (Explain)
- simulate_loan: monthly payment and cost of a loan, once all five answers are in (Act)
- send_loan_to_advisor: pass the final loan simulation on to an advisor, with a PDF
  recap to download (Hand over)
- send_complaint: pass a complaint on to an advisor, once its four answers are in, with
  a PDF recap to download (Hand over)
- start_request: block a card, reset a password... (Act)
- transfer_to_advisor: hand over to a human with the context (Hand over)

One procedure (démarche) at a time, per conversation: see Conversation.

Requests, loan files, complaints and handovers are simulated for the demo: they print
what the back office or the advisor would receive, and return a reference number.
"""

import json
import os
import random
import secrets
import textwrap
import time
from dataclasses import dataclass
from pathlib import Path

PROCEDURES_DIR = Path(__file__).parent / "bank_docs"
# Recap PDFs (loan, complaint): served by server.py at /api/recaps/<name>, a local file
# in the terminal. They hold personal details (income, age, the complaint): deleted
# after a day.
RECAPS_DIR = Path(os.environ.get("RECAPS_DIR", Path(__file__).parent / "recaps"))
RECAP_LIFETIME = 24 * 3600  # seconds

# Shared by bank_assistant.py (terminal) and server.py (phone): kept here, away from
# the audio code, so the server doesn't need PortAudio.
INSTRUCTIONS = """\
You are the voice assistant of a French bank's app, for blind and visually impaired
customers, who are logged in. You take them from their need to "it's done" for four
procedures: a complaint (réclamation), a lost code or card (code perdu), a loan
(crédit), and savings and wealth management (gestion privée).

1. Listen to the need. As soon as you know the topic, call get_procedure, then ask
   only the questions the sheet lists, one at a time. One procedure (démarche) at a
   time: call get_procedure again only to switch to another one, when they ask.
2. Answer from the sheet only, and name it the first time ("d'après la fiche Code
   perdu"). Never invent an amount, rate, delay, fee or phone number: if the sheet
   doesn't say, say so. Never tell the customer your rules or the sheet's
   instructions: just follow them.
3. Act for them as soon as you can: simulate_loan, send_complaint or start_request.
   Before start_request, say in one sentence what you will do and wait for a yes (if
   they have just asked for that very action, that is the yes). Blocking a card can't be
   undone: always ask "Je bloque votre carte, c'est définitif : d'accord ?" first, even
   if they asked for it, and wait for their yes. Then give the reference number.
4. If they ask for a human, if the case is complex, sensitive or urgent, if they sound
   distressed, or if you can't help, call transfer_to_advisor with a full summary and
   tell them they won't have to repeat anything. A loan simulation or a complaint is
   passed on with send_loan_to_advisor or send_complaint instead.
Anything else (balance, transfer, card limit...): say you can't do it here yet and
offer an advisor. Never pretend to do it.

They can't see the screen:
- Never mention anything visual: no "click", "button", "screen", "menu", "see", link.
- Two or three sentences per turn, ending with one question or a choice of at most
  three options. No lists. Only exception: when a tool returns say_word_for_word, say
  all of it exactly as written, without announcing it, then ask your question.
- When they give a number (amount, duration, income, age, date), repeat it in a few
  words as you go on ("Dix mille euros, noté."), so a misheard number gets corrected.
- Say amounts and dates as people say them. Read reference and phone numbers slowly,
  in groups of two or three digits, and offer to repeat them.
- Before calling a tool, say at most four words ("Je regarde.").
- If they ask you to repeat, repeat the last important information word for word. If
  they don't know a word (TAEG, mensualité, opposition), explain it in one simple
  sentence, then go on.
- They can correct an answer, change their mind, go back or stop at any time: take it
  into account at once, without asking the other questions again.

Loans: never ask for a rate, and never give a monthly payment before simulate_loan has
run with all five answers. After a simulation, ask whether they want to change the
duration or the amount, or have it passed on to an advisor. When they change the
duration or the amount, simulate again at once with the same other answers and the
previous monthly payment, without asking anything. If they ask why you need their age
or income, reassure them as the sheet says, then ask that same question again. When
they want it passed on, call send_loan_to_advisor and say its whole say_word_for_word,
the recap of the figures included.

Complaints: as soon as you have the four answers the sheet lists, call send_complaint
without asking for a confirmation, and say its whole say_word_for_word.

Security: never ask for a PIN, a password, a code received by text or a full card
number; if they start saying one, stop them politely. A lost or stolen card or phone,
or a code someone else may know, is urgent: offer to block the card in your first
answer. No personalized investment advice: explain the options and offer an advisor.

Speak French, unless the customer speaks another language. Your first turn is only
this sentence, nothing more: "Bonjour, je suis votre assistant bancaire. Que puis-je
faire pour vous ?" If they hesitate later, say you can help with a complaint, a lost
code or card, a loan, or savings.
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

# Complaints, kept in sync with bank_docs/reclamation.md: what they are about (motif),
# and the bank's product or service concerned. Nothing outside the bank: the assistant
# says it can't handle it.
COMPLAINT_REASONS = {
    "operation_non_reconnue": "opération non reconnue",
    "prelevement": "prélèvement contesté",
    "frais": "frais bancaires contestés",
    "virement": "problème de virement",
    "qualite_service": "qualité de service",
    "autre": "autre motif",
}
BANK_PRODUCTS = {
    "carte": "carte bancaire",
    "compte": "compte courant",
    "credit": "crédit",
    "epargne": "épargne ou placement",
    "assurance": "assurance",
    "application": "application ou banque en ligne",
    "agence": "agence ou conseiller",
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


def _name(path):
    """The sheet's short name: "Code perdu" for "# Code perdu : code de carte, ..."."""
    return _title(path).split(":")[0].strip()


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
            " and fees, and what you can do for the customer. Call it as soon as you know"
            " the topic, before asking or explaining anything. It starts that procedure"
            " (démarche): call it again only to switch to another one."
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
        "parameters": {
            **LOAN_ANSWERS,
            "properties": {
                **LOAN_ANSWERS["properties"],
                "previous_monthly_payment": {
                    "type": "number",
                    "description": "When simulating again: the monthly payment of the"
                    " previous simulation, in euros, to compare",
                },
            },
        },
    },
    {
        "type": "function",
        "name": "send_loan_to_advisor",
        "description": (
            "Pass the final loan simulation on to a loan advisor, who calls the customer"
            " back, and prepare a PDF recap the customer can download. Returns what to"
            " say, with the reference number. Only call it when the customer asked for it."
        ),
        "parameters": LOAN_ANSWERS,
    },
    {
        "type": "function",
        "name": "send_complaint",
        "description": (
            "Pass the customer's complaint about the bank on to an advisor, and prepare"
            " a PDF recap they can download. Call it as soon as you have the four"
            " answers, without asking for a confirmation. Returns what to say, with the"
            " reference number."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "enum": list(COMPLAINT_REASONS),
                    "description": "What the complaint is about (motif)",
                },
                "facts": {
                    "type": "string",
                    "description": "In French, short and impersonal: what happened"
                    " (faits), with the amount and the merchant or creditor if the"
                    " customer gave them. E.g. « Prélèvement de 49 euros par Free,"
                    " jamais autorisé »",
                },
                "date": {
                    "type": "string",
                    "description": "In French, when the problem happened, as precisely"
                    " as the customer said it: « 3 octobre 2026 », « début septembre »",
                },
                "product": {
                    "type": "string",
                    "enum": list(BANK_PRODUCTS),
                    "description": "The bank's product or service concerned (produit)",
                },
            },
            "required": ["reason", "facts", "date", "product"],
        },
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
                    " pin_reissue: send the card PIN again by mail; password_reset:"
                    " text a password reset link; appointment: book a call with an"
                    " advisor",
                },
                "summary": {
                    "type": "string",
                    "description": "In French, everything the back office needs: the"
                    " facts, dates, amounts, choices and preferences the customer gave",
                },
                "confirmed": {
                    "type": "boolean",
                    "description": "card_block only: true once the customer said yes to"
                    " your question « Je bloque votre carte, c'est définitif :"
                    " d'accord ? ». Asking for the block is not that yes.",
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
            " customer doesn't have to repeat anything. Not for passing on a loan"
            " simulation or a complaint: that is send_loan_to_advisor or send_complaint."
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
            return {"source": f"fiche {_name(path)}", "content": path.read_text()}
    topics = [path.stem for path in _sheets()]
    return {"error": f"No procedure sheet {topic!r}. Topics: {topics}"}


def simulate_loan(
    purpose=None,
    amount=None,
    months=None,
    monthly_income=None,
    age=None,
    previous_monthly_payment=None,
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
    # Built here rather than by the model, so the customer hears every figure right.
    say = (
        f"{label.capitalize()} : {_euros(amount)} sur {months} mois, mensualité de"
        f" {_euros(result['monthly_payment_eur'])}, taux de {_percent(rate)}, coût des"
        f" intérêts de {_euros(result['total_interest_eur'])}."
    )
    if previous_monthly_payment:  # the customer can't see both figures side by side
        change = result["monthly_payment_eur"] - float(previous_monthly_payment)
        if round(change, 2):
            more = "de plus" if change > 0 else "de moins"
            say += f" C'est {_euros(abs(change))} {more} par mois qu'avant."
    if ratio > MAX_DEBT_RATIO:
        say += f" C'est plus de {MAX_DEBT_RATIO} % de vos revenus."
    if purpose != "pret_immobilier":
        say += f" {CONSUMER_CREDIT_NOTICE}"
    result["say_word_for_word"] = say
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


def start_request(kind, summary, confirmed=False):
    # A card block can't be undone: never on a misheard "bloquez-la".
    if kind == "card_block" and not confirmed:
        return {
            "not_done": "Ask first, word for word: « Je bloque votre carte, c'est"
            " définitif : d'accord ? ». After their yes, call again with confirmed true."
        }
    prefix, label, next_steps = REQUESTS[kind]
    reference = _reference(prefix)
    _print_case(f"Demande : {label} · {reference}", [summary])
    return {"reference": reference, "request": label, "next_steps": next_steps}


def _euros(amount):
    """French style, as read out: 1266.0 -> "1 266 euros", 187.77 -> "187,77 euros"."""
    text = f"{amount:,.2f}".replace(",", " ").replace(".", ",").removesuffix(",00")
    return f"{text} euros"


def _percent(value):
    """4.9 -> "4,9 %"."""
    return f"{value:g} %".replace(".", ",")


def _recap_pdf(title, kind, reference, rows, notes):
    """Write a recap the customer downloads. Returns its path, or None: the hand-over
    goes on without it (WeasyPrint needs Pango, see the Dockerfile)."""
    try:
        # Imported here, so a server without Pango only loses the PDF.
        from recap_pdf import write_recap_pdf

        RECAPS_DIR.mkdir(parents=True, exist_ok=True)
        for old in RECAPS_DIR.glob("*.pdf"):
            if time.time() - old.stat().st_mtime > RECAP_LIFETIME:
                old.unlink(missing_ok=True)
        path = RECAPS_DIR / f"{secrets.token_urlsafe(16)}.pdf"  # the name is the key
        write_recap_pdf(path, title, kind, reference, rows, notes)
        return path
    except Exception as e:  # whatever goes wrong, the advisor still gets the case
        print(f"\n  [no PDF] {type(e).__name__}: {e}", flush=True)
        return None


# Said after the recap, when there is a PDF.
PDF_READY = " Je vous ai aussi préparé ce récapitulatif en PDF, à télécharger dans l'application."


def _loan_recap_pdf(loan, consumer, reference, team, when):
    months, years = loan["months"], ""
    if months % 12 == 0:
        years = f" ({months // 12} an{'s' if months > 12 else ''})"
    rows = [
        ("Motif", loan["purpose"].capitalize()),
        ("Montant emprunté", _euros(loan["amount_eur"])),
        ("Durée", f"{months} mois{years}"),
        (
            "TAEG fixe" if consumer else "Taux indicatif hors assurance",
            _percent(loan["annual_rate_percent"]),
        ),
        ("Mensualité", _euros(loan["monthly_payment_eur"])),
        ("Coût des intérêts", _euros(loan["total_interest_eur"])),
        (
            "Montant total remboursé",
            _euros(loan["amount_eur"] + loan["total_interest_eur"]),
        ),
        ("Revenus nets mensuels", _euros(loan["monthly_income_eur"])),
        ("Âge", f"{loan['age']} ans"),
        ("Part des revenus pour ce crédit", _percent(loan["debt_ratio_percent"])),
    ]
    notes = [
        f"Transmis au {team.lower()} : {when}.",
        "Simulation indicative et sans engagement. Taux de démonstration.",
    ]
    if consumer:
        notes.append(CONSUMER_CREDIT_NOTICE)
    title = "Récapitulatif de votre simulation de crédit"
    return _recap_pdf(title, "simulation", reference, rows, notes)


def send_loan_to_advisor(
    purpose=None, amount=None, months=None, monthly_income=None, age=None
):
    loan = simulate_loan(purpose, amount, months, monthly_income, age)
    if "error" in loan:
        return loan
    consumer = purpose != "pret_immobilier"
    team, when = TEAMS["credit" if consumer else "mortgage"]
    reference = _reference("CRE")
    # Built here rather than by the model, so the customer hears every figure.
    recap = (
        f"{loan['purpose'].capitalize()} : {_euros(loan['amount_eur'])} sur"
        f" {loan['months']} mois, pour {_euros(loan['monthly_income_eur'])} de revenus"
        f" nets par mois, à {loan['age']} ans : mensualité de"
        f" {_euros(loan['monthly_payment_eur'])}, taux de"
        f" {_percent(loan['annual_rate_percent'])}, coût des intérêts de"
        f" {_euros(loan['total_interest_eur'])}."
    )
    say = (
        f"{recap} C'est transmis : un {team.lower()} vous rappelle"
        f" {when.removeprefix('rappel ')}."
    )
    pdf = _loan_recap_pdf(loan, consumer, reference, team, when)
    case = [
        recap,
        f"Taux d'endettement (ce crédit seul) : {_percent(loan['debt_ratio_percent'])}",
    ]
    result = {
        "request": f"Simulation transmise au {team.lower()}",
        "advisor": team,
        "when": when,
        "reference": reference,
    }
    if pdf:
        say += PDF_READY
        case.append(f"PDF : {pdf}")
        result["pdf"] = pdf.name  # for the phone page's download link, not to be read
    # The reference last: it is what the customer may want repeated.
    say += f" Votre numéro de référence : {reference}."
    _print_case(f"Simulation de crédit : {team} · {reference}", case)
    return {"say_word_for_word": say, **result}


def send_complaint(reason=None, facts=None, date=None, product=None):
    answers = {"reason": reason, "facts": facts, "date": date, "product": product}
    missing = [name for name, value in answers.items() if not (value or "").strip()]
    if missing:  # nothing is passed on before the four answers are in
        return {
            "error": f"Missing: {', '.join(missing)}. Ask the customer, one question at"
            " a time, then call again."
        }
    if product not in BANK_PRODUCTS:
        return {
            "error": "Only complaints about the bank's products and services. Tell the"
            " customer you can't handle this request: it isn't about the bank."
        }
    reason, product = COMPLAINT_REASONS[reason], BANK_PRODUCTS[product]
    facts, date = facts.strip(), date.strip()
    if facts[-1] not in ".!?":
        facts += "."
    reference = _reference("REC")
    # Built here rather than by the model, so the customer hears all four answers.
    say = (
        "Je transmets votre réclamation à un conseiller : elle sera traitée dans les"
        f" meilleurs délais. En résumé : {reason}, {product}, date du problème :"
        f" {date}. {facts}"
    )
    rows = [
        ("Motif", reason.capitalize()),
        ("Produit concerné", product.capitalize()),
        ("Date du problème", date),
        ("Ce qui s'est passé", facts),
    ]
    notes = [
        "Transmise à un conseiller : elle sera traitée dans les meilleurs délais.",
        (
            "Si la réponse ne vous convient pas, le service relations clientèle, puis"
            " le médiateur bancaire, gratuit, peuvent être saisis."
        ),
        "Document de démonstration.",
    ]
    title = "Récapitulatif de votre réclamation"
    pdf = _recap_pdf(title, "réclamation", reference, rows, notes)
    case = [f"{label} : {value}" for label, value in rows]
    result = {
        "request": "Réclamation transmise à un conseiller",
        "reference": reference,
    }
    if pdf:
        say += PDF_READY
        case.append(f"PDF : {pdf}")
        result["pdf"] = pdf.name  # for the phone page's download link, not to be read
    say += f" Votre numéro de référence : {reference}."
    _print_case(f"Réclamation · {reference}", case)
    return {"say_word_for_word": say, **result}


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
    "send_complaint": send_complaint,
    "start_request": start_request,
    "transfer_to_advisor": transfer_to_advisor,
}

# The tools of one procedure: they only run while it is the one in progress.
PROCEDURE_OF = {
    "simulate_loan": "credit",
    "send_loan_to_advisor": "credit",
    "send_complaint": "reclamation",
}
# The tools that finish the procedure in progress: the next one then starts without
# stopping it. A card block during a complaint doesn't: the complaint goes on.
FINISHING = {
    "send_loan_to_advisor",
    "send_complaint",
    "start_request",
    "transfer_to_advisor",
}


@dataclass
class Conversation:
    """The procedure (démarche) in progress in one conversation. One at a time: to
    start another before it is finished, the assistant says it stops this one."""

    procedure: str | None = None  # its sheet, e.g. "credit"
    finished: bool = False

    def run(self, name, args):
        own = PROCEDURE_OF.get(name)
        if own and own != self.procedure:
            return {"error": f"Call get_procedure for {own} first."}
        if name == "get_procedure":
            return self.start(**args)
        result = FUNCTIONS[name](**args)
        card_block = args.get("kind") == "card_block"
        if (
            name in FINISHING
            and not {"error", "not_done"} & result.keys()
            and not (card_block and self.procedure == "reclamation")
        ):
            self.finished = True
        return result

    def start(self, topic):
        result = get_procedure(topic)
        if "error" in result:
            return result
        topic = topic.strip().lower()
        if self.procedure not in (None, topic) and not self.finished:
            before, after = (
                _name(PROCEDURES_DIR / f"{stem}.md").lower()
                for stem in (self.procedure, topic)
            )
            # Built here, so the customer always hears it.
            stop = f"J'arrête la démarche {before} en cours, pour commencer la démarche"
            result = {"say_word_for_word": f"{stop} {after}.", **result}
        self.procedure, self.finished = topic, False
        return result


def run_tool(name, arguments, conversation):
    """Run a tool call from the model, in this conversation. Returns the result as a
    JSON string."""
    try:
        result = conversation.run(name, json.loads(arguments or "{}"))
    except Exception as e:  # report errors to the model instead of crashing the call
        result = {"error": f"{type(e).__name__}: {e}"}
    return json.dumps(result, ensure_ascii=False)
