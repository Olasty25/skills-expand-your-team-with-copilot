"""
Cele+ — aplikacja do wyznaczania celów (dzień / tydzień / miesiąc / rok)
z wykresami postępów i asystentem głosowym.

Uruchomienie:  uvicorn app:app --reload   (z katalogu goals-app)
"""

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from assistant import AssistantRequest, AssistantResult, handle

app = FastAPI(title="Cele+", description="Wyznaczaj cele i śledź swój rozwój")

static_dir = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/")
def root():
    return RedirectResponse(url="/static/index.html")


@app.get("/api/status")
def status():
    has_key = bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))
    return {"ai": "claude" if has_key else "local"}


@app.post("/api/assistant", response_model=AssistantResult)
def assistant(req: AssistantRequest) -> AssistantResult:
    return handle(req)
