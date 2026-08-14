# [jeremehancock.com](https://jeremehancock.com)


[Personal Website & Résumé](https://jeremehancock.com)

## Editing content

All site content lives in [`data/data.json`](data/data.json) — basics, sites,
projects, skills, and résumé. `index.html` renders it on load, so most changes
need nothing but a JSON edit.

## Résumé PDF

The **View résumé** buttons point at `jereme-hancock-resume.pdf`, a committed
file. It is generated from [`resume.html`](resume.html), a print-first view that
reads the same `data/data.json` as the site, so the two cannot drift apart.

Regenerate it after editing the `skills` or `resume` sections of
`data/data.json`:

```bash
./scripts/build-resume-pdf.sh
```

Then commit the updated PDF alongside your JSON change.

The script serves the site on a local port, prints `resume.html` to PDF with
headless Chromium, and cleans up after itself. It needs `python3` and either
`chromium`, `chromium-browser`, `google-chrome-stable`, or `google-chrome` on
`PATH`. Override the port with `PORT=9000 ./scripts/build-resume-pdf.sh` if
8765 is busy.

To preview the résumé layout without generating a PDF, serve the site and open
`/resume.html`. It fetches `data/data.json`, so opening the file directly over
`file://` will fail — use a local server:

```bash
python3 -m http.server 8000
```

The button label and filename come from `basics.resumePdf` in `data/data.json`.

## License

[MIT License](LICENSE)

## AI Disclosure

This project was created with the help of AI.
