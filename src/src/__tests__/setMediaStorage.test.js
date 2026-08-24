/**
 * WHERE QUESTION IMAGES LIVE, AND THE ONE THING THAT WOULD ERASE THEM.
 *
 * All three buildspecs publish the frontend with
 *
 *     aws s3 sync dist/ s3://$BUCKET_NAME/ --delete
 *
 * `--delete` removes every object in the destination that is not in the build
 * output. Uploaded question artwork under `sets/<setId>/` is never in `dist/`
 * — the committed repo assets under `/assets/art/` survive only because they
 * ARE — so an image stored in the website bucket lives exactly until the next
 * deploy of that tier and then disappears with no error anywhere.
 *
 * The storage decision is therefore a SEPARATE BUCKET, `${StackName}-media`,
 * served at `sets/*` by a second CloudFront origin so the stored key stays a
 * same-origin relative URL and `<img src={question.image}>` needs no resolver
 * (PlayerPage.jsx:1961,2196, GameHostPage.jsx:4571,4614,5213).
 *
 * The alternative — `--exclude "sets/*"` on the sync — would also work, and was
 * rejected: it is an unremarkable flag in three files that a copy-paste loses,
 * it protects nothing against a hand-run sync, and its removal is invisible
 * until a room is looking at a broken image.
 *
 * ── WHAT GREEN HERE MEANS ─────────────────────────────────────────────────
 *
 * That the separation still exists IN THE TEMPLATE AND THE BUILDSPECS. It
 * cannot prove anything about the deployed stacks — only `aws cloudformation
 * describe-stacks` can — and it deliberately does not try. Every assertion
 * below fails if the media bucket, the cache behaviour, or the separation of
 * the two buckets in the sync is removed. That is the whole job.
 *
 * NO GEOMETRY IS ASSERTED HERE. This file reads YAML as text.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..');
const read = (...p) => fs.readFileSync(path.join(REPO, ...p), 'utf8');

const TEMPLATE = read('template-clean.yaml');
const BUILDSPECS = {
  dev: read('buildspec-dev.yml'),
  test: read('buildspec-test.yml'),
  prod: read('buildspec-prod.yml'),
};
const SHARED = read('lambda-functions', 'admin', 'shared', 'set-media.js');

/** Every `aws s3 sync` command line in a buildspec, comments stripped. */
function syncLines(spec) {
  return spec
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !line.startsWith('#'))
    .filter((line) => /aws\s+s3\s+sync/.test(line));
}

/**
 * The body of a top-level `Resources:` entry, by logical id. Read by
 * indentation because the template is 3000 lines and a YAML parser is not a
 * dependency this repo has.
 */
function resource(id) {
  const start = TEMPLATE.indexOf(`\n  ${id}:\n`);
  if (start < 0) throw new Error(`No resource "${id}" in template-clean.yaml — renamed or removed?`);
  const rest = TEMPLATE.slice(start + 1);
  const lines = rest.split('\n');
  const body = [lines[0]];
  for (const line of lines.slice(1)) {
    if (line.trim() && !/^\s{3,}/.test(line)) break;   // next 2-space-indented key
    body.push(line);
  }
  // COMMENTS STRIPPED. The header comments on these resources explain which
  // actions are deliberately NOT granted, by naming them — an assertion that
  // "s3:GetObject does not appear" would otherwise be satisfied by prose. The
  // same mistake passed once in this repo on a stylesheet header.
  return body.filter((line) => !line.trim().startsWith('#')).join('\n');
}

