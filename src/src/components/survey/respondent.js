/**
 * THE ANONYMOUS RESPONDENT — the id a phone files its survey answers under.
 *
 * In Anonymous and Who finished the server keeps each person's answers under
 * `SURVEY#RESP#<respondent>`, and the Names promise the phone shows above
 * question 1 is only as strong as that id: it must say nothing about who is
 * holding the phone. So it is 128 random bits minted HERE, and it is
 * deliberately NOT derived from the join `clientId` (components/joinResult.js).
 * The clientId is stamped on `PLAYER#<name>`; an id made from it would let
 * anyone holding the table join an answer back to a name, which is exactly the
 * thing Anonymous says cannot happen. docs/design/survey-redesign/
 * IMPLEMENTATION-phase-2.md §2 "Rows"; the server checks the shape
 * `/^r_[A-Za-z0-9_-]{22}$/`.
 *
 * Named mode never calls this: there the respondent IS the player, proven by
 * the clientId, and minting an id nobody reads would only leave a key behind.
 *
 * PER GAME, like `playerClient_<gameId>`: one id across sessions would be a
 * tracking handle.
 */

export const respondentStorageKey = (gameId) => `surveyResp_${gameId}`;

const SHAPE = /^r_[A-Za-z0-9_-]{22}$/;

/** 16 bytes → 22 base64url characters (24 in base64, less the `==` of padding). */
function base64url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function mintRespondentId() {
  const bytes = new Uint8Array(16);
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    // Every browser this product supports has getRandomValues; this is for a
    // runtime that has none, where an id that is merely unlikely to collide is
    // still better than refusing to answer. It is weaker, and says so.
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return `r_${base64url(bytes)}`;
}

/*
  THE IN-MEMORY FALLBACK, AND WHAT IT COSTS.

  Private-mode Safari throws on setItem, and some phones have site storage
  switched off. Answering must still work there, so the id falls back to one
  held for the life of this page. The cost is resume: in Anonymous and Who
  finished a reload (or a second tab) mints a new respondent, so the answers
  already saved stay on the server but this phone can no longer find them, and
  the person starts again as someone new. That is the honest limit of an
  identity that is, on purpose, attached to nothing — Named resumes from any
  device because there the server knows who you are.
*/
const memory = new Map();

export function getRespondentId(gameId, storage) {
  const store = storage === undefined
    ? (typeof localStorage !== 'undefined' ? localStorage : null)
    : storage;
  const key = respondentStorageKey(gameId);

  if (store) {
    try {
      const existing = store.getItem(key);
      if (existing && SHAPE.test(existing)) return existing;
      const minted = mintRespondentId();
      store.setItem(key, minted);
      return minted;
    } catch (error) {
      /* fall through to the page's own memory */
    }
  }

  if (!memory.has(key)) memory.set(key, mintRespondentId());
  return memory.get(key);
}
