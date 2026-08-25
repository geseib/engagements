/**
 * THE 402 REFUSAL — utils/upgradeRequired.js
 *
 * One helper, four call sites to come. What this pins is that a screen which
 * asks "is this the allowance refusal?" gets a straight answer whether it holds
 * a Response, a bare status, or only a parsed body — because the alternative is
 * four `if (res.status === 402)` copies, and the one that drifts shows a
 * generic "something went wrong" over somebody's shoulder.
 */
import parse, {
  isUpgradeRequired,
  parseUpgradeRequired,
  readUpgradeRequired,
  UPGRADE_REQUIRED_STATUS,
  UPGRADE_REQUIRED_CODE,
} from '../utils/upgradeRequired';

const BODY = {
  code: 'upgrade_required',
  upgradeRequired: true,
  message: 'You have used all 5 sessions this month.',
  limit: { kind: 'sessions', used: 5, included: 5, period: 'August 2026' },
  upgrade: { plan: 'team', priceLabel: '$5 a month' },
};

test('the default export is parseUpgradeRequired', () => {
  expect(parse).toBe(parseUpgradeRequired);
});

describe('recognising it', () => {
  // rejects: matching on the body alone, so a bare 402 from a proxy reads as a server error
  test('a 402 is enough on its own', () => {
    expect(isUpgradeRequired({ status: UPGRADE_REQUIRED_STATUS }, null)).toBe(true);
    expect(isUpgradeRequired(402)).toBe(true);
  });

  // rejects: matching on the status alone, so a rewritten status hides the refusal
  test('the code in the body is enough on its own', () => {
    expect(isUpgradeRequired({ status: 200 }, { code: UPGRADE_REQUIRED_CODE })).toBe(true);
    expect(isUpgradeRequired({ status: 403 }, { upgradeRequired: true })).toBe(true);
  });

  // rejects: treating any 4xx, or any error body, as the allowance refusal
  test('nothing else is it', () => {
    expect(isUpgradeRequired({ status: 403 }, { code: 'forbidden' })).toBe(false);
    expect(isUpgradeRequired({ status: 500 }, null)).toBe(false);
    expect(isUpgradeRequired(null, null)).toBe(false);
    expect(isUpgradeRequired({ status: 400 }, 'upgrade_required')).toBe(false);
    expect(isUpgradeRequired({ status: 400 }, ['upgrade_required'])).toBe(false);
  });
});

describe('what a screen gets back', () => {
  // rejects: returning the raw body and leaving every screen to dig the numbers out
  test('the parts, normalised', () => {
    expect(parseUpgradeRequired({ status: 402 }, BODY)).toMatchObject({
      blocked: true,
      kind: 'sessions',
      used: 5,
      included: 5,
      period: 'August 2026',
      plan: 'team',
      priceLabel: '$5 a month',
      message: 'You have used all 5 sessions this month.',
    });
  });

  // rejects: leaking undefined into copy as "undefined of undefined"
  test('a 402 with no body still answers, with nulls and empty strings', () => {
    const refusal = parseUpgradeRequired({ status: 402 }, null);
    expect(refusal.blocked).toBe(true);
    expect(refusal.used).toBeNull();
    expect(refusal.included).toBeNull();
    expect(refusal.kind).toBe('');
    expect(refusal.message).toBe('');
    expect(refusal.limit).toEqual({});
  });

  // rejects: returning a string "5" where a caller writes `used > included`
  test('the numbers are numbers, and overage survives', () => {
    const over = parseUpgradeRequired(402, {
      limit: { used: '20', limit: '5' },
    });
    expect(over.used).toBe(20);
    expect(over.included).toBe(5);
    expect(over.used > over.included).toBe(true);
  });

  // rejects: answering for a plain server error, which would draw an upgrade prompt
  test('anything that is not the refusal is null', () => {
    expect(parseUpgradeRequired({ status: 500 }, { message: 'boom' })).toBeNull();
  });
});

describe('reading it off a live Response', () => {
  const response = (status, body) => ({
    status,
    clone: () => ({ json: async () => body }),
    json: async () => body,
  });

  // rejects: consuming the caller's body stream so their own error handling dies
  test('the caller can still read its own body afterwards', async () => {
    const res = response(402, BODY);
    const refusal = await readUpgradeRequired(res);
    expect(refusal.used).toBe(5);
    await expect(res.json()).resolves.toEqual(BODY);
  });

  // rejects: throwing on an unparseable 402 instead of saying "you are at your limit"
  test('a 402 with an unreadable body is still a refusal', async () => {
    const res = {
      status: 402,
      clone: () => ({ json: async () => { throw new Error('not json'); } }),
    };
    const refusal = await readUpgradeRequired(res);
    expect(refusal.blocked).toBe(true);
    expect(refusal.used).toBeNull();
  });

  // rejects: reading and discarding the body of every non-402 response
  test('a normal response is null without the body being touched', async () => {
    const json = jest.fn();
    expect(await readUpgradeRequired({ status: 200, clone: () => ({ json }) })).toBeNull();
    expect(await readUpgradeRequired(null)).toBeNull();
    expect(json).not.toHaveBeenCalled();
  });
});

describe('it draws nothing', () => {
  // rejects: growing billing UI inside the shared helper
  test('the module is logic only — no JSX, no React', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'utils', 'upgradeRequired.js'), 'utf8');
    expect(src).not.toMatch(/from 'react'/);
    expect(src.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/<[A-Za-z]/);
  });
});