describe('the deploy cannot delete uploaded images', () => {
  test.each(Object.keys(BUILDSPECS))('%s syncs dist/ into the FRONTEND bucket with --delete', (tier) => {
    const lines = syncLines(BUILDSPECS[tier]);
    expect(lines.length).toBeGreaterThan(0);
    // The premise. If this ever stops being true the rest of the file is
    // reasoning about a hazard that no longer exists, and should be re-read
    // rather than trusted.
    expect(lines.some((l) => l.includes('--delete'))).toBe(true);
    expect(BUILDSPECS[tier]).toMatch(/OutputKey==`FrontendBucketName`/);
  });

  test.each(Object.keys(BUILDSPECS))('%s never points a --delete sync at the media bucket', (tier) => {
    const spec = BUILDSPECS[tier];
    for (const line of syncLines(spec)) {
      if (!line.includes('--delete')) continue;
      // Neither by name nor through the stack output that resolves to it.
      expect(line).not.toMatch(/-media/);
      expect(line).not.toMatch(/MEDIA_BUCKET|MediaBucketName/);
    }
    // And the variable the --delete sync uses is not filled from the media
    // output anywhere earlier in the file.
    const deleteVars = syncLines(spec)
      .filter((l) => l.includes('--delete'))
      .flatMap((l) => [...l.matchAll(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g)].map((m) => m[1]));
    expect(deleteVars.length).toBeGreaterThan(0);
    for (const name of deleteVars) {
      const assignment = new RegExp(`${name}=\\$\\(aws cloudformation[^\\n]*`, 'g');
      for (const [line] of spec.matchAll(assignment)) {
        expect(line).toMatch(/OutputKey==`FrontendBucketName`/);
        expect(line).not.toMatch(/MediaBucketName/);
      }
    }
  });

  test('the media bucket is a different bucket from the website bucket', () => {
    expect(resource('FrontendBucket')).toMatch(/BucketName:\s*!Sub\s*'\$\{StackName\}-web'/);
    expect(resource('MediaBucket')).toMatch(/BucketName:\s*!Sub\s*'\$\{StackName\}-media'/);
  });

  test('the media bucket exists in every stack, not only the ones with a domain', () => {
    // The presign and verification Lambdas need a bucket regardless. A
    // `Condition: HasDomain` here would give them an unresolvable !Ref.
    expect(resource('MediaBucket')).not.toMatch(/Condition:/);
  });

  test('both media lambdas are pointed at the media bucket and nothing else', () => {
    for (const id of ['AdminMediaUploadUrlsFunction', 'AdminMediaStatusFunction']) {
      const body = resource(id);
      expect(body).toMatch(/MEDIA_BUCKET:\s*!Ref MediaBucket/);
      expect(body).not.toMatch(/!Ref FrontendBucket/);
    }
  });
});

describe('an uploaded image is reachable at the same origin as the app', () => {
  /*
   * This is what lets the stored value go straight into <img src> with no
   * resolver. Take the behaviour away and every uploaded image resolves to the
   * website bucket, where the object does not exist.
   */
  test('CloudFront serves sets/* from the media bucket', () => {
    const distribution = resource('CloudFrontDistribution');
    expect(distribution).toMatch(/- Id: MediaOrigin/);
    expect(distribution).toMatch(/DomainName:\s*!GetAtt MediaBucket\.RegionalDomainName/);

    const behaviours = distribution.slice(distribution.indexOf('CacheBehaviors:'));
    expect(distribution).toContain('CacheBehaviors:');
    expect(behaviours).toMatch(/PathPattern:\s*'sets\/\*'/);
    expect(behaviours).toMatch(/TargetOriginId:\s*MediaOrigin/);
  });

  test('the default behaviour still serves the app from the website bucket', () => {
    const distribution = resource('CloudFrontDistribution');
    const dflt = distribution.slice(
      distribution.indexOf('DefaultCacheBehavior:'),
      distribution.indexOf('CacheBehaviors:'),
    );
    expect(dflt).toMatch(/TargetOriginId:\s*S3Origin/);
  });

  test('the prefix the lambda writes is the prefix CloudFront routes', () => {
    // Two files, one string. A rename on either side goes red here rather than
    // silently 404ing every image at the CDN.
    const module = load(SHARED);
    expect(module.mediaPrefix('abc123')).toBe('sets/abc123/');
    expect(module.mediaPrefix('abc123').startsWith('sets/')).toBe(true);
  });
});

