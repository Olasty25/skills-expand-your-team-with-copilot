# Cele+ 🎯

Aplikacja do wyznaczania celów na **dzień, tydzień, miesiąc i rok**, z wykresami postępów
i **asystentem AI, któremu cele podajesz głosem przez mikrofon**. Biało-pomarańczowy styl.

## Funkcje

- **Cele dzienne / tygodniowe / miesięczne / roczne** — np. „Zjem 120 g białka”, „Nauczę się do olimpiady AI”,
  „Zbuduję część elektroniczną”.
- **Cele mierzalne** (wartość + jednostka) z paskiem postępu i szybkim dodawaniem wyników.
- **Cele cykliczne** — odnawiają się automatycznie w każdym nowym okresie.
- **Asystent głosowy** — kliknij mikrofon i mów po polsku:
  - „Dzisiaj zjem 120 gram białka, w tym tygodniu nauczę się do olimpiady AI, a w tym miesiącu zbuduję część elektroniczną”
  - „Zjadłem 40 gram białka” → dodaje postęp
  - „Skończyłem naukę do olimpiady” → odhacza cel
  - „Usuń cel białko”
  Asystent odpowiada też głosem (można wyłączyć).
- **Rozwój**: poziomy i XP, seria dni, skuteczność.
- **Wykresy**: krzywa zdobytego XP, skuteczność celów dziennych, postęp bieżących okresów,
  wykonane cele wg kategorii, historia celów mierzalnych (np. gramy białka) i kalendarz aktywności.

Dane zapisywane są lokalnie w przeglądarce (localStorage); można je wyeksportować do JSON.
Przycisk „Wczytaj przykładowe dane” w zakładce *Postępy* pokazuje, jak wyglądają wykresy po kilku tygodniach.

## Uruchomienie

```bash
cd goals-app
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...   # opcjonalnie — włącza asystenta Claude
uvicorn app:app --reload
```

Otwórz <http://localhost:8000> w **Chrome lub Edge** (rozpoznawanie mowy korzysta z Web Speech API).
Przeglądarka poprosi o dostęp do mikrofonu.

### Tryby asystenta

- **Claude AI** (gdy ustawiony jest `ANTHROPIC_API_KEY`) — rozumie swobodną mowę i kilka celów w jednym zdaniu.
  Model można zmienić zmienną `GOALS_MODEL` (domyślnie `claude-opus-5-5`).
- **Tryb lokalny** (bez klucza) — wbudowany parser reguł dla języka polskiego; działa offline
  dla typowych poleceń jak w przykładach powyżej.

## Testy

```bash
cd goals-app
pip install pytest httpx
python -m pytest tests
```
