import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ.pop("ANTHROPIC_AUTH_TOKEN", None)

from fastapi.testclient import TestClient  # noqa: E402

from app import app  # noqa: E402
from assistant import AssistantRequest, GoalSummary, local_parse  # noqa: E402

GOALS = [
    GoalSummary(id="a", title="Zjem 120 g białka", period="day", target=120, unit="g"),
    GoalSummary(id="b", title="Nauczę się do olimpiady AI", period="week"),
]


def parse(text, goals=GOALS):
    return local_parse(AssistantRequest(text=text, goals=goals)).actions


def test_adds_multiple_goals_with_periods():
    actions = parse("Dzisiaj zjem 120g białka, w tym tygodniu nauczę się do olimpiady AI "
                    "oraz w tym miesiącu zbuduję część elektroniczną", goals=[])
    assert [a.type for a in actions] == ["add_goal"] * 3
    assert [a.period for a in actions] == ["day", "week", "month"]
    assert actions[0].target == 120 and actions[0].unit == "g"
    assert actions[0].category == "Zdrowie"
    assert actions[1].category == "Nauka"
    assert actions[2].category == "Projekty"


def test_year_goal_with_custom_unit():
    (a,) = parse("w tym roku przeczytam 20 książek", goals=[])
    assert a.period == "year" and a.target == 20 and a.unit == "książek"


def test_progress_update_matches_goal():
    (a,) = parse("zjadłem 40 gram białka")
    assert a.type == "update_progress" and a.goal_id == "a" and a.amount == 40


def test_complete_and_delete():
    assert parse("skończyłem naukę do olimpiady")[0].model_dump(exclude_none=True) == {"type": "complete_goal", "goal_id": "b"}
    assert parse("usuń cel białko")[0].goal_id == "a"


def test_api_endpoint_uses_local_parser():
    client = TestClient(app)
    assert client.get("/api/status").json() == {"ai": "local"}
    res = client.post("/api/assistant", json={"text": "dzisiaj zrobię 50 pompek", "goals": []})
    body = res.json()
    assert res.status_code == 200 and body["source"] == "local"
    assert body["actions"][0]["unit"] == "pompek"
