# LL Music Reactions

A web app for creating Love Live music reaction meme videos. Match songs from the Love Live discography with reaction video clips, arrange them on a timeline, and export a stitched MP4 with album art overlays.

## Features

- **Song Search** — Fuzzy search across 871 songs with romaji/hiragana/English support
- **Series Filters** — Filter by franchise (μ's, Aqours, Nijigaku, Liella, etc.), artist, or year
- **Clip Library** — Pre-bundled reaction clips searchable by name and emotion tags
- **Drag-and-Drop Timeline** — Arrange clip+song pairs in sequence
- **Setlist Loader** — Load concert setlists (720 performances) as templates
- **Video Preview** — Play through your sequence with album art corner overlay
- **FFmpeg.wasm Export** — Client-side video stitching, no backend required. Discord-optimized (<25MB MP4)

## Tech Stack

- React 19 + TypeScript
- Vite 6
- Tailwind CSS 4
- @dnd-kit (drag-and-drop)
- @ffmpeg/ffmpeg (client-side video encoding)
- wanakana (Japanese text conversion)

## Getting Started

```bash
bun install
bun dev
```

Add reaction clips to `public/clips/` and thumbnails to `public/thumbnails/`, matching filenames in `src/data/clips-manifest.json`.

## Data

Song discography data is sourced from [hamproductions/the-sorter](https://github.com/hamproductions/the-sorter).

## Contributing

This project uses [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for commit messages.

Format: `<type>[optional scope]: <description>`

Examples:
```
feat: add year filter to song picker
fix: prevent timeline reorder crash on single entry
docs: update README with export instructions
refactor: extract album art resolver into utility
```

Common types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `build`.
