// Fast yes/no decisions from the jev model (TypeSafe) via the OpenRouter Decisions API. No chrome.*, so test/eval.js can use it.
// The endpoint is in alpha – the request shape may change. Every answer is a number 0–1 (probability of "yes").
// Instructions are in English, where jev is most accurate; the page text stays in its own language.

const ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
const MODEL = 'typesafe/jev-1.13';

const PRECHECK = {
  has_datetime: {
    type: 'noul',
    instructions: 'Does the page text contain a specific day (a date, a weekday, or a relative day such as "dzisiaj"/"jutro") together with a time of day for some event, class or appointment?',
  },
  is_booking: {
    type: 'noul',
    instructions: 'Is this page about a reservation, an appointment, a booked class, or a schedule of classes that can be booked?',
  },
};

const VERIFY = {
  cancelled: {
    type: 'noul',
    instructions: 'According to the page, has the reservation described in extracted_event been cancelled or called off?',
    criteria: {
      true: 'The page marks this reservation as cancelled (Polish: "Anulowana", "Odwołana") or as an absence the user has reported (Polish: "Zgłoszona nieobecność").',
      false: 'The reservation is active. A button that merely offers to cancel it ("Odwołaj rezerwację", "Anuluj", "Zgłoś nieobecność") does not make it cancelled, and neither does a make-up class ("Odrabianie") or an absence reported for a different slot.',
    },
  },
  is_users: {
    type: 'noul',
    instructions: 'Is the user already booked or signed up for the event in extracted_event, as opposed to it being merely an available slot in an offer or a class schedule?',
  },
  date_matches: {
    type: 'noul',
    instructions: 'Do the start and end in extracted_event agree with the date and time the page gives for that event? Resolve relative days against `today`.',
    criteria: {
      true: 'Same day and same start time. If the page gives no duration, an end 60 minutes after the start is fine.',
      false: 'The day or the time differs from what the page says.',
    },
  },
};

async function ask(state, questions, apiKey) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, state, questions }),
  });
  if (!res.ok) throw new Error(`jev ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const answers = Object.fromEntries(Object.entries(data.answers).map(([id, a]) => [id, a.noul]));
  return { answers, usage: data.usage };
}

export function precheck(page, apiKey) {
  return ask({ title: page.title, url: page.url, text: page.text }, PRECHECK, apiKey);
}

export function verify(page, ev, apiKey, { now = new Date() } = {}) {
  const today = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const { title, start, end, venue, address } = ev;
  return ask(
    { today, extracted_event: { title, start, end, venue, address }, page: { title: page.title, url: page.url, text: page.text } },
    VERIFY,
    apiKey,
  );
}
