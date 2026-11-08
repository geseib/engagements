# Two trivia sets, November 2026 (80s Movies, Greatest Books)

Installed into the platform "Engage" library (`SETS` partition) on **dev only**
(table `engagedev`) with `scripts/install-question-set.js` (the app's own
`admin/upload-questions.js`), after a dry run of each. Each set is 60 questions in
6 categories, 0 skipped rows, read back from the table against the CSV (options,
correct answer, difficulty, answer details, active flag) with 0 mismatches.
Settings: active, topic from `manifest.json`, no persona (default trivia prompt
`AIPROMPT#msnyftpytpylfb3i9c9`), no quickstart, tags as below, no ttl on the row.

| id | title | topic | tags | dev | test | prod |
|---|---|---|---|---|---|---|
| `80smoviesbekindrewind` | 80s Movies: Be Kind, Rewind | film-tv | 1980s, movies, hollywood, retro | 7 Nov 2026 | not installed | not installed |
| `greatestbookspageturners` | Greatest Books: Page Turners | language-literature | books, literature, classics, world-literature | 7 Nov 2026 | not installed | not installed |

**Version 2, same day.** The independent review's 8 minor fixes (see
`movies-books-qa.md`) were installed as a new version of each set with
`scripts/replace-question-set.js engagedev <setId> --csv <file> --note "..."`.
That script calls the app's own upload with `replaceSetId`. `install-question-set.js`
refuses an id that already exists, so it cannot create a duplicate. Dry run
first; then `--apply`. Both sets are now on `activeVersion` 2 (`SET#<id>#v2`).
v1 is kept and can be made live again from the set's Versions. Each set still
has one SETS row, with name, description, topic, tags and active unchanged. The
read-back of v2 against the CSV: 60/60 questions, 6 categories, 0 skipped, 0
mismatches. The importer printed "CHECK_FUNCTION_NAME is not set, so the content
check … was not started". That is expected when running it from a script; no
content check ran.

Categories:
- 80s Movies: Blockbuster Moments; Quote, Unquote; Stars & Roles; Behind the Camera;
  Oscar Night & Box Office; Soundtracks & Theme Songs.
- Greatest Books: Famous First Lines; Who Wrote It?; Unforgettable Characters;
  Where in the World?; Classics Around the Globe; Behind the Books.

The JSON files keep each question's sources; `movies-books-qa.md` is the content
review (a second-pass self-review, not an independent one, and with no source URL
fetched; see its first section). Test and prod: the earlier four sets reached them
through the app's Archive (export on dev, import on each tier); that has not been
done for these two.

Command used (per set):

```bash
node scripts/install-question-set.js engagedev sets/trivia-2026-11b/<file>.csv --type trivia \
  --title "<title>" --topic <topic> --description "<description>" --tags <tags> [--apply]
```
