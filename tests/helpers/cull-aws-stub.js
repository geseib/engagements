/**
 * Preload stub for scripts/cull-ai-prompts.js, used by tests/cull-ai-prompts.js.
 *
 *   node -r tests/helpers/cull-aws-stub.js scripts/cull-ai-prompts.js <table> …
 *
 * The script under test is a self-executing IIFE that reads process.argv, so it
 * is driven as a real child process rather than required — that also means the
 * assertions are made against the output an operator would actually see.
 *
 * The fixture comes in through CULL_FIXTURE as JSON: `{ AIPROMPTS: [...],
 * SETS: [...] }`. Every write the script attempts is echoed to stdout as a
 * `WROTE <verb> <key>` line, so a test can assert that a dry run wrote nothing
 * without needing a second channel.
 */
const Module = require('module');

const fixture = JSON.parse(process.env.CULL_FIXTURE || '{"AIPROMPTS":[],"SETS":[]}');

const kinded = (kind) => class {
  constructor(input) { this.input = input; this.__kind = kind; }
};

const send = async (command) => {
  const input = command.input || {};
  switch (command.__kind) {
    case 'query': {
      const pk = (input.ExpressionAttributeValues || {})[':pk'];
      return { Items: (fixture[pk] || []).map((i) => ({ ...i })) };
    }
    case 'update':
      process.stdout.write(`WROTE update ${input.Key.PK}|${input.Key.SK}\n`);
      return {};
    case 'batch': {
      for (const req of input.RequestItems[Object.keys(input.RequestItems)[0]]) {
        const key = req.DeleteRequest.Key;
        process.stdout.write(`WROTE delete ${key.PK}|${key.SK}\n`);
      }
      return {};
    }
    default:
      return {};
  }
};

const STUBS = {
  '@aws-sdk/client-dynamodb': { DynamoDBClient: class {} },
  '@aws-sdk/lib-dynamodb': {
    DynamoDBDocumentClient: { from: () => ({ send }) },
    QueryCommand: kinded('query'),
    UpdateCommand: kinded('update'),
    BatchWriteCommand: kinded('batch'),
  },
};

const realResolve = Module._resolveFilename;
Module._resolveFilename = function patched(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return request;
  return realResolve.call(this, request, ...rest);
};
const realLoad = Module._load;
Module._load = function patchedLoad(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return realLoad.call(this, request, ...rest);
};
