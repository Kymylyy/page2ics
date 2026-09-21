// Manual extraction test against the real models (costs tokens).
//   OPENROUTER_API_KEY=... npm run eval                          # default model, 1 run, prints the events
//   OPENROUTER_API_KEY=... MODELS=a/b,c/d RUNS=3 npm run eval    # model comparison: hits, time, cost
// A fixture is a pair: NAME.txt (page text) + NAME.json ({ title, url, now?, expect, wrongEvent? }).
// wrongEvent: the event a mistaken model would return – the jev verifier gets it where extraction rightly found nothing.
import { readdir, readFile } from 'node:fs/promises';
import { extract, DEFAULT_MODEL } from '../extract.js';
import { precheck, verify } from '../jev.js';

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('Missing OPENROUTER_API_KEY');
  process.exit(1);
}
const models = (process.env.MODELS || DEFAULT_MODEL).split(',');
const runs = Number(process.env.RUNS || 1);

const dir = new URL('./fixtures/', import.meta.url);
const fixtures = [];
for (const f of await readdir(dir)) {
  if (!f.endsWith('.txt')) continue;
  const name = f.slice(0, -4);
  const text = await readFile(new URL(f, dir), 'utf8');
  const meta = JSON.parse(await readFile(new URL(`${name}.json`, dir), 'utf8'));
  fixtures.push({ name, text, ...meta });
}

// title is free text from the model – containing the expected fragment is enough. Everything else must match exactly.
function mismatches(got, expect) {
  return Object.entries(expect)
    .filter(([k, v]) => (k === 'title' ? !String(got[k]).includes(v) : got[k] !== v))
    .map(([k, v]) => `${k}: ${JSON.stringify(got[k])} ≠ ${JSON.stringify(v)}`);
}

async function runOne(model, fx) {
  const t0 = performance.now();
  try {
    const { event, usage } = await extract(
      { title: fx.title, url: fx.url, text: fx.text },
      apiKey,
      { model, now: fx.now ? new Date(fx.now) : undefined },
    );
    const errors = mismatches(event, fx.expect);
    return { ok: errors.length === 0, errors, event, cost: usage?.cost, ms: performance.now() - t0 };
  } catch (e) {
    return { ok: false, errors: [e.message], ms: performance.now() - t0 };
  }
}

// Models in parallel, sequentially within a model.
const all = await Promise.all(models.map(async (model) => {
  const results = [];
  for (const fx of fixtures) {
    for (let i = 0; i < runs; i++) results.push({ fixture: fx.name, ...(await runOne(model, fx)) });
  }
  return { model, results };
}));

const single = models.length === 1 && runs === 1;
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

for (const { model, results } of all) {
  console.log(`\n== ${model}`);
  for (const r of results) {
    if (single) console.log(`-- ${r.fixture}`, r.event ?? '');
    for (const e of r.errors) console.log(`   ✗ ${r.fixture}: ${e}`);
    if (!r.ok) process.exitCode = 1;
  }
}

console.log('\n' + ['model'.padEnd(32), ...fixtures.map((f) => f.name.padEnd(20)), 'avg ms'.padStart(7), '$/call'.padStart(8)].join(' '));
for (const { model, results } of all) {
  const cells = fixtures.map((f) => {
    const rs = results.filter((r) => r.fixture === f.name);
    return `${rs.filter((r) => r.ok).length}/${rs.length}`.padEnd(20);
  });
  const costs = results.map((r) => r.cost).filter((c) => typeof c === 'number');
  console.log([
    model.padEnd(32),
    ...cells,
    String(Math.round(avg(results.map((r) => r.ms)))).padStart(7),
    (costs.length ? avg(costs).toFixed(4) : '?').padStart(8),
  ].join(' '));
}

// jev: precheck on every page, verify on the event from the first model (or wrongEvent).
// After a successful extraction, verify also runs on the same event shifted by a day – date_matches should then drop.
const fmt = (answers) => Object.entries(answers).map(([k, v]) => `${k}=${v.toFixed(2)}`).join('  ');
const nextDay = (local) => {
  const d = new Date(`${local}Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 16);
};

console.log('\n== jev');
for (const fx of fixtures) {
  const page = { title: fx.title, url: fx.url, text: fx.text };
  const opts = { now: fx.now ? new Date(fx.now) : undefined };
  const got = all[0].results.find((r) => r.fixture === fx.name).event;
  const ev = got?.found ? got : fx.wrongEvent;
  try {
    const t0 = performance.now();
    const pre = await precheck(page, apiKey);
    console.log(`-- ${fx.name}  (${Math.round(performance.now() - t0)} ms, $${pre.usage?.cost})`);
    console.log(`   precheck           ${fmt(pre.answers)}`);
    if (!ev) continue;
    console.log(`   verify${got?.found ? '            ' : ' wrongEvent '} ${fmt((await verify(page, ev, apiKey, opts)).answers)}`);
    if (got?.found) {
      const shifted = { ...ev, start: nextDay(ev.start), end: nextDay(ev.end) };
      console.log(`   verify +1 day      ${fmt((await verify(page, shifted, apiKey, opts)).answers)}`);
    }
  } catch (e) {
    console.log(`   ✗ ${fx.name}: ${e.message}`);
  }
}
