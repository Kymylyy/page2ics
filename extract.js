// Extracts the booking from page text via OpenRouter. No chrome.*, so test/eval.js can use it.

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
export const DEFAULT_MODEL = '~openai/gpt-luna-latest';

const EVENT = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Pattern "Activity – Place", 2–5 words' },
    start: { type: 'string', description: 'Local time without a zone, format YYYY-MM-DDTHH:MM' },
    end: { type: 'string', description: 'Local time without a zone, format YYYY-MM-DDTHH:MM' },
    venue: { type: 'string', description: 'Name of the place, as on its signboard' },
    address: { type: 'string', description: 'Bare postal address: street number, postcode city' },
    source_quote: { type: 'string', description: 'Verbatim fragment of the page the date and time were taken from' },
  },
  required: ['title', 'start', 'end', 'venue', 'address', 'source_quote'],
  additionalProperties: false,
};

const SCHEMA = {
  type: 'object',
  properties: {
    events: { type: 'array', items: EVENT, description: 'Only slots the user IS booked for; empty if there are none' },
  },
  required: ['events'],
  additionalProperties: false,
};

// The quoted cue phrases are Polish because the pages this was tuned on are Polish; the model generalises to other languages.
function systemPrompt(now) {
  const today = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `From the text of a web page or an email you extract calendar events: the slots the user is signed up for, has booked, or has had confirmed. The page may be in any language (often Polish).

Today is ${today}, time zone ${tz}.

The key question: is this slot ALREADY the user's, or is it still up for grabs?
- ALREADY THEIRS (what you are looking for): a booking confirmation, "Jesteś zapisany na" (you are signed up for), "Twoja rezerwacja" (your booking), "Odwołaj rezerwację" (cancel booking), a booking number – but also a customer panel listing their upcoming classes ("Najbliższe lekcje", "Moje rezerwacje", "Twoje wizyty", a logged-in page showing the user's name). Such a list is a list of THEIR slots, even if the word "booked" never appears.
- UP FOR GRABS (ignore): a schedule or an offer with free places, "Zapisz się" (sign up), "Zarezerwuj" (book), "Wybierz termin" (pick a slot), a price list. You can tell by many equivalent slots and counts of free places.
- CANCELLED (ignore): a booking marked "Anulowana" or "Odwołana" is no longer the user's.
The page title and URL are hints too (e.g. "upcoming", "my_bookings", "client_panel").

Rules:
1. If the page is only an offer or a schedule without a slot of the user's, return an empty events list. Never pick a slot from an offer.
2. If the user has several upcoming slots, return each of them once, in chronological order. The same slot may appear twice on the page (in the list of bookings and in the schedule) – it is still one event.
3. Resolve relative dates ("dzisiaj" = today, "jutro" = tomorrow, "w czwartek" = on Thursday) against today's date.
4. Write times as local wall-clock time without a zone, format YYYY-MM-DDTHH:MM.
5. The duration and the address often sit elsewhere on the page than the line with the slot itself (a schedule cell, the footer) – look for them in the whole text. If there is no duration, assume 60 minutes.
6. title: pattern "Activity – Place", 2–5 words, the way a person would type it into their own calendar, in the language of the page. Name the activity colloquially (Barber, Tenis, Squash, CrossFit Endurance), not with the service name from the page. Examples: "Barber – Stary Fotel Barber", "Tenis – Parkowa", "CrossFit Endurance – CrossFit Wisła".
7. venue: the name of the place, as on its signboard (e.g. "Stary Fotel Barber", "CrossFit Wisła").
8. address: only the postal address "street number, postcode city" – no unit, court or room number, no company name, no list numbering. If the page has no address, leave it empty.
9. source_quote is a verbatim, unmodified fragment of the text from which you took the date and time.`;
}

// OpenRouter does not guarantee clean JSON on every endpoint – cut the first object out of the response.
function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`Model did not return JSON: ${text.slice(0, 100)}`);
  return JSON.parse(m[0]);
}

export async function extract(page, apiKey, { now = new Date(), model = DEFAULT_MODEL } = {}) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt(now) },
        { role: 'user', content: `Page title: ${page.title}\nURL: ${page.url}\n\n${page.text}` },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'reservation', strict: true, schema: SCHEMA } },
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return { events: parseJson(data.choices[0].message.content).events, usage: data.usage };
}
