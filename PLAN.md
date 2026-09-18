# Slots — Plan

A slot-based workout tracker PWA. Offline, local-only, installable on iPhone.

---

## 1. Core model

The whole app hinges on one idea: **a slot is a muscle target with a pool of
interchangeable exercises, but history lives on the exercise.**

```
Workout "Upper"
  └─ Slot "Lats"  ──pool──>  [Lat pulldown, Cable pulldown, Dumbbell row, Pull-ups]
                                     │
                                     └─ each exercise owns its own history
```

So `Exercise` is a **global** entity in its own store. Slots hold `exerciseId[]`
references. Two slots pointing at "Dumbbell RDL" share one record and one history.
This falls out for free from the reference model — no syncing needed.

---

## 2. Data types

```ts
type ID = string // crypto.randomUUID()

// ---------- Global exercise catalogue ----------
interface Exercise {
  id: ID
  name: string                  // "Incline dumbbell press" — just a name
  createdAt: number
}

// ---------- Workout structure ----------
interface Slot {
  id: ID
  name: string                  // "Upper chest"
  exerciseIds: ID[]             // the pool, ordered; [0] is the default pick
}

interface Workout {
  id: ID
  name: string                  // "Upper"
  slots: Slot[]                 // ordered — embedded, not a separate store
  order: number                 // position on Home
  createdAt: number
}
```

> **Why slots are embedded in Workout instead of their own store:** a slot belongs to
> exactly one workout and is never queried independently. Embedding makes
> reorder/add/remove a single atomic `put()` instead of a multi-record transaction.
> Exercises are *not* embedded, because sharing across slots is the whole point.

```ts
// ---------- Logging ----------
interface SetEntry {
  id: ID
  weight: number                // lb, decimals allowed (2.5 increments)
  reps: number
  done: boolean                 // one-tap checkmark
}

interface LoggedExercise {
  exerciseId: ID
  slotId: ID
  slotName: string              // snapshot — survives a later slot rename/delete
  sets: SetEntry[]
}

interface Session {
  id: ID
  workoutId: ID
  workoutName: string           // snapshot — survives a later workout rename/delete
  startedAt: number             // epoch ms
  finishedAt: number | null     // null = still in progress
  entries: LoggedExercise[]
  skippedSlotIds: ID[]
  exerciseIds: ID[]             // DENORMALIZED — see indexing note below
}
```

**Snapshot fields (`workoutName`, `slotName`)** exist so old sessions still render
correctly after you rename or delete a workout/slot. History should never show
"(deleted)".

**`exerciseIds` is denormalized** purely to enable an IndexedDB `multiEntry` index.
Without it, "last time I did lat pulldown" means scanning every session. With it:
`sessions.index('by-exercise').getAll(exerciseId)` → direct hit. It is rebuilt on
every session write, so it can't drift.

---

## 3. Storage

**IndexedDB via `idb`** (~1.1 kB, promise wrapper over the raw API). DB name `slots`, version 1.

| Store       | keyPath | Indexes                                            |
|-------------|---------|----------------------------------------------------|
| `exercises` | `id`    | `by-name`                                          |
| `workouts`  | `id`    | `by-order`                                         |
| `sessions`  | `id`    | `by-startedAt`, `by-exercise` (multiEntry on `exerciseIds`) |
| `meta`      | `key`   | — one-time migration flags (e.g. the seed cleanup) |

### Read strategy — no spinners, ever
On boot, load **all** data into an in-memory store in one transaction. A year of
hard training is roughly 150 sessions ≈ well under 1 MB — trivially cacheable.
Every render reads from memory synchronously; writes go to memory first, then
write-through to IndexedDB in the background. The UI never awaits the disk.

State lives in a ~60-line store module using `useSyncExternalStore` (React built-in).
No Redux, no Zustand.

---

## 4. Derived values

```ts
// Epley estimated 1RM, per the spec
e1RM = weight * (1 + reps / 30)

sessionE1RM     = max(e1RM) across that session's sets   // best set
sessionTopWeight= max(weight) across that session's sets
sessionVolume   = Σ (weight * reps)
```

Graph toggles between these three series. `weight` is used as-logged, so a dumbbell
exercise graphs per-hand weight consistently against itself. Comparing a dumbbell
exercise to a barbell one is meaningless anyway — and the app never does, because
graphs are always scoped to a single exercise.

**Weight prefill order** when you open an exercise to log a set:
1. The weight of the previous set *in this session* (most common: straight sets)
2. Else the top set of the last session of this exercise
3. Else blank

---

## 5. Folder structure

