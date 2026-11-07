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
