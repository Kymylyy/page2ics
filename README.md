# page2ics

**One click turns the booking on your screen into a calendar event.**

You book a haircut, a tennis court or a gym class. The confirmation page shows the date, the time and the address – and no "Add to calendar" button. So you type it into your calendar by hand, and sooner or later you get the hour wrong.

page2ics is a small Chrome extension that fixes this. Click its icon on the booking page (or on an open confirmation email) and you get an `.ics` file with the title, time, place and map pin already filled in. Open it and your calendar asks you to confirm the event.

It reads the page text, not the HTML, so it needs no per-site integration. It was built and tested on Polish booking sites, which shows it is not tied to English pages.

## How it works

```
page text ──▶ 1. precheck (jev) ──▶ 2. extraction (LLM) ──▶ 3. verification (jev) ──▶ .ics
                "is there a date        title, start, end,       "is it cancelled? is it
                 or a booking here?"    venue, address, quote     really yours? does the
                                                                  date match the page?"
```

1. **Precheck** – [`typesafe/jev-1.13`](https://openrouter.ai/typesafe/jev-1.13), a fast structured-decision model, answers two yes/no questions in ~0.3 s. If the page has neither a date nor anything booking-related, the extension stops here.
2. **Extraction** – an LLM (`openai/gpt-5.6-luna` by default) returns one event as strict JSON. The central question in the prompt is *"is this slot already the user's, or still up for grabs?"* – a class schedule full of free slots must produce nothing, a customer panel with "your upcoming lessons" must produce the nearest one.
3. **Verification** – jev checks the extracted event against the page. A cancelled booking blocks the download. Doubt about whether the slot is really yours, or whether the date matches the page, adds a "⚠" note to the event description – the calendar asks you to confirm the event anyway, so a warning beats a refusal.
4. **Geocoding** – the address goes to Nominatim (OpenStreetMap). Coordinates are used only if the postcode or city from the map matches the address; then Apple Calendar shows a pin and directions.
5. **`.ics`** – built by hand (RFC 5545), times converted from local wall-clock time to UTC by the JS engine, so daylight saving time is handled.

Both models are called through [OpenRouter](https://openrouter.ai) with a single API key. jev runs on OpenRouter's Decisions API, which is in alpha; if it fails, steps 1 and 3 are skipped and the extension works without them.

## Install

1. `chrome://extensions` → enable "Developer mode" → "Load unpacked" → select this folder.
2. Click the extension icon – on first run the settings page opens. Paste your OpenRouter API key.

## Use

Go to the page with your booking and click the icon. An `.ics` file appears in the downloads bar – click it and your calendar opens the event for confirmation.

If the page is cluttered (e.g. Gmail with its sidebar), select just the fragment with the booking – the model then gets only the selection.

If the page has no slot that **you are booked for** (a bare schedule or an offer is not enough), you get a notification instead of a file.

## Tests and measurements

```
npm test                                                     # .ics logic, including DST switches
OPENROUTER_API_KEY=... npm run eval                          # real models on all fixtures (costs a fraction of a cent)
OPENROUTER_API_KEY=... MODELS=a/b,c/d RUNS=3 npm run eval    # model comparison: hits, time, cost
```

Fixtures in `test/fixtures/` are text dumps of real booking pages with all personal and business details replaced by fictional ones: a tennis club customer panel, a confirmed and a cancelled barber appointment, a gym schedule with and without a booking, and an article with no date at all.

Extraction models compared on 2026-09-16 (3 runs per fixture, `test/compare-2026-09-16.txt`):

| model | hits | avg ms | $/call |
|---|---|---|---|
| anthropic/claude-opus-5 | 9/9 | 4194 | 0.0247 |
| anthropic/claude-haiku-4.5 | 9/9 | 2476 | 0.0037 |
| **openai/gpt-5.6-luna** | 9/9 | **1671** | **0.0004** |
| deepseek/deepseek-v4.1-flash | 9/9 | 6928 | 0.0010 |
| qwen/qwen3.8-flash | 9/9 | 22084 | 0.0010 |
| z-ai/glm-5.3-flash | 9/9 | 4995 | 0.0007 |

All models got everything right, so the fastest and cheapest one won.

jev answers measured on 2026-09-21 (probability of "yes", one run, ~0.3 s and ~$0.00003 per call):

| question | when the answer should be yes | when it should be no |
|---|---|---|
| page has a date and time | 0.97–0.99 | 0.01 (article) |
| page is about a booking | 0.93–0.98 | 0.01 (article) |
| booking is cancelled | 0.98 | 0.03–0.08 |
| slot is the user's | 0.79–0.98 | 0.14–0.16 (open slot in a schedule) |
| extracted date matches the page | 0.80–0.97 | 0.07–0.19 (event shifted by a day) |

The thresholds in `background.js` come from these numbers. The sample is small – treat them as a starting point.

## Assumptions and limits

- Times are interpreted in the browser's time zone. A booking made from the city you are in is fine; a booking for a place in another time zone will be shifted.
- The output is tuned for Apple Calendar (structured location); other calendars read the standard fields.
- The API key lives in this browser's `chrome.storage.local`. This is a personal tool, not a hardened product.

## Privacy

When you click the icon, the text of the current page (or your selection, up to 20,000 characters) is sent to OpenRouter and on to the model providers (OpenAI and TypeSafe by default). The extracted address is sent to Nominatim, run by the OpenStreetMap Foundation. Nothing is sent until you click, and there is no backend of this project's own.

## License

MIT
