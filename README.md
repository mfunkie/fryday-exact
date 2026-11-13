# Fryday (Exact)

Fryday, the Rune reference app ([mfunkie/fryday](https://github.com/mfunkie/fryday)), rebuilt in
[Exact](https://github.com/expo/exact): log Fry's twice-daily insulin and morning amlodipine,
with a double-dose guard, a countdown orb and a streak. The point is the comparison: the same
domain, the same six scenes and the same rules, so the two frameworks can be judged side by side.

## Layout

```
core/              the domain, ported from fryday-core: plain TypeScript, no clock, no I/O
  civil.ts …       schedule, log, statuses, the guard, streaks, JSON (the Rune app's format)
  board.ts         the view model: every word on screen, as one pure function
  scenes.ts        the Rune app's six scenes, built through logDose
  tests/           bun test: domain + property tests, the board per scene, a purity guard
app.contract       the view: places and paints the board (Contract)
app.tamber         the brand: Fry's oranges on a plum night, as tokens
app.ts             the data module: the log in a JSON file, the board for an instant
app.test.contract  interaction tests and properties, by testId, on any host
```

## Rules

- **The domain takes `now` as an argument.** Exact enforces it too: the data module can't read
  the clock or randomness. The view passes `exactTime()` plus `performanceNow()`.
- **Every word on screen comes from `core/board.ts`.** The view only places and paints, so the
  orb's and cards' words are unit tests, not screenshots.
- **Scenes build through `logDose`**, so a scene can't show a state the app couldn't reach.
  `/?scene=<name>` opens one on its own storage file, never the real log.
- **Never compute or suggest a dose amount.** The guard warns and asks; it never decides.
- **Colours are `app.tamber` tokens.** A gradient is written out literally, so Exact checks it at
  build; a gradient built by a function is dropped at run time on the web.

## Commands

```sh
bun test core                    # domain, board, purity guard (~0.1 s)
bun exact.mjs test web           # interaction tests in Chrome (~12 s)
bun exact.mjs verify             # tests + every end screen at 2 widths, light/dark, relaunch,
                                 # largest text size, contrast, and the properties (~75 s)
bun exact.mjs agent web --storage s1 --url "/?scene=guard" "clock data" \
  "tap give-insulin-pm-2026-11-06" "clock data" "screenshot .exact/guard.png"
bun exact.mjs linux && bun exact.mjs test linux   # the headless Linux host
bun exact.mjs web                # the dev loop
```

Scenes: `morning`, `afternoon`, `guard` (tap the evening Give to trip it), `late`, `done`, `midnight`.
