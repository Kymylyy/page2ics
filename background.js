import { buildIcs } from './ics.js';
import { extract } from './extract.js';
import { precheck, verify } from './jev.js';

const MAX_CHARS = 20000;
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
// Thresholds for jev answers (0–1), picked from the measurements in test/eval.js: every "no" scored ≤ 0.19, every "yes" ≥ 0.79.
// The precheck rejects a page only on a unanimous, strong "no" – a false rejection is worse than a wasted extraction.
const STRONG_NO = 0.2;
const YES = 0.5;

// Runs in the page context – must not reference anything from this module.
function grabPage(maxChars) {
  const selected = window.getSelection()?.toString().trim();
  return {
    title: document.title,
    url: location.href,
    text: (selected || document.body.innerText).slice(0, maxChars),
  };
}

// Geocodes the bare address (never the venue name – that hits other branches of the same chain).
// Returns coordinates only if the postcode or city from the map matches the address from the model.
async function geocode(address) {
  if (!address) return null;
  const res = await fetch(`${NOMINATIM}?format=json&limit=1&addressdetails=1&q=${encodeURIComponent(address)}`);
  if (!res.ok) return null;
  const [hit] = await res.json();
  if (!hit) return null;
  const a = hit.address ?? {};
  const city = a.city || a.town || a.village || '';
  const ok = (a.postcode && address.includes(a.postcode)) || (city && address.toLowerCase().includes(city.toLowerCase()));
  return ok ? { lat: hit.lat, lon: hit.lon } : null;
}

function notify(message) {
  chrome.notifications.create({ type: 'basic', iconUrl: 'icon.png', title: 'page2ics', message });
}

function fileName(title) {
  return (title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'booking') + '.ics';
}

chrome.action.onClicked.addListener(async (tab) => {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (!apiKey) {
    chrome.runtime.openOptionsPage();
    return;
  }

  chrome.action.setBadgeText({ tabId: tab.id, text: '…' });
  try {
    const [{ result: page }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: grabPage,
      args: [MAX_CHARS],
    });
    // A jev failure (alpha endpoint) never blocks – the step is skipped.
    const pre = await precheck(page, apiKey).catch(() => null);
    if (pre && pre.answers.has_datetime < STRONG_NO && pre.answers.is_booking < STRONG_NO) {
      notify('No date or booking found on this page.');
      return;
    }
    const { event: ev } = await extract(page, apiKey);
    if (!ev.found) {
      notify('No booking of yours found on this page.');
      return;
    }
    const [geo, check] = await Promise.all([
      geocode(ev.address).catch(() => null),
      verify(page, ev, apiKey).catch(() => null),
    ]);
    if (check?.answers.cancelled > YES) {
      notify('This booking looks cancelled.');
      return;
    }
    const notes = [];
    if (ev.address && !geo) notes.push('⚠ Address not verified on the map');
    if (check && check.answers.is_users < YES) notes.push('⚠ Not sure this is your booking rather than an open slot');
    if (check && check.answers.date_matches < YES) notes.push('⚠ Date or time may not match the page – please check');
    const ics = buildIcs({ ...ev, geo, description: [ev.source_quote, page.url, ...notes].join('\n\n') });
    await chrome.downloads.download({
      url: 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics),
      filename: fileName(ev.title),
    });
  } catch (e) {
    notify(`Error: ${e.message}`);
  } finally {
    chrome.action.setBadgeText({ tabId: tab.id, text: '' });
  }
});
