# Demo walkthroughs

The home page contains four narrated, captioned demonstrations. All use fictional teams and real screens from the development site.

| Video | Length | Home-page anchor | Standalone player |
| --- | --- | --- | --- |
| 80s trivia | 2:40 | `/home#walkthrough` | `/assets/marketing/embed.html` |
| Call & Answer: Project Beacon | 2:45 | `/home#call-answer-walkthrough` | `/assets/marketing/call-answer.html` |
| School of Hard Books | 2:20 | `/home#hard-books-walkthrough` | `/assets/marketing/hard-books.html` |
| Quarterly meeting survey | 2:20 | `/home#quarterly-survey-walkthrough` | `/assets/marketing/quarterly-survey.html` |

Each video has an MP4, poster, English WebVTT file and HTML transcript in `src/public/assets/marketing`. The MP4 contains visible captions. The separate caption track supports accessible playback. Players use native controls, inline playback and no autoplay; the home page defers video loading until needed.

Embed a player on another page:

```html
<iframe
  src="https://engage.dev.seibtribe.us/assets/marketing/call-answer.html"
  title="Call and Answer walkthrough"
  style="width:100%;aspect-ratio:16/9;border:0"
  allow="fullscreen"
  allowfullscreen>
</iframe>
```

Use `embed.html` for the trivia walkthrough. Change the domain when these assets are promoted to another environment.

The editable projects are retained locally in `videos/engage-trivia` and `videos/engage-call-answer`, including narration, captions, scene compositions, scripts and source captures. Raw captures and session report sharing details are not published. The Beacon video masks the saved report’s sharing fields.

Project Beacon uses five teammates (manager, product lead, two engineers and architect) and three custom questions about customers, a first experiment and working agreements. All five answered and voted. Two follow-up comments demonstrate feedback. The report was saved for one year and downloaded during capture.

The Hard Books demo uses architecture, culinary and design lessons, with five answers and five votes in each round, a follow-up comment and a three-round report. The survey demo shows five question types, five completed responses, result charts and written feedback. Both reports were saved for one year and downloaded. Their editable projects are `videos/engage-hard-books` and `videos/engage-quarterly-survey`.

The event-agenda film is in preparation; it is not published until the welcome presentation capture is complete.
