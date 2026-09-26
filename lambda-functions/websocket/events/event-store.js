/**
 * AN EVENT'S ROWS — their keys, how they are read, and what a response says
 * about them (docs/design/agenda-redesign/40-data-model.html).
 *
 *   PK: GAMES             SK: GAME#<code>    the code (code-reservation.js)
 *   PK: ORG#<org>#EVENTS  SK: EVENT#<code>   the org's list row
 *   PK: EVENT#<code>      SK: METADATA       the event
 *   PK: EVENT#<code>      SK: ITEM#<id>      one agenda item each
 *
 * The partition keys come from tenant.js; the sort keys are spelled here and
 * nowhere else. Title, Place and each item's Title and Description are sealed
 * (tenant-crypto.js, entities `event` and `item`); every reader decrypts.
 */
const META_SK = 'METADATA';
const INDEX_PREFIX = 'EVENT#';

const indexSk = (code) => `${INDEX_PREFIX}${code}`;

/** The code a METADATA row (PK=EVENT#<code>) or a list row (SK=EVENT#<code>) is about. */
function codeOf(row) {
  const pk = String((row && row.PK) || '');
  if (pk.startsWith(INDEX_PREFIX)) return pk.slice(INDEX_PREFIX.length);
  return String((row && row.SK) || '').replace(/^EVENT#/, '');
}

/**
 * An event as a response names it, from a DECRYPTED METADATA or list row.
 * The list row carries no report default and no engagement or break counts,
 * so those appear only for METADATA.
 */
function projectEvent(row) {
  const r = row || {};
  const out = {
    code: codeOf(r),
    title: typeof r.Title === 'string' ? r.Title : '',
    place: typeof r.Place === 'string' ? r.Place : '',
    startsAt: r.StartsAt || '',
    timeZone: r.TimeZone || '',
    access: r.Access || 'open',
    state: r.State || 'SCHEDULED',
    itemCount: Number(r.ItemCount) || 0,
  };
  if (r.SK === META_SK) {
    out.engagementCount = Number(r.EngagementCount) || 0;
    out.breakCount = Number(r.BreakCount) || 0;
    out.attendeeReports = r.AttendeeReports || 'full';
    out.createdAt = r.CreatedAt || null;
    out.updatedAt = r.UpdatedAt || null;
  }
  return out;
}

module.exports = { META_SK, INDEX_PREFIX, indexSk, codeOf, projectEvent };
