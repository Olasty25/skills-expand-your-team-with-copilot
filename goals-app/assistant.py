"""
Asystent celów — zamienia wypowiedź użytkownika (np. z mikrofonu) na listę akcji
(dodaj cel, zaktualizuj postęp, oznacz jako zrobiony, usuń).

Jeśli ustawiony jest ANTHROPIC_API_KEY, używany jest Claude. W przeciwnym razie
działa prosty parser regułowy dla języka polskiego, więc aplikacja działa też offline.
"""

from __future__ import annotations

import json
import os
import re
import unicodedata
from datetime import date
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

Period = Literal["day", "week", "month", "year"]
ActionType = Literal["add_goal", "update_progress", "complete_goal", "delete_goal"]

MODEL = os.environ.get("GOALS_MODEL", "claude-opus-5-5")


class GoalSummary(BaseModel):
    id: str
    title: str
    period: Period
    target: Optional[float] = None
    unit: Optional[str] = None
    current: float = 0
    done: bool = False


class AssistantRequest(BaseModel):
    text: str
    today: Optional[str] = None
    goals: List[GoalSummary] = Field(default_factory=list)


class Action(BaseModel):
    type: ActionType
    title: Optional[str] = None
    period: Optional[Period] = None
    target: Optional[float] = None
    unit: Optional[str] = None
    category: Optional[str] = None
    goal_id: Optional[str] = None
    amount: Optional[float] = None


class AssistantResponse(BaseModel):
    reply: str
    actions: List[Action]


class AssistantResult(AssistantResponse):
    source: Literal["claude", "local"]


CATEGORIES = ["Zdrowie", "Nauka", "Projekty", "Sport", "Praca", "Rozwój", "Inne"]

SYSTEM_PROMPT = f"""Jesteś asystentem w aplikacji do wyznaczania celów. Użytkownik mówi po polsku \
(często przez mikrofon, więc tekst może mieć błędy rozpoznawania mowy). Zamień jego wypowiedź na akcje.

Typy akcji:
- add_goal: nowy cel. Ustaw title (krótko, w 1. osobie, np. "Zjem 120 g białka"), period \
("day" = dziś, "week" = ten tydzień, "month" = ten miesiąc, "year" = ten rok; domyślnie "day"), \
category (jedna z: {", ".join(CATEGORIES)}). Jeśli cel jest mierzalny, ustaw target i unit (np. 120 i "g").
- update_progress: użytkownik raportuje postęp w istniejącym celu (np. "zjadłem 40 gram białka"). \
Ustaw goal_id oraz amount (ile DODAĆ do obecnego postępu).
- complete_goal: użytkownik mówi, że cel jest zrobiony. Ustaw goal_id.
- delete_goal: użytkownik chce usunąć cel. Ustaw goal_id.

Jedna wypowiedź może zawierać kilka akcji. goal_id bierz wyłącznie z listy obecnych celów. \
Pole reply to krótka, ciepła, motywująca odpowiedź po polsku (1–2 zdania), która zostanie przeczytana na głos. \
Jeśli wypowiedź nie dotyczy celów, zwróć pustą listę actions i odpowiedz krótko."""


def handle(req: AssistantRequest) -> AssistantResult:
    if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        try:
            return _ask_claude(req)
        except Exception as exc:  # brak sieci, limit, odmowa itp. — spadamy na parser lokalny
            print(f"[assistant] Claude niedostępny, używam parsera lokalnego: {exc}")
    return local_parse(req)


def _ask_claude(req: AssistantRequest) -> AssistantResult:
    import anthropic

    client = anthropic.Anthropic()
    goals_json = json.dumps([g.model_dump() for g in req.goals], ensure_ascii=False)
    user_content = (
        f"Dzisiejsza data: {req.today or date.today().isoformat()}\n"
        f"Obecne cele (JSON): {goals_json}\n\n"
        f"Wypowiedź użytkownika: {req.text}"
    )
    response = client.beta.messages.parse(
        model=MODEL,
        max_tokens=4000,
        system=SYSTEM_PROMPT,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": "low"},
        messages=[{"role": "user", "content": user_content}],
        output_format=AssistantResponse,
    )
    if response.stop_reason == "refusal" or response.parsed_output is None:
        raise RuntimeError(f"brak odpowiedzi strukturalnej (stop_reason={response.stop_reason})")

    parsed: AssistantResponse = response.parsed_output
    known_ids = {g.id for g in req.goals}
    actions = [
        a for a in parsed.actions
        if a.type == "add_goal" and a.title or a.type != "add_goal" and a.goal_id in known_ids
    ]
    return AssistantResult(reply=parsed.reply, actions=actions, source="claude")


