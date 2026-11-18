# Video lecture test fixtures

Tiny mp4 files with `mov_text` (tx3g) subtitle tracks, used by the lecture-video
stream tests and the transcript extractor tests.

**Never copy anything from `E:\Videos` into this directory.** Every file here is
generated from the two SRT files with the commands below.

## Inputs

- `eng.srt`: 4 cues over 6 s. Gap between cue 2 (ends 2.5 s) and cue 3 (starts 3.5 s).
  Cue 2 is non-ASCII UTF-8 (`Già fatto — café ✓`); cue 3 has two lines.
- `ita.srt`: 2 cues (0–2 s, 2–5 s).

## Commands (ffmpeg 9.0.2 gyan.dev full build, libx264, run in this directory)

```bash
COMMON="-f lavfi -i color=c=black:s=64x64:r=5:d=6 -f lavfi -i anullsrc=r=8000:cl=mono"
ENC="-t 6 -c:v libx264 -preset ultrafast -crf 51 -pix_fmt yuv420p -c:a aac -b:a 8k -c:s mov_text"

ffmpeg -y $COMMON -i eng.srt -i ita.srt -map 0:v -map 1:a -map 2:s -map 3:s $ENC \
  -metadata:s:s:0 language=eng -metadata:s:s:1 language=ita -disposition:s:0 default -disposition:s:1 0 \
  -movflags +faststart tx3g-eng-ita-faststart.mp4

ffmpeg -y $COMMON -i eng.srt -i ita.srt -map 0:v -map 1:a -map 2:s -map 3:s $ENC \
  -metadata:s:s:0 language=eng -metadata:s:s:1 language=ita -disposition:s:0 default -disposition:s:1 0 \
  tx3g-eng-ita-moov-at-end.mp4

ffmpeg -y $COMMON -i ita.srt -map 0:v -map 1:a -map 2:s $ENC \
  -metadata:s:s:0 language=ita -disposition:s:0 default \
  -movflags +faststart tx3g-ita-only.mp4

# the faststart file with the page link in its comment tag (what yt-dlp --embed-metadata writes)
ffmpeg -y -i tx3g-eng-ita-faststart.mp4 -map 0 -c copy -metadata comment=https://www.youtube.com/watch?v=abcdefghijk \n  -movflags +faststart tx3g-eng-ita-faststart-link.mp4
```

## Expected layouts (top-level boxes)

| File | Boxes | Tracks |
|---|---|---|
| `tx3g-eng-ita-faststart.mp4` | `ftyp,moov,free,mdat` | h264, aac, mov_text `eng` (default), mov_text `ita` |
| `tx3g-eng-ita-moov-at-end.mp4` | `ftyp,free,mdat,moov` | same as above; the transcript route must answer 422 `transcript-unsupported` |
| `tx3g-ita-only.mp4` | `ftyp,moov,free,mdat` | h264, aac, mov_text `ita` only |
| `tx3g-eng-ita-faststart-link.mp4` | `ftyp,moov,free,mdat` | as `tx3g-eng-ita-faststart.mp4`, plus `moov/udta/meta/ilst/©cmt` = `https://www.youtube.com/watch?v=abcdefghijk` |

## Actual subtitle samples

`eng` track: **5 samples**. ffmpeg writes an empty sample (2 bytes: a zero text
length) for the gap, so tests must skip it rather than emit a cue.

| # | Start (s) | Duration (s) | Size (bytes) | Text |
|---|---|---|---|---|
| 1 | 0.000 | 1.200 | 24 | `Welcome to the lesson.` |
| 2 | 1.200 | 1.300 | 26 | `Già fatto — café ✓` |
| 3 | 2.500 | 1.000 | 2 | (empty gap sample) |
| 4 | 3.500 | 1.300 | 50 | `First line of cue three\nSecond line of cue three` |
| 5 | 4.800 | 1.200 | 20 | `End of the sample.` |

`ita` track (both files): **2 samples**, 0.000 + 2.000 s (25 bytes) and
2.000 + 3.000 s (31 bytes).
