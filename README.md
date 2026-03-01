# LockedInAI (Work Roast Monitor)

A small Electron desktop app that periodically screenshots your primary display, asks an AI whether the screen is work-related, and if not, shows a full-screen GIF + a short “roast” (optionally spoken).

This is intended for personal use on your own machine.

## Features

- Start a timed focus session (minutes)
- Pause / Resume / Stop
- Off-task overlay (GIF + roast)
- Text-to-speech roasts with mute toggle
- “Accountability Voice” modes (Savage, Deadpan corporate, Calm disappointment, Drill sergeant, Passive-aggressive coach)
- Stats tab (streaks, averages, session history) stored locally

## Setup

1. Install dependencies:

```powershell
cd "D:\Dropbox\lockedinai"
npm install
```

2. Set your OpenAI API key (recommended: permanent for your Windows user):

```powershell
setx OPENAI_API_KEY "sk-proj-...your_key..."
```

Close and reopen your terminal after running `setx`.

Optional model override:

```powershell
setx OPENAI_MODEL "gpt-4.1-mini"
```

## Run

```powershell
cd "D:\Dropbox\lockedinai"
npm run desktop
```

## Usage Notes

- The app only checks while a session is running.
- The overlay should disappear automatically once your screen looks work-related again.
- The selected “Accountability Voice” and mute setting apply to new roasts (and are sent with the session start payload).

## Local Data

- Stats are stored locally in Electron user data as `stats.json`.
- Your API key is read from the environment variable `OPENAI_API_KEY` (it is not stored in the repo).

## Privacy / Safety

- Screenshots are sensitive. This app captures your screen and sends the image to the AI provider for analysis while a session is running.
- Do not use this on devices or accounts you do not own/control, and do not use it where screenshots would violate policy/law.

## Repo Hygiene

- `.gitignore` is included to avoid committing `node_modules/` and secret files like `.env*`.

