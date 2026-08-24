/**
 * Read every HttpApi route out of template-clean.yaml, with its Auth block.
 *
 * Shared by the route-authorization suites, which all assert the same contract
 * from two sides: a route is only closed when the TEMPLATE attaches
 * `CognitoAuthorizer` *and* `authorizer.js`'s `requiredGroupsForRoute` names it.
 * Either half alone is a false fix — see tests/games-list-authorization.js for
 * the incident that established this.
 *
 * PARSED AS TEXT, NOT YAML, and deliberately. The template is full of
 * CloudFormation short tags (`!Ref`, `!Sub`, `!If`, `!GetAtt`) that no stock
 * YAML loader in this repo's dependency set accepts, and adding a parser
 * dependency so that a test can run is a worse trade than a scanner whose shape
 * is itself asserted. Every consumer must call `assertScannerWorks()` — a
 * scanner that silently matches nothing passes every downstream assertion.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const TEMPLATE = path.join(__dirname, '..', '..', 'template-clean.yaml');

/** @returns {{path:string, method:string|null, authorizer:string|null}[]} */
function routesFromTemplate(templatePath = TEMPLATE) {
  const lines = fs.readFileSync(templatePath, 'utf8').split('\n');
  const routes = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*Path:\s*(\/\S*)\s*$/.exec(lines[i]);
    if (!m) continue;
    const routePath = m[1];
    let method = null;
    let authorizer = null;
    // Everything belonging to this route sits between its `Path:` and the next
    // `Path:`, or the end of the resource block it lives in.
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*Path:\s*\//.test(lines[j])) break;
      if (/^\s{0,8}\w[\w]*:\s*$/.test(lines[j]) && !/^\s{10,}/.test(lines[j])) break;
      const mm = /^\s*Method:\s*(\S+)\s*$/.exec(lines[j]);
      if (mm && !method) method = mm[1].toUpperCase();
      const ma = /^\s*Authorizer:\s*(\S+)\s*$/.exec(lines[j]);
      if (ma && !authorizer) authorizer = ma[1];
    }
    routes.push({ path: routePath, method, authorizer });
  }
  return routes;
}

/** The one route matching this method+path, or undefined. */
function findRoute(routes, method, routePath) {
  return routes.find((r) => r.path === routePath && r.method === method.toUpperCase());
}

/**
 * Prove the scanner is doing anything at all.
 *
 * Three separate checks, because each failure mode passes the other two: a
 * regex that matches nothing, one that never detects `Auth`, and one that
 * reports every route as authorized.
 */
function assertScannerWorks(routes) {
  assert.ok(routes.length > 40,
    `the template scanner found only ${routes.length} routes — its regex has rotted`);
  assert.ok(routes.some((r) => r.authorizer === 'CognitoAuthorizer'),
    'no authorized route was detected — the Auth regex is broken, so every '
    + '"is closed" assertion downstream would fail open');
  assert.ok(routes.some((r) => !r.authorizer),
    'every route looked authorized — the scanner is matching indiscriminately, so '
    + 'every "is still public" assertion downstream is meaningless');
}

module.exports = { routesFromTemplate, findRoute, assertScannerWorks, TEMPLATE };
