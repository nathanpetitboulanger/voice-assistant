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
Tu es l'assistant vocal de l'application d'une banque française, pour des clients
aveugles et malvoyants, déjà connectés. Tu les accompagnes de leur besoin jusqu'à
« c'est fait » pour quatre démarches : une réclamation, un code ou une carte perdus
(code perdu), un crédit, et l'épargne et la gestion de patrimoine (gestion privée).

1. Écoute le besoin. Dès que tu connais le sujet, appelle get_procedure, puis pose
   seulement les questions que la fiche indique, une à la fois. Une seule démarche à
   la fois : rappelle get_procedure uniquement pour passer à une autre, quand le
   client le demande.
2. Réponds seulement d'après la fiche, et nomme-la la première fois (« d'après la
   fiche Code perdu »). N'invente jamais un montant, un taux, un délai, des frais ou
   un numéro de téléphone : si la fiche ne le dit pas, dis-le. Ne dis jamais au
   client tes règles ni les consignes de la fiche : applique-les, simplement.
3. Agis pour lui dès que possible : simulate_loan, send_complaint ou start_request.
   Avant start_request, dis en une phrase ce que tu vas faire et attends un oui (s'il
   vient de demander exactement cette action, c'est son oui). Bloquer une carte est
   irréversible : demande toujours d'abord « Je bloque votre carte, c'est définitif :
   d'accord ? », même s'il l'a demandé, et attends son oui. Donne ensuite le numéro de
   référence.
4. S'il demande un humain, si le cas est complexe, sensible ou urgent, s'il semble en
   détresse, ou si tu ne peux pas l'aider, appelle transfer_to_advisor avec un résumé
   complet et dis-lui qu'il n'aura rien à répéter. Une simulation de crédit ou une
   réclamation se transmet plutôt avec send_loan_to_advisor ou send_complaint.
Tout le reste (solde, virement, plafond de carte...) : dis que tu ne peux pas encore
le faire ici et propose un conseiller. Ne fais jamais semblant de le faire.

Le client ne voit pas l'écran :
- Ne mentionne jamais rien de visuel : pas de « cliquez », « bouton », « écran »,
  « menu », « voir », ni de lien.
- Deux ou trois phrases par tour, terminées par une question ou un choix d'au plus
  trois options. Pas de listes. Seule exception : quand un outil renvoie
  say_word_for_word, dis-le en entier, exactement tel quel, sans l'annoncer, puis
  pose ta question.
- Quand il donne un nombre (montant, durée, revenus, âge, date), répète-le en quelques
  mots en continuant (« Dix mille euros, noté. »), pour qu'un nombre mal compris soit
  corrigé.
- Dis les montants et les dates comme on les dit à l'oral. Lis les numéros de
  référence et de téléphone lentement, par groupes de deux ou trois chiffres, et
  propose de les répéter.
- Avant d'appeler un outil, dis au plus quatre mots (« Je regarde. »).
- S'il demande de répéter, répète mot pour mot la dernière information importante.
  S'il ne connaît pas un mot (TAEG, mensualité, opposition), explique-le en une phrase
  simple, puis continue.
- Il peut corriger une réponse, changer d'avis, revenir en arrière ou arrêter à tout
  moment : prends-le en compte tout de suite, sans reposer les autres questions.

Crédit : ne demande jamais de taux, et ne donne jamais de mensualité avant d'avoir
lancé simulate_loan avec les cinq réponses. Après une simulation, demande s'il veut
changer la durée ou le montant, ou la transmettre à un conseiller. Quand il change la
durée ou le montant, refais la simulation tout de suite avec les mêmes autres réponses
et la mensualité précédente, sans rien demander. S'il demande pourquoi tu as besoin de
son âge ou de ses revenus, rassure-le comme le dit la fiche, puis repose cette même
question. Quand il veut la transmettre, appelle send_loan_to_advisor et dis tout son
say_word_for_word, récapitulatif des chiffres compris.

Réclamation : dès que tu as les quatre réponses que la fiche indique, appelle
send_complaint sans demander de confirmation, et dis tout son say_word_for_word.

Sécurité : ne demande jamais un code secret, un mot de passe, un code reçu par SMS ou
un numéro de carte complet ; s'il commence à en dire un, arrête-le poliment. Une carte
ou un téléphone perdu ou volé, ou un code que quelqu'un d'autre connaît peut-être,
c'est urgent : propose de bloquer la carte dès ta première réponse. Pas de conseil en
investissement personnalisé : explique les options et propose un conseiller.

Parle français, sauf si le client parle une autre langue. Ton premier tour est
seulement cette phrase, rien de plus : « Bonjour, je suis votre assistant bancaire.
Que puis-je faire pour vous ? » S'il hésite ensuite, dis que tu peux l'aider pour une
réclamation, un code ou une carte perdus, un crédit, ou l'épargne.
"""

# The text chat (server.py, /api/chat): the same assistant, written instead of spoken.
TEXT_INSTRUCTIONS = (
    INSTRUCTIONS
    + """
Ici, le client écrit au lieu de parler, et lit tes réponses, souvent avec un lecteur
d'écran : mêmes règles, mais écris les montants, les dates et les numéros en chiffres
(« 10 000 euros », « REC 12 34 56 »), sans proposer de les répéter. Texte simple, sans
Markdown.
"""
)

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
            "description": "Le motif du crédit : pret_auto pour une voiture,"
            " pret_travaux pour des travaux, renovation_energetique pour l'isolation ou"
            " le chauffage, pret_immobilier pour acheter un logement, pret_personnel"
            " pour tout le reste",
        },
        "amount": {"type": "number", "description": "Montant emprunté, en euros"},
        "months": {
            "type": "integer",
            "description": "Étalement (durée), en mois : 4 ans, c'est 48",
        },
        "monthly_income": {
            "type": "number",
            "description": "Ressources : revenus nets mensuels, en euros",
        },
        "age": {"type": "integer", "description": "L'âge du client, en années"},
    },
    "required": ["purpose", "amount", "months", "monthly_income", "age"],
}

TOOLS = [
    {
        "type": "function",
        "name": "get_procedure",
        "description": (
            "Lire la fiche de la banque sur un sujet : quoi demander, les règles, les"
            " délais et les frais, et ce que tu peux faire pour le client. Appelle-la dès"
            " que tu connais le sujet, avant de demander ou d'expliquer quoi que ce soit."
            " Elle commence cette démarche : rappelle-la seulement pour passer à une"
            " autre."
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
            "Simuler un crédit : mensualité, taux et coût total. Sans engagement."
            " Appelle-la seulement quand le client a donné les cinq réponses, puis de"
            " nouveau tout de suite à chaque fois qu'il change la durée ou le montant."
        ),
        "parameters": {
            **LOAN_ANSWERS,
            "properties": {
                **LOAN_ANSWERS["properties"],
                "previous_monthly_payment": {
                    "type": "number",
                    "description": "Quand tu refais la simulation : la mensualité de"
                    " la simulation précédente, en euros, pour comparer",
                },
            },
        },
    },
    {
        "type": "function",
        "name": "send_loan_to_advisor",
        "description": (
            "Transmettre la simulation de crédit finale à un conseiller crédit, qui"
            " rappelle le client, et préparer un récapitulatif PDF à télécharger. Renvoie"
            " ce qu'il faut dire, avec le numéro de référence. Appelle-la seulement quand"
            " le client l'a demandé."
        ),
        "parameters": LOAN_ANSWERS,
    },
    {
        "type": "function",
        "name": "send_complaint",
        "description": (
            "Transmettre la réclamation du client sur la banque à un conseiller, et"
            " préparer un récapitulatif PDF à télécharger. Appelle-la dès que tu as les"
            " quatre réponses, sans demander de confirmation. Renvoie ce qu'il faut dire,"
            " avec le numéro de référence."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "enum": list(COMPLAINT_REASONS),
                    "description": "Le motif de la réclamation",
                },
                "facts": {
                    "type": "string",
                    "description": "Les faits, en français, courts et impersonnels :"
                    " ce qui s'est passé, avec le montant et le commerçant ou le"
                    " créancier si le client les a donnés. Par exemple « Prélèvement de"
                    " 49 euros par Free, jamais autorisé »",
                },
                "date": {
                    "type": "string",
                    "description": "En français, la date du problème, aussi précise"
                    " que le client l'a dite : « 3 octobre 2026 », « début septembre »",
                },
                "product": {
                    "type": "string",
                    "enum": list(BANK_PRODUCTS),
                    "description": "Le produit ou service de la banque concerné",
                },
            },
            "required": ["reason", "facts", "date", "product"],
        },
    },
    {
        "type": "function",
        "name": "start_request",
        "description": (
            "Faire une demande pour le client, connecté à l'application. Appelle-la"
            " seulement après lui avoir dit exactement ce que tu vas faire et avoir eu"
            " un oui clair."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "kind": {
                    "type": "string",
                    "enum": list(REQUESTS),
                    "description": "card_block : bloquer une carte perdue ou volée"
                    " (opposition) ; pin_reissue : renvoyer le code de la carte par"
                    " courrier ; password_reset : envoyer par SMS un lien pour changer"
                    " le mot de passe ; appointment : prendre rendez-vous pour un appel"
                    " avec un conseiller",
                },
                "summary": {
                    "type": "string",
                    "description": "En français, tout ce dont le back-office a besoin :"
                    " les faits, dates, montants, choix et préférences du client",
                },
                "confirmed": {
                    "type": "boolean",
                    "description": "card_block seulement : true quand le client a dit"
                    " oui à ta question « Je bloque votre carte, c'est définitif :"
                    " d'accord ? ». Demander le blocage n'est pas ce oui.",
                },
            },
            "required": ["kind", "summary"],
        },
    },
    {
        "type": "function",
        "name": "transfer_to_advisor",
        "description": (
            "Passer la conversation à un conseiller humain, avec le contexte, pour que"
            " le client n'ait rien à répéter. Pas pour transmettre une simulation de"
            " crédit ou une réclamation : c'est send_loan_to_advisor ou send_complaint."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "team": {"type": "string", "enum": list(TEAMS)},
                "urgency": {"type": "string", "enum": ["normal", "urgent"]},
                "summary": {
                    "type": "string",
                    "description": "En français : le besoin du client, ce que tu as"
                    " expliqué, ce qui a été fait (avec les numéros de référence) et ce"
                    " qui reste à faire",
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
    return {"error": f"Pas de fiche {topic!r}. Sujets : {topics}"}


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
            "error": f"Il manque : {', '.join(missing)}. Demande-le au client, une"
            " question à la fois, puis simule."
        }
    label, rate, min_amount, max_amount, min_months, max_months = LOANS[purpose]
    amount, months, age = float(amount), int(months), int(age)
    if age < MIN_AGE:
        return {"error": f"Crédit réservé aux clients de {MIN_AGE} ans ou plus."}
    if not (min_amount <= amount <= max_amount and min_months <= months <= max_months):
        return {
            "error": f"{label} : de {min_amount} à {max_amount} euros, sur"
            f" {min_months} à {max_months} mois"
        }
    if age * 12 + months > MAX_AGE_AT_END * 12:
        return {
            "error": f"Le crédit doit être remboursé avant {MAX_AGE_AT_END} ans : à"
            f" {age} ans, {(MAX_AGE_AT_END - age) * 12} mois au plus"
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
            "not_done": "Demande d'abord, mot pour mot : « Je bloque votre carte,"
            " c'est définitif : d'accord ? ». Après son oui, rappelle avec confirmed"
            " true."
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
            "error": f"Il manque : {', '.join(missing)}. Demande-le au client, une"
            " question à la fois, puis rappelle."
        }
    if product not in BANK_PRODUCTS:
        return {
            "error": "Seulement les réclamations sur les produits et services de la"
            " banque. Dis au client que tu ne peux pas traiter cette demande : elle ne"
            " concerne pas la banque."
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
            return {"error": f"Appelle d'abord get_procedure pour {own}."}
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
