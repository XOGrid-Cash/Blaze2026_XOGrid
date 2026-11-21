# XOGrid promo video

A 60-second silent promo (1920x1080) recorded in one Playwright take. Captions, title and end cards are overlays
injected by `overlay.js`; nothing in `frontend/` or `server/` changes.

The frontend runs locally with `/api` proxied to the production registry, so the video shows real data read-only.
The recording never connects a wallet and never presses "Claim voucher". The claim code shown was already redeemed
on mainnet (txid `b6c1a0b2…86181`).

```
npm install
npx playwright install chromium
npm run serve          # promo frontend on http://localhost:5190 (or the "promo" entry in .claude/launch.json)
npm run record         # out/xogrid-promo.webm, silent (about 70 s)
npm run music          # out/music.wav, the original soundtrack (synthesized, no samples or licences)
npm run mux            # out/xogrid-promo.mp4 = video + music (H.264/AAC, needs Microsoft Edge and VLC)
node frames.mjs out/xogrid-promo.webm 1     # contact sheets in shots/ for checking a take
node playcheck.mjs out/xogrid-promo.mp4 0.5,5,50   # frames grabbed while the MP4 plays in Edge
node audiocheck.mjs    # waveform and spectrogram of the music in shots/audio.png
```

The music is 120 BPM so the scene cuts (5, 14, 21, 28, 37, 42, 55 s) land on beats; its drop is at 50 s, where the
recorded take fades in the mainnet transaction. If a new take moves that moment, move `impact(50` and the
`build`/`drop` boundary in `music.mjs`.

`mux.mjs` plays the WebM in Edge and records it with the music through MediaRecorder, because VLC drops the first
seconds when it decodes Playwright's WebM. VLC is then used only to copy the streams into an indexed MP4.
