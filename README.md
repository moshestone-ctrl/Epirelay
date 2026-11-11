# EpiRelay — working MVP

A real iPhone + Android app (React Native / Expo) with a real backend (Supabase), built from your business plan.
Someone having a severe allergic reaction holds the SOS button; nearby people who carry epinephrine get an
alert, tap **I'm on my way**, navigate there, and hand it over.

> **"EpiRelay" is a placeholder name.** "EpiPen" is a registered trademark of another company, so it can't be
> in your app's name. Pick a final name, run a trademark search, then change it in `src/lib/config.ts` and `app.json`.

---

## What's built

| | |
|---|---|
| **SOS** | Hold-to-send button (2 s, so it can't be pocket-dialed). Grabs your location and alerts available carriers within ~2 miles. A "Widen search" button reaches ~5 miles. Practice mode sends clearly labelled TEST alerts. |
| **911 first** | "Call 911" is on every emergency screen. Onboarding makes users confirm the app doesn't replace 911. |
| **Responders** | Carriers set device type (auto-injector or nasal spray) and expiration date, and toggle "Available". Expired devices stop receiving alerts. Reminders 30 days, 7 days and on the expiry date. |
| **Matching** | Up to 3 responders can come at once (in case a second dose is needed). Others are told enough help is coming. |
| **Live tracking** | The person in need sees who's coming and how far away, on a map, updating every ~10 s. Responders get one-tap directions in Apple/Google Maps. |
| **Chat** | Two-way messages between the person and responders ("Apt 4B, door open"). |
| **Privacy** | Nobody can see where carriers are — the app only shows a count nearby. Responders see only the *distance* until they commit to coming. Allergy info is shared only with committed responders, and only if the user allows it. Old precise locations are automatically coarsened. |
| **After** | Star rating + comment. In-app account deletion (Apple requires it). |

---

## Install it as a real Android app (no computer needed)

Every time code is pushed to the `main` branch, GitHub builds the Android app on its own servers (about
15–25 minutes) and publishes it under **Releases** in your repository.

1. On your Android phone, open your repository on github.com → **Releases** (or go straight to
   `github.com/<your-username>/epirelay/releases/latest`). Sign in if asked — the repository is private.
2. Under **Assets**, tap **EpiRelay-build-N.apk** to download it.
3. Open the download. Android will ask to allow installing apps from your browser — allow it, then tap **Install**.
   Google Play Protect may warn that the app is from an unknown developer; tap **More details → Install anyway**.
4. Open **EpiRelay** from your home screen.

Each new build installs over the previous one and keeps your sign-in. To share it with testers, add them as
collaborators on the repository (Settings → Collaborators) so they can open the Releases page too.

**Good to know about this test build**
- The in-app map needs a free Google Maps API key. Without one, the app shows distances and an
  "Open in Google Maps" button instead. To turn the map on: create an Android Maps SDK key in Google Cloud
  Console, add it as a repository secret named `GOOGLE_MAPS_ANDROID_API_KEY` (Settings → Secrets and variables →
  Actions), then re-run the build (Actions → Build Android app → Run workflow).
- Alerts reach a responder while EpiRelay is open on their screen. Alerts when the app is closed need a Firebase
  project and an Expo account connected to the build — see "What still needs a developer" below.
- It's signed with a test key, which is fine for installing directly but not for the Play Store. Google plans to
  require verified developers for all Android apps, including directly installed ones, in 2027 — before then,
  move testing to a Play Console internal test track.

---

## Run it in Expo Go instead (for making changes — about 30–45 minutes, once)

You need: a Mac or Windows computer, your phone, and a free [Supabase](https://supabase.com) account.

### Step 1 — Install two things

1. **Node.js** on your computer: go to [nodejs.org](https://nodejs.org), download the **LTS** version, install it.
2. **Expo Go** on your phone, from the App Store or Google Play.

Unzip this project somewhere easy, like your Desktop.

### Step 2 — Create your backend

1. Sign in at [supabase.com](https://supabase.com) → **New project**. Pick any name and a strong database password
   (save it). Choose the US East region. Wait ~2 minutes while it sets up.
2. In the left sidebar open **SQL Editor** → **New query**.
3. Open the file `supabase/schema.sql` from this project in any text editor, copy **everything**, paste it into
   Supabase, and press **Run**. You should see "Success. No rows returned".
4. For testing only: go to **Authentication → Sign In / Providers → Email** and turn **off** "Confirm email", so
   test accounts work instantly. (Turn it back on before you launch.)

### Step 3 — Connect the app to your backend

1. In Supabase, click the **Connect** button at the top of your project and choose the mobile / Expo tab.
2. Copy the **Project URL** and the **publishable key** (starts with `sb_publishable_`; older projects call it the
   `anon` key — that works too).
3. Open the file named `.env` in this project folder (on a Mac, press **Cmd + Shift + .** in Finder to see files
   starting with a dot). Replace the two placeholder values with yours and save.

### Step 4 — Start the app

1. Open **Terminal** (Mac: search "Terminal" in Spotlight) or **PowerShell** (Windows: search "PowerShell").
2. Type `cd ` (with a space), drag the project folder onto the window, and press Enter.
3. Run these one at a time:
   ```
   npm install
   npx expo start
   ```
4. A QR code appears. **iPhone:** point the Camera app at it. **Android:** open Expo Go and tap "Scan QR code".
   Your phone and computer must be on the same Wi-Fi. If it won't connect, stop it (Ctrl + C) and run
   `npx expo start --tunnel` instead.

Leave the Terminal window open while you use the app. Any change you save to the code shows up on your phone
instantly.

### Step 5 — Try a full rescue with a friend

You need two phones, each running the app with its own account.

1. **Phone B (responder):** Profile → turn on *I carry epinephrine* → pick the type → enter an expiry date like
   `2027-06-30` → turn on *Available to respond* → Save. Keep the app open.
2. **Phone A (person in need):** turn on **Practice mode**, then press and hold **SOS** for 2 seconds.
3. Phone B alerts within a second or two. Tap **I'm on my way** → watch Phone A's map update → send messages →
   tap **I've arrived** → **Mark as resolved** → both leave feedback.

The two phones need to be within ~2 miles of each other (or use "Widen search" for ~5 miles).

---

## What still needs a developer before a public launch

This is a working MVP, not a finished product. In the Expo Go test setup, **alerts only arrive while the
responder has the app open.** Closing that gap is the most important next step.

| Item | Why it matters | Effort |
|---|---|---|
| **Alerts when the app is closed** | Push notifications need a "development build" instead of Expo Go: `npx eas-cli@latest init` (adds a project ID), `npx eas-cli@latest build:configure`, then `npx eas-cli@latest build --profile development`. The push-sending code is already written and tested. | ~1 day |
| **iOS Critical Alerts** | Lets SOS alerts sound even on silent / Do Not Disturb. Requires applying to Apple for a special entitlement — worth doing early, approval takes time. | Apply now |
| **Background location** | Today a carrier's location refreshes whenever they open the app (and is trusted for 3 hours). Background updates keep responders matchable all day. Needs extra App Store / Play review justification. | 2–4 days |
| **Store accounts + release** | Apple Developer ($99/yr), Google Play ($25 once), app icons, store listings, a Google Maps API key for Android (`react-native-maps` plugin in `app.json`). | 1–2 weeks |
| **Password reset, email confirmation, phone verification** | Account basics. Supabase supports all of them. | 1–3 days |
| **Legal content** | Terms, Privacy Policy, waiver, state-by-state summaries for the Safety & legal screen (currently a marked placeholder). From a lawyer, not a developer. | — |
| **Admin view, analytics, abuse handling** | Seeing alerts in your pilot, blocking bad actors. | 1–2 weeks |

---

## Product decisions that differ from the business plan

These were deliberate; change them only after thinking them through.

- **Every SOS is equal and free.** The plan's "Priority Alerts" (premium) and "Fast-Response Fee ($5–$20)" would
  mean someone who pays gets faster life-saving help than someone who doesn't. That's a serious liability and
  reputational risk, and it contradicts the plan's own "keep emergency access free" goal. Charge for things
  *around* the emergency instead: medical profile extras, institutional dashboards, training, refill partnerships.
- **"View nearby EpiPen holders" became a count.** Showing where people carrying prescription medicine are would
  put them at risk. The app shows "4 available carriers within ~2 miles" instead.
- **Device-neutral.** Responders can carry an auto-injector *or* nasal-spray epinephrine.
- **Up to 3 responders**, not 1, since a second dose is sometimes needed.
- Small fix for the plan: "1 in 50 Americans" is 2%, not 5%. AAFA's range is about 1 in 50 to 1 in 20.

---

## For your developer

- **Stack:** Expo SDK 58 (React Native 0.88, Expo Router, React Compiler), TypeScript, Supabase (Postgres + RLS +
  Realtime + pg_net), `react-native-maps`.
- **Builds:** `.github/workflows/android.yml` runs type-check, lint and backend tests, then `expo prebuild` +
  `gradlew assembleRelease` (arm64-v8a, armeabi-v7a) and publishes the APK as a GitHub Release. Config is in
  `app.config.js` (Maps key and version code come from the build environment). The `android/` folder is generated
  and not committed. For store releases, switch to EAS Build or add a real upload keystore.
- **Backend:** everything is in `supabase/schema.sql` — tables, row-level-security policies, and `security definer`
  RPCs. Matching uses a haversine distance with a lat/lng bounding box; switch to PostGIS when you outgrow it.
  Push goes out from Postgres via `pg_net` → Expo Push API. Tuning knobs are in `public._cfg()`.
- **Tests:** `supabase/test` runs the schema against embedded Postgres with Supabase-like stubs and checks 52
  behaviours (matching, privacy, races, permissions). `cd supabase/test && npm install && npm test`.
- **App:** routes in `src/app/` (`index` = home/SOS, `sos/[id]` = person in need, `respond/[id]` = responder),
  shared code in `src/lib/`, components in `src/components/`. `npm run typecheck` and `npx expo lint` both pass.
- **Real-time:** screens use Supabase Realtime for instant updates with a 4-second polling fallback
  (`useAlert` in `src/lib/hooks.ts`). Realtime respects RLS, so each user only receives rows they can read.
- **App settings** (search timings, units, app name) are in `src/lib/config.ts`.