# ---------------------------------------------------------------------------
# Lokalny parser regułowy (fallback bez klucza API)
# ---------------------------------------------------------------------------

def _norm(text: str) -> str:
    text = text.lower().replace("ł", "l")
    return "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")


PERIOD_PATTERNS = [
    ("year", r"\b(w tym roku|na rok|w roku|do konca roku|rocznie|roczny)\b"),
    ("month", r"\b(w tym miesiacu|na miesiac|w miesiacu|do konca miesiaca|miesiecznie|miesieczny)\b"),
    ("week", r"\b(w tym tygodniu|na tydzien|w tygodniu|do konca tygodnia|tygodniowo|tygodniowy)\b"),
    ("day", r"\b(dzis|dzisiaj|na dzien|dziennie|codziennie|jutro)\b"),
]

CATEGORY_KEYWORDS = {
    "Zdrowie": ["bial", "zjem", "jesc", "kalori", "wod", "pic", "sen", "spac", "warzyw", "owoc", "diet", "witamin"],
    "Nauka": ["naucz", "uczyc", "olimpiad", "egzamin", "matur", "kurs", "przeczyt", "ksiazk", "stron", "lekcj", "zadan"],
    "Projekty": ["zbuduj", "elektroni", "projekt", "lutow", "zaprogramuj", "aplikacj", "kod", "arduino", "robot", "napisz"],
    "Sport": ["trening", "biegac", "bieg", "pomp", "silowni", "rower", "km", "przysiad", "plywa", "cwicz"],
    "Praca": ["prac", "raport", "spotkan", "klient", "zarob"],
}

UNIT_ALIASES = {
    "g": "g", "gram": "g", "gramow": "g", "gramy": "g", "grama": "g",
    "kg": "kg", "kilo": "kg", "kilogramow": "kg",
    "km": "km", "kilometrow": "km", "kilometry": "km", "kilometr": "km",
    "min": "min", "minut": "min", "minuty": "min", "minute": "min",
    "h": "h", "godzin": "h", "godziny": "h", "godzine": "h", "godz": "h",
    "stron": "stron", "strony": "stron", "strone": "stron",
    "razy": "razy", "raz": "razy", "pompek": "pompek", "pompki": "pompek",
    "zadan": "zadań", "zadania": "zadań", "zadanie": "zadań",
    "l": "l", "litr": "l", "litry": "l", "litrow": "l",
    "kroków": "kroków", "krokow": "kroków", "kroki": "kroków",
    "kcal": "kcal", "kalorii": "kcal",
    "zl": "zł", "zlotych": "zł",
}

NUMBER_WORDS = {
    "jeden": 1, "jedna": 1, "jedno": 1, "dwa": 2, "dwie": 2, "trzy": 3, "cztery": 4, "piec": 5,
    "szesc": 6, "siedem": 7, "osiem": 8, "dziewiec": 9, "dziesiec": 10, "pietnascie": 15,
    "dwadziescia": 20, "trzydziesci": 30, "piecdziesiat": 50, "sto": 100,
}

QUANTITY_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*([a-zA-Ząćęłńóśźż]+)?")

PROGRESS_VERBS = r"\b(zjadlem|zjadlam|wypilem|wypilam|przebieglem|przebieglam|przeczytalem|przeczytalam|" \
                 r"zrobilem|zrobilam|dodaj|dorzuc|przejechalem|przejechalam|cwiczylem|cwiczylam|uczylem|uczylam)\b"
DONE_RE = re.compile(r"\b(skonczylem|skonczylam|ukonczylem|ukonczylam|zrobione|gotowe|wykonalem|wykonalam|"
                     r"zaliczylem|zaliczylam|odhacz|oznacz)\b")
DELETE_RE = re.compile(r"\b(usun|skasuj|wykresl)\b")
STOPWORDS = {"cel", "dzis", "dzisiaj", "na", "w", "i", "do", "sie", "z", "ze", "tym", "ten", "mam", "moj", "jest",
             "juz", "oraz", "a", "o", "ze", "jako", "zrobiony", "zrobione", "gotowy"}


def _split_clauses(text: str) -> List[str]:
    parts = re.split(r"[.;\n]|,\s*(?:a\s+)?(?=\w)|\s+oraz\s+|\s+a\s+potem\s+|\s+i\s+(?=(?:dzis|dzisiaj|w tym|na |jutro|zbuduj|naucz|zjem|przeczytam|zrobie|pobiegne|napisze|wypije)\b)", text)
    return [p.strip() for p in parts if p and p.strip()]


