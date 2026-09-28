/**
 * A PRESENTATION'S SLIDES — one PDF on a presentation item, uploaded straight
 * to the media bucket, shown on the event's stage a page at a time, the page
 * kept for a reload and for phones following the talk.
 *
 * The owner, 27 Sep 2026: "can the presentation show pdf presentation with
 * arrow key forward/backward through the pages?"
 *
 * Drives the real handlers — POST /events/{code}/deck, the item routes' `deck`
 * field, GET /events/{code}/items/{itemId}/deck, run.js's `page`, the public
 * agenda's `slides`, `view=now` and `view=deck`, item and event deletion —
 * against the event harness's table, KMS and in-memory media bucket
 * (tests/helpers/event-harness.js), and reads the template's grants as text.
 *
 * Each check names what it rejects on its `// rejects:` line.
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  installEventHarness, asHost, request, seedOrg, startsIn, bodyOf, REPO,
} = require('./helpers/event-harness');
const { plainRow } = require('./helpers/tenant-crypto-stub');

const h = installEventHarness();
const { table, media } = h;
const create = h.load('lambda-functions/websocket/events/create-event.js').handler;
const items = h.load('lambda-functions/websocket/events/items.js').handler;
const getEvent = h.load('lambda-functions/websocket/events/get-event.js').handler;
const agendaFn = h.load('lambda-functions/websocket/events/get-agenda.js').handler;
const updateEventFn = h.load('lambda-functions/websocket/events/update-event.js').handler;
const rules = h.load('lambda-functions/websocket/events/agenda-rules.js');
const D = h.load('lambda-functions/websocket/events/deck-store.js');
const { isEnvelope } = h.load('lambda-functions/websocket/tenant-crypto.js');

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok - ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL - ${label}\n    ${e.stack || e.message}`); fail += 1; }
}

const NW = 'org_nw';
const MD = 'org_md';
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj << /Type /Catalog >> endobj\n', 'latin1');
let code;

const call = (method, route, { body, org = NW, params = {}, query } = {}) => items({
  ...request({
    method, path: `/dev${route}`, pathParameters: { code, ...params }, requestContext: asHost(org), body,
  }),
  ...(query ? { queryStringParameters: query } : {}),
});
const sign = (file, org) => call('POST', `/events/${code}/deck`, { body: file, org });
const add = (body) => call('POST', `/events/${code}/items`, { body });
const edit = (itemId, body) => call('PUT', `/events/${code}/items/${itemId}`, { body, params: { itemId } });
const removeItem = (itemId) => call('DELETE', `/events/${code}/items/${itemId}`, { params: { itemId } });
const readDeck = (itemId, org) => call('GET', `/events/${code}/items/${itemId}/deck`, { params: { itemId }, org });
const run = (body, org) => call('POST', `/events/${code}/run`, { body, org });
const hostView = async () => bodyOf(await getEvent(request({
  path: `/events/${code}`, pathParameters: { code }, requestContext: asHost(NW),
})));
const publicCall = (query) => agendaFn({
  ...request({ method: 'GET', path: `/dev/events/${code}/agenda`, pathParameters: { code } }),
  ...(query ? { queryStringParameters: query } : {}),
});
const rowOf = (itemId) => table.get(`EVENT#${code}`, `ITEM#${itemId}`);
const deckKeys = () => [...media.objects.keys()].filter((k) => k.startsWith('decks/')).sort();
const stagedKeys = () => [...media.objects.keys()].filter((k) => k.startsWith('staging/')).sort();

/** The browser's half: a signed upload, then the PUT to its URL. */
async function upload(bytes = PDF, file = { name: 'FY26 review.pdf', size: bytes.length, type: 'application/pdf' }, opts) {
  const res = await sign(file);
  assert.strictEqual(res.statusCode, 200, res.body);
  const { upload: u } = bodyOf(res);
  media.put(u.key, bytes, opts);
  return u;
}

async function freshEvent() {
  table.clear();
  media.objects.clear();
  seedOrg(table, NW);
  seedOrg(table, MD);
  code = bodyOf(await create(request({
    method: 'POST', path: '/events', requestContext: asHost(NW),
    body: { title: 'Q4 Kickoff', startsAt: startsIn(20), timeZone: 'Europe/London' },
  }))).event.code;
}

