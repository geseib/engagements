/**
 * PINS FOR public/index.html'S SHARE METADATA.
 *
 * Fix round 2 replaced the SVG og:image (some link-unfurlers never render
 * an SVG at all) with a rasterised PNG at an absolute, prod-origin URL —
 * index.html is one static file shipped by every tier, so a share from dev
 * or test still has to point at an asset that exists (prod's), not at a
 * relative path that would resolve against whichever tier served the page.
 * These checks pin that shape so it cannot quietly regress back to a
 * relative or non-prod URL, or to the SVG.
 */
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(
  path.join(__dirname, '..', '..', 'public', 'index.html'),
  'utf8',
);

const metaContent = (name, attr = 'property') => {
  const re = new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`);
  const match = HTML.match(re);
  return match ? match[1] : null;
};

describe('index.html share metadata', () => {
  test('og:image is an absolute https URL on engage.seibtribe.us ending .png', () => {
    const url = metaContent('og:image');
    expect(url).toMatch(/^https:\/\/engage\.seibtribe\.us\/.*\.png$/);
  });

  test('twitter:image is an absolute https URL on engage.seibtribe.us ending .png', () => {
    const url = metaContent('twitter:image', 'name');
    expect(url).toMatch(/^https:\/\/engage\.seibtribe\.us\/.*\.png$/);
  });

  test('og:image:width and og:image:height are 1200x630', () => {
    expect(metaContent('og:image:width')).toBe('1200');
    expect(metaContent('og:image:height')).toBe('630');
  });

  test('og:url is the prod origin', () => {
    expect(metaContent('og:url')).toBe('https://engage.seibtribe.us/');
  });

  test('og:site_name is Engagements', () => {
    expect(metaContent('og:site_name')).toBe('Engagements');
  });

  test('the referenced share image exists under public/', () => {
    const url = metaContent('og:image');
    const relative = url.replace('https://engage.seibtribe.us/', '');
    const filePath = path.join(__dirname, '..', '..', 'public', relative);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('the description never spells "favourite"/"favorite"', () => {
    const description = metaContent('description', 'name') || '';
    const ogDescription = metaContent('og:description') || '';
    expect(description.toLowerCase()).not.toMatch(/favou?rite/);
    expect(ogDescription.toLowerCase()).not.toMatch(/favou?rite/);
  });

  test('no meta tag references a non-engage.seibtribe.us origin', () => {
    const urls = [...HTML.matchAll(/content="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
    const fontOrigins = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
    const offenders = urls.filter(
      (url) => !url.startsWith('https://engage.seibtribe.us/') && !fontOrigins.some((o) => url.startsWith(o)),
    );
    expect(offenders).toEqual([]);
  });
});