def _detect_period(norm: str) -> Optional[str]:
    for period, pattern in PERIOD_PATTERNS:
        if re.search(pattern, norm):
            return period
    return None


def _detect_category(norm: str) -> str:
    for category, words in CATEGORY_KEYWORDS.items():
        if any(w in norm for w in words):
            return category
    return "Rozwój"


def _detect_quantity(clause: str) -> tuple[Optional[float], Optional[str]]:
    norm = _norm(clause)
    for match in QUANTITY_RE.finditer(clause.lower()):
        value = float(match.group(1).replace(",", "."))
        unit_word = (match.group(2) or "").strip()
        unit = UNIT_ALIASES.get(_norm(unit_word))
        if unit is None and len(unit_word) > 2 and _norm(unit_word) not in STOPWORDS:
            unit = unit_word  # np. "20 książek" -> jednostka "książek"
        return value, unit
    words = norm.split()
    for i, word in enumerate(words):
        if word in NUMBER_WORDS and i + 1 < len(words) and words[i + 1] in UNIT_ALIASES:
            return float(NUMBER_WORDS[word]), UNIT_ALIASES[words[i + 1]]
    return None, None


def _clean_title(clause: str) -> str:
    title = re.sub(r"^(chce|chcialbym|chcialabym|moim celem jest|cel:?|ustaw cel|dodaj cel|postaram sie)\s+",
                   "", clause.strip(), flags=re.IGNORECASE)
    title = re.sub(r"\b(dzisiaj|dziś|dzis|w tym tygodniu|w tym miesiącu|w tym roku|na dzień|na tydzień|"
                   r"na miesiąc|na rok|do końca (?:dnia|tygodnia|miesiąca|roku))\b", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s{2,}", " ", title).strip(" ,.-")
    return title[:1].upper() + title[1:] if title else title


def _match_goal(clause_norm: str, goals: List[GoalSummary], unit: Optional[str]) -> Optional[GoalSummary]:
    words = {w for w in re.findall(r"[a-z]+", clause_norm) if len(w) > 2 and w not in STOPWORDS}
    best, best_score = None, 0.0
    for goal in goals:
        title_words = {w for w in re.findall(r"[a-z]+", _norm(goal.title)) if len(w) > 2 and w not in STOPWORDS}
        score = 0.0
        for w in words:
            for t in title_words:
                if w[:4] == t[:4]:
                    score += 1
                    break
        if unit and goal.unit and _norm(unit) == _norm(goal.unit):
            score += 1.5
        if not goal.done:
            score += 0.1
        if score > best_score:
            best, best_score = goal, score
    return best if best_score >= 1 else None


def local_parse(req: AssistantRequest) -> AssistantResult:
    actions: List[Action] = []
    replies: List[str] = []

    for clause in _split_clauses(req.text):
        norm = _norm(clause)
        amount, unit = _detect_quantity(clause)

        if DELETE_RE.search(norm):
            goal = _match_goal(norm, req.goals, unit)
            if goal:
                actions.append(Action(type="delete_goal", goal_id=goal.id))
                replies.append(f"Usunąłem cel „{goal.title}”.")
            continue

        if re.search(PROGRESS_VERBS, norm) and amount is not None:
            goal = _match_goal(norm, [g for g in req.goals if g.target], unit)
            if goal:
                actions.append(Action(type="update_progress", goal_id=goal.id, amount=amount))
                replies.append(f"Dodałem {amount:g} {goal.unit or ''} do celu „{goal.title}”.".replace("  ", " "))
                continue

        if DONE_RE.search(norm) or re.search(PROGRESS_VERBS, norm):
            goal = _match_goal(norm, req.goals, unit)
            if goal:
                actions.append(Action(type="complete_goal", goal_id=goal.id))
                replies.append(f"Brawo! Cel „{goal.title}” odhaczony.")
                continue

        title = _clean_title(clause)
        if len(title) < 3:
            continue
        period = _detect_period(norm) or "day"
        actions.append(Action(
            type="add_goal", title=title, period=period, category=_detect_category(norm),
            target=amount if unit else None, unit=unit,
        ))
        replies.append(f"Dodałem cel „{title}”.")

    if not actions:
        reply = "Nie do końca zrozumiałem. Powiedz np. „dzisiaj zjem 120 gram białka” albo „zjadłem 40 gram białka”."
    else:
        reply = " ".join(replies) + " Trzymam kciuki!"
    return AssistantResult(reply=reply, actions=actions, source="local")
