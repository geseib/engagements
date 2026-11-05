# Four trivia sets, November 2026

Installed into the platform "Engage" library (`SETS` partition) with
`scripts/install-question-set.js` (the app's own `admin/upload-questions.js`), each
60 questions in 6 categories, 0 skipped rows, read back against the CSV with 0
mismatches. Settings: active, topic from `manifest.json`, no persona (default trivia
prompt), no quickstart, no tags.

| id | title | topic | dev | test | prod |
|---|---|---|---|---|---|
| `aroundtheworldgeographyadventure` | Around the World: Geography Adventure | geography-travel | 5 Nov 2026 | | |
| `spacecosmiccuriosities` | Space: Cosmic Curiosities | science-technology | 5 Nov 2026 | | |
| `techtoystomorrow` | Tech, Toys & Tomorrow | science-technology | 5 Nov 2026 | | |
| `musicpopcultureencore` | Music & Pop Culture: Encore! | music | 5 Nov 2026 | | |

The JSON files keep each question's sources; the two `*-qa.md` files are the
independent content reviews. README.txt is the packager's original note ("dev only");
the owner asked on 5 Nov for test and prod as well.
