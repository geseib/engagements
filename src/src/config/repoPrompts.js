/**
 * The repo's prompt files, as of this build — src/src/config/repoPrompts.json,
 * written by scripts/build-repo-prompts.js (run in `prebuild`, and committed).
 *
 * LOADED ON DEMAND. The file carries the full text of every repo prompt
 * (~200 KB), and only the admin Prompts screen reads it, so `import()` puts it
 * in a chunk of its own rather than in every player's first download.
 *
 * Resolves to `{ prompts: [...] }`; never rejects — a chunk that fails to load
 * resolves to `{ prompts: [], error }`, and the library then says nothing about
 * the repo rather than calling every prompt "Not in the repo".
 */
let cached = null;

export function loadRepoPrompts() {
  if (!cached) {
    cached = import(/* webpackChunkName: "repo-prompts" */ './repoPrompts.json')
      .then((mod) => {
        const data = (mod && mod.default) || mod || {};
        return { prompts: Array.isArray(data.prompts) ? data.prompts : [] };
      })
      .catch((error) => {
        cached = null;
        return { prompts: [], error: error && error.message ? error.message : String(error) };
      });
  }
  return cached;
}