async function talkWithSlides(pages = 12, title = 'FY26 in review') {
  const u = await upload();
  const res = await add({ type: 'presentation', title, minutes: 20, ledBy: 'Dana', deck: { key: u.key, name: 'FY26 review.pdf', pages } });
  assert.strictEqual(res.statusCode, 201, res.body);
  return bodyOf(res).item;
}

(async () => {
  console.log('\n1. what a presentation\'s slides may be (agenda-rules.js, both sides of the wire)');
  await check('a PDF within the ceiling passes; its name is its last path segment', () => {
    // rejects: a browser path ("C:\\fakepath\\…") kept as the file's name.
    assert.deepStrictEqual(rules.checkDeckFile({ name: 'C:\\fakepath\\Deck.PDF', size: 10, type: '' }).value, { name: 'Deck.PDF', size: 10 });
    assert.deepStrictEqual(rules.checkDeckFile({ name: 'a.pdf', size: rules.DECK_MAX_BYTES, type: 'application/pdf' }).value, { name: 'a.pdf', size: rules.DECK_MAX_BYTES });
  });
  await check('anything but a PDF, an empty file and one past 50 MB are refused, in words', () => {
    // rejects: a .pptx, an image, or a PDF name with another declared type offered as slides; a file over the ceiling.
    assert.match(rules.checkDeckFile({ name: 'deck.pptx', size: 10 }).error, /not a PDF\. PowerPoint, Keynote and Google Slides all save as PDF/);
    assert.match(rules.checkDeckFile({ name: 'deck.pdf', size: 10, type: 'image/png' }).error, /not a PDF/);
    assert.match(rules.checkDeckFile({ name: 'deck.pdf', size: 0 }).error, /is empty/);
    assert.match(rules.checkDeckFile({ name: 'deck.pdf', size: rules.DECK_MAX_BYTES + 1 }).error, /Slides can be 50 MB at most/);
    assert.strictEqual(rules.DECK_MAX_BYTES, 50 * 1024 * 1024);
  });
  await check('slides name a key, a file name and a whole number of pages', () => {
    // rejects: a page count of 0, a fraction, or past the bound; slides with no key.
    assert.ok(rules.checkDeckFields({ key: 'k', name: 'a.pdf', pages: 12 }).value);
    for (const pages of [0, 1.5, rules.DECK_MAX_PAGES + 1, '12x', null]) {
      assert.match(rules.checkDeckFields({ key: 'k', name: 'a.pdf', pages }).error, /1 to 2000 pages/);
    }
    assert.match(rules.checkDeckFields({ name: 'a.pdf', pages: 3 }).error, /Choose a PDF/);
    assert.strictEqual(rules.slideLabel(3, 12), 'Slide 3 of 12');
    assert.strictEqual(rules.slidesLabel(1), '1 slide');
    assert.strictEqual(rules.slidesLabel(12), '12 slides');
    assert.deepStrictEqual([rules.clampPage(0, 12), rules.clampPage(13, 12), rules.clampPage('x', 12), rules.clampPage(4, 12)], [1, 12, 1, 4]);
  });
  await check('only a presentation has slides', () => {
    // rejects: a PDF on an engagement, an activity or a break.
    assert.deepStrictEqual(rules.ITEM_TYPES.filter(rules.hasDeck), ['presentation']);
  });

  console.log('\n2. POST /events/{code}/deck signs one upload, of a PDF, to a key the server chose');
  await freshEvent();
  await check('a PDF gets one signed PUT under staging/decks/<org tag>/<code>/, typed application/pdf', async () => {
    // rejects: an upload signed for a key the caller chose; the organisation's id in a key a phone could read.
    const res = await sign({ name: 'Deck.pdf', size: 100, type: 'application/pdf', key: 'sets/evil/x.jpg' });
    assert.strictEqual(res.statusCode, 200, res.body);
    const { upload: u } = bodyOf(res);
    assert.match(u.key, new RegExp(`^staging/decks/[0-9a-f]{16}/${code}/[0-9a-f]{16}\\.pdf$`));
    assert.ok(!u.key.includes(NW), 'the org id is in the key');
    assert.strictEqual(u.contentType, 'application/pdf');
    assert.strictEqual(u.maxBytes, rules.DECK_MAX_BYTES);
    const signed = media.signed[media.signed.length - 1];
    assert.deepStrictEqual([signed.name, signed.input.Bucket, signed.input.Key, signed.input.ContentType],
      ['PutObjectCommand', 'test-media', u.key, 'application/pdf']);
    assert.strictEqual(signed.expiresIn, D.UPLOAD_TTL_SECONDS);
  });
  await check('two uploads for one event get two keys', async () => {
    // rejects: a replaced deck written over the key a stage may still be reading.
    const a = bodyOf(await sign({ name: 'a.pdf', size: 5 })).upload.key;
    const b = bodyOf(await sign({ name: 'a.pdf', size: 5 })).upload.key;
    assert.notStrictEqual(a, b);
  });
  await check('a file that is not a PDF, or too big, is refused and nothing is signed', async () => {
    // rejects: a signature handed out for a .pptx or a 60 MB file.
    const before = media.signed.length;
    for (const file of [{ name: 'deck.pptx', size: 10 }, { name: 'deck.pdf', size: 60 * 1024 * 1024 }]) {
      const res = await sign(file);
      assert.strictEqual(res.statusCode, 400, res.body);
    }
    assert.strictEqual(media.signed.length, before);
  });
  await check('another organisation\'s member gets the unknown code\'s 404, and no signature', async () => {
    // rejects: an upload signed into somebody else's event.
    const before = media.signed.length;
    const res = await sign({ name: 'deck.pdf', size: 10 }, MD);
    assert.strictEqual(res.statusCode, 404, res.body);
    assert.strictEqual(bodyOf(res).error, 'No event has that code.');
    assert.strictEqual(media.signed.length, before);
  });
  await check('no media bucket configured is a plain 500, not a signature for nowhere', async () => {
    // rejects: a URL signed for an empty bucket name.
    const was = process.env.MEDIA_BUCKET;
    delete process.env.MEDIA_BUCKET;
    try {
      const res = await sign({ name: 'deck.pdf', size: 10 });
      assert.strictEqual(res.statusCode, 500, res.body);
      assert.match(bodyOf(res).error, /cannot be stored/);
    } finally {
      process.env.MEDIA_BUCKET = was;
    }
  });

  console.log('\n3. a presentation added with its slides');
  await freshEvent();
  let talk;
  await check('the upload is proven a PDF, moved to decks/, and the item says "12 slides" on page 1', async () => {
    // rejects: a staged copy left behind; a deck attached without its size read from the object itself.
    const u = await upload();
    const res = await add({ type: 'presentation', title: 'FY26 in review', minutes: 20, deck: { key: u.key, name: 'FY26 review.pdf', pages: 12 } });
    assert.strictEqual(res.statusCode, 201, res.body);
    talk = bodyOf(res).item;
    assert.deepStrictEqual(talk.deck, { id: D.deckIdOf(u.key), name: 'FY26 review.pdf', pages: 12, bytes: PDF.length });
    assert.strictEqual(talk.deckPage, 1);
    assert.deepStrictEqual(stagedKeys(), []);
    assert.deepStrictEqual(deckKeys(), [D.deckKeyOf(u.key)]);
    assert.strictEqual(media.objects.get(D.deckKeyOf(u.key)).contentType, 'application/pdf');
  });
  await check('the file\'s name is sealed in the row; where it lives, its size and the page are not', async () => {
    // rejects: a deck's file name stored in the clear.
    const row = rowOf(talk.itemId);
    assert.ok(isEnvelope(row.DeckName), 'DeckName is plaintext');
    assert.strictEqual(plainRow(NW, row).DeckName, 'FY26 review.pdf');
    assert.deepStrictEqual(Object.keys(row.Deck).sort(), ['bytes', 'key', 'pages']);
    assert.ok(D.isDeckKeyFor(row.Deck.key, NW, code));
    assert.strictEqual(row.DeckPage, 1);
  });
  await check('the host\'s view names the deck, and never its storage key', async () => {
    // rejects: the storage key in a response.
    const view = await hostView();
    const item = view.items.find((i) => i.itemId === talk.itemId);
    assert.deepStrictEqual(item.deck, talk.deck);
    assert.ok(!JSON.stringify(view).includes('decks/'), 'a storage key reached the host view');
  });

  console.log('\n4. what is refused on the way in');
  await freshEvent();
  await check('another event\'s upload, and another organisation\'s, cannot be attached here', async () => {
    // rejects: attaching a staged upload signed for a different event or organisation.
    const u = await upload();
    const foreign = u.key.replace(`/${code}/`, '/9999/');
    media.put(foreign, PDF);
    const otherOrg = `staging/decks/${D.orgTag(MD)}/${code}/0123456789abcdef.pdf`;
    media.put(otherOrg, PDF);
    for (const key of [foreign, otherOrg, 'sets/abc/x.pdf', D.deckKeyOf(u.key)]) {
      const res = await add({ type: 'presentation', title: 'x', minutes: 5, deck: { key, name: 'x.pdf', pages: 3 } });
      assert.strictEqual(res.statusCode, 400, `${key}: ${res.body}`);
      assert.match(bodyOf(res).error, /not this event’s/);
    }
    assert.deepStrictEqual(deckKeys(), []);
    assert.strictEqual(table.get(`EVENT#${code}`, 'METADATA').ItemCount, 0);
  });
  await check('a file whose first bytes are not %PDF- is refused, and deleted', async () => {
    // rejects: an HTML page or an executable renamed .pdf becoming anybody's slides.
    const u = await upload(Buffer.from('<html><script>alert(1)</script></html>'));
    const res = await add({ type: 'presentation', title: 'x', minutes: 5, deck: { key: u.key, name: 'x.pdf', pages: 3 } });
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.match(bodyOf(res).error, /not a PDF/);
    assert.ok(!media.objects.has(u.key), 'the staged file was kept');
    assert.deepStrictEqual(deckKeys(), []);
  });
  await check('the PDF header may sit anywhere in the first 1024 bytes, as the format allows', async () => {
    // rejects: a real PDF with a few bytes of preamble refused.
    const u = await upload(Buffer.concat([Buffer.from('\r\n  '), PDF]));
    const res = await add({ type: 'presentation', title: 'Preamble', minutes: 5, deck: { key: u.key, name: 'p.pdf', pages: 1 } });
    assert.strictEqual(res.statusCode, 201, res.body);
  });
  await check('an object past 50 MB is refused on its real size, whatever the browser declared', async () => {
    // rejects: a presigned PUT of more bytes than declared slipping past the ceiling.
    const u = await upload(PDF, { name: 'big.pdf', size: 100 }, { size: 60 * 1024 * 1024 });
    const res = await add({ type: 'presentation', title: 'x', minutes: 5, deck: { key: u.key, name: 'big.pdf', pages: 3 } });
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.match(bodyOf(res).error, /60 MB\. Slides can be 50 MB at most/);
    assert.ok(!media.objects.has(u.key));
  });
  await check('an upload that never landed, and an empty one, are said plainly', async () => {
    // rejects: a 500 for a PUT the browser never finished; an empty file attached.
    const never = bodyOf(await sign({ name: 'x.pdf', size: 10 })).upload.key;
    let res = await add({ type: 'presentation', title: 'x', minutes: 5, deck: { key: never, name: 'x.pdf', pages: 3 } });
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.match(bodyOf(res).error, /did not finish uploading/);
    // Declared as ten bytes; the PUT carried none.
    const empty = await upload(Buffer.alloc(0), { name: 'x.pdf', size: 10 });
    res = await add({ type: 'presentation', title: 'x', minutes: 5, deck: { key: empty.key, name: 'x.pdf', pages: 3 } });
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.match(bodyOf(res).error, /empty/);
  });
  await check('slides on anything but a presentation are refused, and nothing is copied', async () => {
    // rejects: a PDF quietly attached to an activity or a break.
    const u = await upload();
    for (const type of ['custom', 'break']) {
      const res = await add({ type, title: 'x', minutes: 5, deck: { key: u.key, name: 'x.pdf', pages: 3 } });
      assert.strictEqual(res.statusCode, 400, res.body);
      assert.strictEqual(bodyOf(res).error, 'Only a presentation has slides.');
    }
    assert.ok(media.objects.has(u.key), 'the staged upload was consumed');
  });
  await check('an add that loses the cap race lets its just-attached deck go', async () => {
    // rejects: an orphaned deck left in storage by a refused add.
    const meta = table.get(`EVENT#${code}`, 'METADATA');
    const before = deckKeys();
    // The counters move between this add's read and its write: its transaction cancels.
    table.inject((c) => c.type === 'transactWrite',
      () => Object.assign(new Error('cancelled'), { name: 'TransactionCanceledException', CancellationReasons: [] }), 1);
    const u = await upload();
    const res = await add({ type: 'presentation', title: 'Lost', minutes: 5, deck: { key: u.key, name: 'l.pdf', pages: 2 } });
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.deepStrictEqual(deckKeys(), before);
    assert.strictEqual(table.get(`EVENT#${code}`, 'METADATA').ItemCount, meta.ItemCount);
  });

  console.log('\n5. replace and remove');
  await freshEvent();
  talk = await talkWithSlides(12);
  const first = rowOf(talk.itemId).Deck.key;
  await check('a new PDF replaces the old one: the new file is attached, the old one deleted, page 1 again', async () => {
    // rejects: a replaced deck's old file left in storage; the old page carried onto a new deck.
    await run({ action: 'page', itemId: talk.itemId, page: 7 });
    const u = await upload();
    const res = await edit(talk.itemId, { deck: { key: u.key, name: 'v2.pdf', pages: 4 } });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(bodyOf(res).item.deck, { id: D.deckIdOf(u.key), name: 'v2.pdf', pages: 4, bytes: PDF.length });
    assert.strictEqual(bodyOf(res).item.deckPage, 1);
    assert.deepStrictEqual(deckKeys(), [D.deckKeyOf(u.key)]);
    assert.ok(!media.objects.has(first));
    assert.strictEqual(plainRow(NW, rowOf(talk.itemId)).DeckName, 'v2.pdf');
  });
  await check('an edit that does not name the slides leaves them alone', async () => {
    // rejects: a title edit that drops the deck.
    const res = await edit(talk.itemId, { title: 'FY26, reviewed' });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(bodyOf(res).item.deck.pages, 4);
    assert.strictEqual(deckKeys().length, 1);
  });
  await check('an edit that loses its race lets the new file go and keeps the old one', async () => {
    // rejects: a refused edit leaving its new file behind, or taking the old one with it.
    const kept = deckKeys();
    const stale = { ...rowOf(talk.itemId) };
    const u = await upload();
    table.inject((c) => c.type === 'update',
      () => Object.assign(new Error('changed'), { name: 'ConditionalCheckFailedException' }), 1);
    const res = await edit(talk.itemId, { deck: { key: u.key, name: 'v3.pdf', pages: 9 } });
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.deepStrictEqual(deckKeys(), kept);
    assert.deepStrictEqual(rowOf(talk.itemId).Deck, stale.Deck);
  });
  await check('`deck: null` takes the slides off: the row forgets them and the file is deleted', async () => {
    // rejects: a removed deck still readable from storage; its page left on the row.
    const res = await edit(talk.itemId, { deck: null });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(bodyOf(res).item.deck, undefined);
    const row = rowOf(talk.itemId);
    assert.deepStrictEqual([row.Deck, row.DeckName, row.DeckPage], [undefined, undefined, undefined]);
    assert.deepStrictEqual(deckKeys(), []);
  });
  await check('slides on an activity are refused on edit too; `deck: null` on one is "none"', async () => {
    // rejects: a deck attached to a non-presentation by the edit route.
    const act = bodyOf(await add({ type: 'custom', title: 'Lunch', minutes: 30 })).item;
    const u = await upload();
    let res = await edit(act.itemId, { deck: { key: u.key, name: 'x.pdf', pages: 2 } });
    assert.strictEqual(res.statusCode, 400, res.body);
    res = await edit(act.itemId, { deck: null });
    assert.strictEqual(res.statusCode, 200, res.body);
  });
  await check('removing a presentation deletes its slides', async () => {
    // rejects: a removed item's deck left in storage.
    const again = await talkWithSlides(3, 'Second talk');
    assert.strictEqual(deckKeys().length, 1);
    const res = await removeItem(again.itemId);
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(deckKeys(), []);
  });
  await check('deleting the event deletes every presentation\'s slides', async () => {
    // rejects: a deleted event's decks left in storage.
    await talkWithSlides(3, 'One');
    await talkWithSlides(5, 'Two');
    assert.strictEqual(deckKeys().length, 2);
    const res = await updateEventFn(request({
      method: 'DELETE', path: `/events/${code}`, pathParameters: { code }, requestContext: asHost(NW),
    }));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(deckKeys(), []);
  });

  console.log('\n6. the stage reads the slides, and keeps its page');
  await freshEvent();
  talk = await talkWithSlides(12);
  await check('GET …/items/{itemId}/deck signs a read of the attached PDF, with the page the stage was on', async () => {
    // rejects: a deck read without a signature; a signed read of anything but this item's deck.
    const res = await readDeck(talk.itemId);
    assert.strictEqual(res.statusCode, 200, res.body);
    const { deck } = bodyOf(res);
    const key = rowOf(talk.itemId).Deck.key;
    assert.strictEqual(deck.url, `https://media.test.invalid/${key}?op=GetObjectCommand&expires=${D.READ_TTL_SECONDS}&type=application%2Fpdf`);
    assert.deepStrictEqual([deck.id, deck.pages, deck.page, deck.bytes], [D.deckIdOf(key), 12, 1, PDF.length]);
  });
  await check('an item with no slides, and another organisation, get a 404', async () => {
    // rejects: a signed read handed across organisations, or for an item with nothing to read.
    const act = bodyOf(await add({ type: 'custom', title: 'Lunch', minutes: 30 })).item;
    let res = await readDeck(act.itemId);
    assert.strictEqual(res.statusCode, 404, res.body);
    assert.strictEqual(bodyOf(res).code, 'no_slides');
    res = await readDeck(talk.itemId, MD);
    assert.strictEqual(res.statusCode, 404, res.body);
    assert.strictEqual(bodyOf(res).error, 'No event has that code.');
  });
  await check('`page` keeps the slide on the item, and a reload reads it back', async () => {
    // rejects: the page forgotten on reload.
    const res = await run({ action: 'page', itemId: talk.itemId, page: 3 });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(bodyOf(res), { itemId: talk.itemId, page: 3 });
    assert.strictEqual(rowOf(talk.itemId).DeckPage, 3);
    const view = await hostView();
    assert.strictEqual(view.items.find((i) => i.itemId === talk.itemId).deckPage, 3);
    assert.strictEqual(bodyOf(await readDeck(talk.itemId)).deck.page, 3);
  });
  await check('a page past the last slide, a fraction and slide 0 are refused, and nothing moves', async () => {
    // rejects: a page past the last slide stored.
    for (const page of [13, 0, 2.5, 'next']) {
      const res = await run({ action: 'page', itemId: talk.itemId, page });
      assert.strictEqual(res.statusCode, 400, `${page}: ${res.body}`);
      assert.match(bodyOf(res).error, /Choose a slide from 1 to 12/);
    }
    assert.strictEqual(rowOf(talk.itemId).DeckPage, 3);
  });
  await check('`page` on an item without slides is refused in words', async () => {
    // rejects: a page number written onto an activity.
    const act = bodyOf(await add({ type: 'custom', title: 'Coffee', minutes: 10 })).item;
    const res = await run({ action: 'page', itemId: act.itemId, page: 1 });
    assert.strictEqual(res.statusCode, 409, res.body);
    assert.strictEqual(bodyOf(res).code, 'no_slides');
    assert.strictEqual(rowOf(act.itemId).DeckPage, undefined);
  });
  await check('turning a page moves no state and makes no phone re-read the agenda', async () => {
    // rejects: a page turn that bumps RunRev (every phone re-reads the whole agenda) or answers with the whole event.
    const revBefore = table.get(`EVENT#${code}`, 'METADATA').RunRev;
    const res = await run({ action: 'page', itemId: talk.itemId, page: 4 });
    assert.strictEqual(table.get(`EVENT#${code}`, 'METADATA').RunRev, revBefore);
    assert.strictEqual(bodyOf(res).items, undefined);
    assert.strictEqual(rowOf(talk.itemId).State, 'planned');
  });

  console.log('\n7. phones: the count on the agenda, the page while it is live, the file once it has started');
  await check('the public agenda says how many slides, and nothing about where they are', async () => {
    // rejects: the storage key or the organisation's tag in the public agenda.
    const res = await publicCall();
    assert.strictEqual(res.statusCode, 200, res.body);
    const text = res.body;
    assert.strictEqual(bodyOf(res).items.find((i) => i.itemId === talk.itemId).slides, 12);
    assert.ok(!text.includes('decks/') && !text.includes(D.orgTag(NW)) && !text.includes('FY26 review.pdf'));
  });
  await check('before the talk starts a phone cannot read the slides', async () => {
    // rejects: slides readable before the host starts the talk (decision 11).
    const res = await publicCall({ view: 'deck', item: talk.itemId });
    assert.strictEqual(res.statusCode, 404, res.body);
    assert.strictEqual(bodyOf(res).code, 'no_slides');
  });
  await check('once it is live, `now` carries the page and a phone may read the file', async () => {
    // rejects: phones left without the page the stage is on.
    assert.strictEqual((await run({ action: 'start', itemId: talk.itemId })).statusCode, 200);
    await run({ action: 'page', itemId: talk.itemId, page: 6 });
    const now = bodyOf(await publicCall({ view: 'now' })).now;
    assert.deepStrictEqual(now.live.slides, { page: 6, pages: 12 });
    const res = await publicCall({ view: 'deck', item: talk.itemId });
    assert.strictEqual(res.statusCode, 200, res.body);
    const { deck } = bodyOf(res);
    assert.match(deck.url, /op=GetObjectCommand/);
    assert.deepStrictEqual([deck.page, deck.pages], [6, 12]);
    assert.ok(!('bytes' in deck) && !('name' in deck));
  });
  await check('a deck pointer that is not this event\'s is never signed for a phone', async () => {
    // rejects: a row pointed at another event's deck serving it through this event's code.
    const row = rowOf(talk.itemId);
    table.put({ ...row, Deck: { ...row.Deck, key: row.Deck.key.replace(`/${code}/`, '/9999/') } });
    try {
      const res = await publicCall({ view: 'deck', item: talk.itemId });
      assert.strictEqual(res.statusCode, 404, res.body);
    } finally {
      table.put(row);
    }
  });
  await check('an unknown or malformed item is the same 404', async () => {
    // rejects: the deck view telling "no such item" apart from "not open".
    for (const item of ['it_0000abcd', 'nope', '']) {
      const res = await publicCall({ view: 'deck', item });
      assert.strictEqual(res.statusCode, 404, res.body);
    }
  });
  await check('the page survives the day ending, for the host looking back', async () => {
    // rejects: the stage's page write refused after the event is over.
    assert.strictEqual((await run({ action: 'end-event' })).statusCode, 200);
    const res = await run({ action: 'page', itemId: talk.itemId, page: 2 });
    assert.strictEqual(res.statusCode, 200, res.body);
  });

  console.log('\n8. the template: routes, grants, and the bucket\'s public read');
  const template = fs.readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');
  const resource = (name) => {
    const start = template.indexOf(`\n  ${name}:\n`);
    assert.ok(start >= 0, `${name} is not in the template`);
    const next = template.slice(start + 1).search(/\n {2}[A-Za-z0-9]+:\n/);
    return template.slice(start, start + 1 + next);
  };
  await check('the items function carries both slide routes and the media bucket', () => {
    // rejects: a slide route on a new function (the stack is at its limit), or one without the bucket.
    const fn = resource('EventItemsFunction');
    assert.match(fn, /Path: \/events\/\{code\}\/deck\s*\n\s*Method: post\s*\n\s*Auth:\s*\n\s*Authorizer: CognitoAuthorizer/);
    assert.match(fn, /Path: \/events\/\{code\}\/items\/\{itemId\}\/deck\s*\n\s*Method: get\s*\n\s*Auth:\s*\n\s*Authorizer: CognitoAuthorizer/);
    assert.match(fn, /MEDIA_BUCKET: !Ref MediaBucket/);
  });
  await check('its S3 grants are the two deck prefixes and nothing else', () => {
    // rejects: a signing role that could write question artwork under sets/, or anywhere in the bucket.
    const fn = resource('EventItemsFunction');
    const grants = [...fn.matchAll(/\$\{MediaBucket\.Arn\}([^']*)'/g)].map((m) => m[1]).sort();
    assert.deepStrictEqual(grants, ['/decks/*', '/staging/decks/*']);
    assert.match(fn, /Action: \['s3:PutObject', 's3:GetObject', 's3:DeleteObject'\]/);
    assert.ok(!/s3:\*/.test(fn));
  });
  await check('the public agenda may only read attached decks; event delete may only delete them', () => {
    // rejects: a public function that can read staged uploads or write anything; a delete grant beyond decks/.
    const agenda = resource('EventAgendaFunction');
    assert.deepStrictEqual([...agenda.matchAll(/Action: \[([^\]]*)\]\s*\n\s*Resource: !Sub '\$\{MediaBucket\.Arn\}([^']*)'/g)].map((m) => [m[1], m[2]]),
      [["'s3:GetObject'", '/decks/*']]);
    const update = resource('UpdateEventFunction');
    assert.deepStrictEqual([...update.matchAll(/Action: \[([^\]]*)\]\s*\n\s*Resource: !Sub '\$\{MediaBucket\.Arn\}([^']*)'/g)].map((m) => [m[1], m[2]]),
      [["'s3:DeleteObject'", '/decks/*']]);
    for (const fn of [agenda, update]) assert.match(fn, /MEDIA_BUCKET: !Ref MediaBucket/);
  });
  await check('the media bucket\'s public read covers question artwork only', () => {
    // rejects: slides made public by being in a bucket whose policy reads /*.
    const policy = resource('MediaBucketPolicy');
    assert.match(policy, /Resource: !Sub '\$\{MediaBucket\.Arn\}\/sets\/\*'/);
    assert.ok(!/\$\{MediaBucket\.Arn\}\/\*'/.test(policy), 'public read still covers the whole bucket');
  });
  await check('an upload nobody attached expires the next day', () => {
    // rejects: abandoned 50 MB uploads kept forever.
    const bucket = resource('MediaBucket');
    assert.match(bucket, /- Id: ExpireStagedDecks\s*\n\s*Status: Enabled\s*\n\s*Prefix: staging\/decks\/\s*\n\s*ExpirationInDays: 1/);
  });
  await check('the three copies of tenant-crypto.js agree, and seal the deck\'s name', () => {
    // rejects: a copy that drifted, so one bundle writes DeckName in the clear.
    const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
    const ws = read('lambda-functions/websocket/tenant-crypto.js');
    assert.strictEqual(read('lambda-functions/game/tenant-crypto.js'), ws);
    assert.strictEqual(read('lambda-functions/admin/shared/tenant-crypto.js'), ws);
    assert.ok(h.load('lambda-functions/websocket/tenant-crypto.js').ENCRYPTED_FIELDS.item.includes('DeckName'));
  });
  await check('the websocket bundle declares the S3 packages it now requires', () => {
    // rejects: a deploy whose bundle cannot sign a URL.
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'lambda-functions/websocket/package.json'), 'utf8'));
    for (const dep of ['@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner']) assert.ok(pkg.dependencies[dep], dep);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
