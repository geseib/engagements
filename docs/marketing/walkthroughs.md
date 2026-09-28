# Demo walkthroughs

The home page contains two narrated, captioned demonstrations. Both use fictional teams and real screens from the development site.

| Video | Length | Home-page anchor | Standalone player |
| --- | --- | --- | --- |
| 80s trivia | 2:40 | `/home#walkthrough` | `/assets/marketing/embed.html` |
| Call & Answer: Project Beacon | 2:45 | `/home#call-answer-walkthrough` | `/assets/marketing/call-answer.html` |

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
