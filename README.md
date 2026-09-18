# Slots

A workout tracker built around **slots**, not fixed exercises.

A workout is an ordered list of slots — *Upper chest*, *Lats*, *Side delts*. Each slot
holds a pool of interchangeable exercises. At the gym you tap a slot and pick whichever
option is actually free.

**History is tracked per exercise, not per slot.** Lat pulldown today and dumbbell rows
next week each keep their own timeline, so you always see the exact number to beat. The
same exercise used in two different slots shares one record.

Offline-first, local-only, no accounts, no network calls after first load.

**It starts completely empty.** There's no built-in program — you create your workouts
and name your own slots. The exercise library builds itself as you train: tap a slot, type
a name, and it's created and saved into that slot for next time.

---

## Install it on your iPhone

The app is live at:

> **https://ryanmeroniuk.github.io/workout/**

1. Open that URL **in Safari**. (Chrome and Firefox on iOS can't install PWAs — it has
   to be Safari.)
2. Tap the **Share** button — the square with the arrow, in the bottom toolbar.
3. Scroll down the share sheet and tap **Add to Home Screen**.
4. The name will prefill as **Slots**. Tap **Add** (top right).
5. Close Safari. Launch **Slots** from your home screen.

It now runs full-screen with no browser chrome, works with no signal, and your laptop
can be off. Open it once on Wi-Fi so the service worker caches the app; after that it
loads instantly from local storage.

### Checking it actually works offline

Put the phone in Airplane Mode and open Slots from the home screen. It should load and
let you log a full workout. Everything is written to IndexedDB on the device.

### Back it up

There's no server, so **the only copy of your data is on your phone.** Clearing Safari's
website data or deleting the app will erase it.

Settings → **Export all data (JSON)** saves a backup file. Do this every few weeks and
before any iOS cleanup. Settings → **Import from backup** restores it.

---

## Deploying

One command:

```bash
npm run deploy      # → git push origin main
```

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and publishes to
GitHub Pages. You can also redeploy without a commit from the repo's **Actions** tab →
*Deploy to GitHub Pages* → **Run workflow**.

### One-time repo setup

GitHub Pages needs to be told to accept deploys from Actions:

1. Repo → **Settings** → **Pages**
2. **Source**: select **GitHub Actions** (not "Deploy from a branch")

That's it. The first push to `main` publishes the site.

> **Note on the URL.** The site is served from the `/workout/` subpath, matching the repo
> name. That's set by `base` in `vite.config.ts`. If you rename the repo, change it there
> too. The app uses hash-based routing (`#/session/…`), so the subpath never causes 404s
> on reload or deep links.

### Why GitHub Pages rather than Vercel

- The repo already exists, so deploying is just `git push` — no extra account or CLI auth.
- The app is 100% static with no backend; Vercel's serverless and edge features would be
  unused weight.
- The usual Pages downside — a subpath breaking SPA routing — doesn't apply here because
  of hash routing.

Vercel would be the better pick if you later want a **custom domain** or **push
notifications**, both of which prefer a root-scope origin. Switching is a one-line change
to `base`.

---

## Development

```bash
npm install
npm run dev        # http://localhost:5173/workout/
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build at :4173
npm run icons      # regenerate PWA icons into public/
npm run verify     # end-to-end tests (needs `npm run preview` running)
```

### Running the tests

```bash
npm run build
npm run preview &
npm run verify
```

`npm run verify` drives a real Chromium at an iPhone viewport and checks 64 things,
including the ones that are impossible to eyeball:

- a virgin install writing **zero** rows — asserted against raw IndexedDB
- the one-time seed cleanup, including the index-drift case (an exercise referenced only
  via `entries[]` must survive) and that it never runs twice
- authoring a workout, slots and exercises entirely through the UI
- creating an exercise mid-session, and the case-insensitive duplicate guard
- data surviving a hard reload, asserted against the **raw IndexedDB rows**, not just the UI
- the `by-exercise` multiEntry index resolving
- history following an exercise across two different slots
- reordering slots and workouts, adding a slot, creating an exercise into a pool
- the app booting, logging a set **and creating an exercise with the network offline**
- export → wipe → import round-trip, plus importing a legacy v1 backup

---

## How it works

### Data model

```
Workout ──has many──> Slot ──references──> Exercise  (global catalogue)
                                               ▲
Session ──has many──> LoggedExercise ──────────┘
                            └── SetEntry { weight, reps, done }
```

- **Exercises are global.** Slots hold `exerciseId[]`, so the same exercise in two pools
  is one record with one shared history. Creating one goes through a case-insensitive
  name check — otherwise typing "Lat pulldown" twice would silently fork that history
  into two identical-looking records.
- **Slots are embedded in `Workout`.** A slot belongs to exactly one workout and is never
  queried on its own, so reordering is a single atomic `put()`.
- **Sessions snapshot `workoutName` and `slotName`.** Renaming or deleting a workout later
  never corrupts old history.
- **`Session.exerciseIds` is denormalized** to back an IndexedDB `multiEntry` index.
  Without it, "when did I last do lat pulldown?" would scan every session ever logged.

### Performance

The entire database is loaded into memory once at boot — a year of training is well under
1 MB. Every screen reads synchronously from memory, so **no screen ever shows a spinner
for local data.** Writes update memory and repaint immediately, then persist in the
background through a serialized queue.

The one exception is **Finish workout**, which waits for the write to commit before
navigating. Mid-set a dropped write is harmless; losing the set that ends a workout is not.

### Dependencies

Runtime: `react`, `react-dom`, `idb`. That's all.

The router (~40 lines) and the chart (~120 lines of SVG) are hand-rolled — a line chart is
a `<polyline>` and some axis math, which isn't worth 50 kB of charting library. Icons are
generated by rasterizing flat geometry and writing the PNG with Node's built-in `zlib`,
which avoids `sharp` and the libvips/libheif CVEs it carries.

Production bundle: **~86 kB gzipped**.

---

## Conventions

- Weight is **pounds**. Decimals allowed; the ± buttons step by **2.5 lb**.
- An exercise is **just a name** — no equipment/category to fill in. Whatever convention
  you use for dumbbells (per hand vs. total) is yours to keep consistent; the app only
  ever compares an exercise against itself.
- Working sets only; warm-ups aren't tracked.
- One workout can be in progress at a time. It survives closing the app and resumes from Home.
- No rest timer, no RPE, no notes, no streaks.