```
workout/
├─ PLAN.md
├─ README.md                  # deploy command + iPhone install steps
├─ index.html                 # iOS meta tags live here
├─ vite.config.ts             # base path + vite-plugin-pwa
├─ package.json
├─ tsconfig.json
├─ .github/workflows/deploy.yml
├─ public/
│  ├─ manifest.webmanifest
│  ├─ icon-192.png  icon-512.png  icon-maskable-512.png
│  └─ apple-touch-icon.png
└─ src/
   ├─ main.tsx
   ├─ App.tsx                 # shell: router outlet + bottom tab bar
   ├─ router.ts               # ~40-line hash router
   ├─ db/
   │  ├─ types.ts             # the interfaces above
   │  ├─ db.ts                # openDB + schema/migrations
   │  ├─ repo.ts              # CRUD + export/import
   │  └─ migrations.ts        # one-time seed cleanup, flagged in `meta`
   ├─ store/
   │  ├─ store.ts             # in-memory state, useSyncExternalStore
   │  └─ selectors.ts         # lastSessionFor(), historySeries(), e1RM
   ├─ screens/
   │  ├─ Home.tsx
   │  ├─ ActiveSession.tsx
   │  ├─ LogExercise.tsx
   │  ├─ ExerciseDetail.tsx
   │  ├─ EditWorkout.tsx
   │  ├─ ExerciseLibrary.tsx
   │  ├─ History.tsx
   │  ├─ SessionDetail.tsx    # view / edit one past session
   │  ├─ Settings.tsx
   │  └─ NotFound.tsx
   ├─ components/
   │  ├─ Shell.tsx            # Header, TabBar, Screen padding
   │  ├─ LineChart.tsx        # hand-rolled SVG, no chart library
   │  ├─ ExercisePicker.tsx   # pool first + "all exercises" expander
   │  ├─ Sheet.tsx            # bottom sheet
   │  ├─ Confirm.tsx
   │  └─ Icons.tsx
   └─ styles/global.css       # dark theme tokens, safe-area insets
```

*(Built as planned. Set rows ended up inline in `LogExercise`/`SessionDetail` rather than
a shared `SetRow.tsx` — the two uses differ enough that a shared component would have been
all props and no savings.)*

---

## 6. Dependencies (deliberately tiny)

**Runtime:** `react`, `react-dom`, `idb`. That's it.

**Dev:** `vite`, `typescript`, `@vitejs/plugin-react`, `vite-plugin-pwa`, `sharp` (icon generation, one-off).

Three things I'm **not** installing, and why:

| Skipped | Instead | Reason |
|---|---|---|
| `react-router` | ~40-line hash router | Hash routing also makes GitHub Pages deep links work with zero server config |
| `recharts` / `chart.js` | ~120-line SVG component | You asked for lightweight; a line chart is a `<polyline>` and some axis math |
| Any UI kit | Plain CSS | Gym UI is ~6 component types, all custom-sized for thumbs |

`vite-plugin-pwa` is a **dev** dependency — it generates the Workbox service worker and
precache manifest at build time. Hand-rolling the SW would mean hand-maintaining a list
of content-hashed filenames, which breaks on every build. Not worth it.

---

## 7. Deployment — GitHub Pages

**Recommendation: GitHub Pages**, for three reasons specific to your setup:

1. This is already a git repo. Deploy becomes `git push` — no extra account, no CLI auth.
2. The app is 100% static with zero backend. Vercel's serverless/edge features are dead weight here.
3. Free and permanent for public repos, with no build-minute limits that matter at this size.

**The one cost** is the `/workout/` subpath. That normally breaks SPA routing and asset
paths — but hash routing sidesteps routing entirely, and `base: '/workout/'` in Vite
handles assets. The service worker scope becomes `/workout/`, which is correct and
sufficient for a standalone PWA.

*(Vercel would be the better call if you later wanted a custom domain or push
notifications — both want a root-scope origin. Easy to switch; only `base` changes.)*

```
Workflow: .github/workflows/deploy.yml
push to main → npm ci → npm run build → actions/deploy-pages
```

One-command redeploy: `npm run deploy` → `git push origin main`.

---

## 8. Starting state — empty by design

**Superseded.** This section originally specified a seeded Upper / Full Body program.
That was removed: the app now starts with zero workouts and zero exercises, and you
author everything yourself.

- A one-time migration (`src/db/migrations.ts`) deletes the old seeded content from any
  device that already had it, keeping any seeded exercise you'd logged a set against so
  no history is orphaned. It records a flag in the `meta` store so it runs exactly once.
- The exercise library is built during training: tap a slot, type a name, and the
  exercise is created and added to that slot's pool. Creation is de-duplicated
  case-insensitively so one exercise can't fork into two timelines.

---

## 9. Build order

1. **Scaffold + data layer** — Vite/TS, types, `db.ts`, `repo.ts`, store.
2. **Core loop end-to-end** — Home → Start → slot list → pick exercise → log sets → Finish.
   Nothing else until this works on a phone-sized viewport.
3. **Exercise detail** — "last time" block, SVG graph w/ 3 toggles, full history.
4. **Editing** — Edit Workout (reorder slots, edit pools), Exercise Library, History edit/delete.
5. **PWA** — manifest, SW, icons, iOS meta, safe areas.
6. **Verify** — hard reload persistence, airplane-mode offline, export→wipe→import round-trip.
7. **Deploy + README** — Actions workflow, live URL, iPhone install steps.

---

## 10. Assumptions I'm keeping (flag any you want changed)

- An exercise is just a name; no equipment field. Weight is always labelled `lb`.
- Working sets only; no warm-up flag.
- No rest timer, no RPE, no notes, no streaks.
- One workout in progress at a time; it survives an app close and resumes on Home.
- Weight accepts any decimal (2.5 increments are just the stepper buttons).

## 11. Open questions

1. **Bottom tab bar** — I'm planning Home · History · Library · Settings as a fixed bar.
   Alternative is a single Home screen with a menu. Tab bar is more taps-efficient mid-gym.
2. **Exercise picker scope** — when you tap a slot, I show the slot's pool first, with an
   "All exercises" expander below it so you can grab something off-pool without editing the
   workout. Reasonable?
3. **Repo name** — the deploy base path must match the GitHub repo name. Plan assumes
   `workout`. Tell me if it'll be something else.