/** Evaluate a CommonJS file from outside jest's rootDir. */
function load(source) {
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', source)(module, module.exports, require);
  return module.exports;
}

describe('a bare key resolves against the site root, which is why no resolver is needed', () => {
  /*
   * `sets/<id>/x.jpg` is a RELATIVE url. It resolves against the DIRECTORY of
   * the current document, so it only lands on the site root while every route
   * is a single path segment: `/`, `/play`, `/admin`. The day somebody adds
   * `/play/{code}`, `sets/…` resolves to `/play/sets/…` and every uploaded
   * image on the player screen 404s — with nothing in any other test to say so.
   *
   * PlayerPage.jsx and GameHostPage.jsx put the stored value straight into
   * <img src>, so this is the assumption the whole storage scheme rests on.
   */
  const APP = fs.readFileSync(path.join(__dirname, '..', 'App.jsx'), 'utf8');

  test('every route the app matches is a single path segment', () => {
    const router = APP.slice(APP.indexOf('function AppRouter'));
    const routes = [
      ...router.matchAll(/path\s*(?:===|\.startsWith\()\s*'([^']+)'/g),
    ].map((m) => m[1]);

    expect(routes.length).toBeGreaterThan(3);
    const multiSegment = routes.filter((r) => r.replace(/^\//, '').includes('/'));
    /*
      NAMED EXCEPTIONS, NOT SILENT ONES. Each of these is nested and each is
      safe for the same specific reason: it never renders a question, so no
      `sets/<id>/x.jpg` is ever resolved against its directory.

        /auth/callback   — OAuth handoff, redirects immediately
        /test/wordcloud  — a dev harness
        /invite/         — components/InviteAcceptPage.jsx: one line of text
                           and a button, for somebody who followed an invitation
                           link before they had an account

      Adding to this list is a decision. A nested route that DOES render a
      question breaks every uploaded image on it, and nothing else would say so.
    */
    expect(multiSegment.sort()).toEqual(['/auth/callback', '/invite/', '/test/wordcloud']);
  });

  test('no route that renders a question is multi-segment', () => {
    const router = APP.slice(APP.indexOf('function AppRouter'));
    for (const route of ['/play', '/admin', '/builder', '/remote']) {
      expect(router).toContain(`path.startsWith('${route}')`);
      expect(route.replace(/^\//, '')).not.toContain('/');
    }
  });
});

describe('the presigned write credential is bounded by IAM, not only by the handler', () => {
  test('the presigning role can put objects under sets/ and nowhere else', () => {
    const body = resource('AdminMediaUploadUrlsFunction');
    expect(body).toMatch(/Action:\s*\['s3:PutObject'\]/);
    expect(body).toMatch(/Resource:\s*!Sub\s*'\$\{MediaBucket\.Arn\}\/sets\/\*'/);
    // A presigned URL grants the intersection of the signer's permissions and
    // the signed request. A wildcard here would make the key sanitising in
    // set-media.js the ONLY thing standing between a caller and any object in
    // the bucket.
    expect(body).not.toMatch(/Resource:\s*!Sub\s*'\$\{MediaBucket\.Arn\}\/\*'/);
    expect(body).not.toMatch(/s3:\*/);
  });

  test('the verification role can list, and cannot read objects or write', () => {
    const body = resource('AdminMediaStatusFunction');
    expect(body).toMatch(/Action:\s*\['s3:ListBucket'\]/);
    expect(body).not.toMatch(/s3:GetObject/);
    expect(body).not.toMatch(/s3:PutObject/);
    expect(body).not.toMatch(/s3:DeleteObject/);
  });

  test('neither media lambda gets write access to DynamoDB', () => {
    for (const id of ['AdminMediaUploadUrlsFunction', 'AdminMediaStatusFunction']) {
      const body = resource(id);
      expect(body).toMatch(/DynamoDBReadPolicy:/);
      expect(body).not.toMatch(/DynamoDBCrudPolicy:/);
    }
  });
});
