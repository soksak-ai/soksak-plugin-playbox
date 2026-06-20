# Playbox

A video library and player plugin for [soksak](https://github.com/soksak-ai).

Keep favorites and time-range clips in one filterable list, and play them in a
clean in-app player.

## What it plays

- **YouTube** — resolved with `yt-dlp` and played as a real `<video>` (so clips
  and download work). YouTube needs a dedicated extractor (signed/throttled
  streams); a webview cannot intercept a usable URL, so `yt-dlp` handles it.
- **Local files** — drag-drop or open a file.
- **Direct media URLs** — `.mp4`, `.m3u8`, etc.
- **Arbitrary web pages** — the page is loaded in a WebKit webview (which passes
  Cloudflare/SNI blocks that `yt-dlp` cannot), and the stream is taken either from
  the media the page requests or from an embedded iframe player's URL — no
  site-specific code. `yt-dlp` is tried first for pages it supports.

Referer/CORS-protected HLS is streamed through soksak's core media proxy, which
injects the required headers and serves binary segments the webview cannot fetch
cross-origin.

## Features

- **Library** — one filterable list of favorites and clips (right sidebar).
- **Player** — `<video>` + hls.js, opened as a content tab (use soksak's split to
  run several at once).
- **Clips** — mark a start/end with `[` / `]` while playing; the range is saved to
  the library as a bookmark.
- **Download** — save the full video or a marked clip to a local `.mp4`. The
  resolved stream is fetched through the core media proxy and muxed by `ffmpeg`
  (`-c copy`) — `yt-dlp` is not involved in downloading. Works for YouTube and any
  proxy-routed stream. iframe-only embeds (when `yt-dlp` cannot resolve YouTube)
  have no stream to save. Set the folder in Settings.

## Settings

- **Domain mapping** — a key→value table (original host → reachable mirror host).
  Used to rewrite the host of an input URL before resolving. Empty by default.
- **Extract mode** — `hidden` (offscreen, default) or `tab` (a visible browser tab
  you can interact with when a page needs a manual play click).
- **Extract wait (ms)** — how long to wait for a media stream when extracting.
- **Download folder** — absolute folder where downloads are saved.

## Dependencies

- **yt-dlp** — required for YouTube and page resolution (not for download). Not
  bundled (it changes often); install it on your system or run `playbox.setup`.
- **ffmpeg** — required for download (full or clip mux). Not needed for playback.

Run `playbox.doctor` to check what is installed.

## Commands

Every feature is exposed as a command (`sok plugin.soksak-playbox.<name>` / MCP):
`favorite.add`, `favorite.remove`, `library.list`, `library.filter`, `resolve`,
`play`, `clip.add`, `clip.list`, `download`, `doctor`, `setup`, `ping`.

## Development

```
make build      # or: node build.mjs   — esbuild → single ESM main.js
make verify     # tsc --noEmit && vitest run && build
make e2e        # live socket E2E against a running dev app
```

The repo folder doubles as the dev plugin folder under `~/.soksak/plugins/`.
Reload in soksak with `plugin.reload`.
