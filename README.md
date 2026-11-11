# EpiRelay — working MVP

A real iPhone + Android app (React Native / Expo) with a real backend (Supabase), built from your business plan.
Someone having a severe allergic reaction holds the SOS button; nearby people who carry epinephrine get an
alert, tap **I'm on my way**, navigate there, and hand it over.

> **"EpiRelay" is a placeholder name.** "EpiPen" is a registered trademark of another company, so it can't be
> in your app's name. Pick a final name, run a trademark search, then change it in `src/lib/config.ts` and `app.config.js`.

---

## What's built

| | |
|---|---|
| **SOS** | Hold-to-send button (2 s, so it can't be pocket-dialed). Grabs your location and alerts available carriers within ~2 miles. A "Widen search" button reaches ~5 miles. Practice mode sends clearly labelled TEST alerts. |
| **911 first** | "Call 911" is on every emergency screen. Onboarding makes users confirm the app doesn't replace 911. |
| **Responders** | Carriers set device type (auto-injector or nasal spray) and expiration date, and toggle "Available". Expired devices stop receiving alerts. Reminders 30 days, 7 days and on the expiry date. |
| **Matching** | Up to 3 responders can come at once (in case a second dose is needed). Others are told enough help is coming. |
| **Live map** | After an SOS, an in-app map shows you, the search area, and each responder on the way with their first name and distance, updating every ~10 s. To protect responders, they appear on your map only once they're within about ¼ mile, and disappear when the SOS ends. Responders see a map to the person plus one-tap directions in Apple/Google Maps. Uses free OpenFreeMap / OpenStreetMap tiles — no API key or account. |
| **Chat** | Two-way messages between the person and responders ("Apt 4B, door open"). |
| **Privacy** | Nobody can see where carriers are — the app only shows a count nearby. Responders see only the *distance* until they commit to coming. Allergy info is shared only with committed responders, and only if the user allows it. Old precise locations are automatically coarsened. |
| **Background alerts** | Responders who allow location "All the time" stay matchable and get alerted while EpiRelay is in the background (Android shows a "Ready to respond" notification while they're Available). |
| **Accounts** | Email + password, "Forgot password?" reset by email, change password, in-app account deletion. |
| **Responder safety** | Before going, responders see whether the person's phone is verified, how long they've been a member, and whether earlier SOS alerts ended with help arriving — plus hand-over rules ("you never have to go inside"). While helping, the app checks on them every 20 minutes; if they don't answer within 10 more minutes, or tap **I feel unsafe**, the server texts their emergency contact a map link to where they are. "I feel unsafe" also offers to call 911 and flags the SOS. Responders must have an emergency contact. |
| **Stopping fake alerts** | Everyone confirms they're 18+. Phone numbers are verified by text-message code. New accounts can only send practice alerts for their first 24 hours. An account is put on hold automatically after an "abusive" or "unsafe" report, or reports from 2 different people. SOS spam is rate-limited (6 real / 10 practice alerts per hour). The team can also suspend someone by hand. If any screen fails, the app shows a "Call 911" screen and reports the error. |
| **Admin view** | Two notebooks in the Supabase dashboard: "EpiRelay admin" (users, active alerts, response times, reports, suspensions, feedback, app errors) and "EpiRelay safety" (responders out helping, check-ins, texts to emergency contacts, automatic holds). |
| **After** | Star rating + comment. |

---

## Install it as a real Android app (no computer needed)

Every time code is pushed to the `main` branch, GitHub builds the Android app on its own servers, installs and
opens it on an Android emulator to check it starts, and only then publishes it under **Releases** in your
repository (about 30 minutes in total).

1. On your Android phone, open your repository on github.com → **Releases** (or go straight to
   `github.com/moshestone-ctrl/Epirelay/releases/latest`). Sign in if asked (only if the repository is private).
2. Under **Assets**, tap **EpiRelay-build-N.apk** to download it.
3. Open the download. Android will ask to allow installing apps from your browser — allow it, then tap **Install**.
   Google Play Protect may warn that the app is from an unknown developer; tap **More details → Install anyway**.
4. Open **EpiRelay** from your home screen.

Each new build installs over the previous one and keeps your sign-in. To share it with testers, add them as
collaborators on the repository (Settings → Collaborators) so they can open the Releases page too.

**Good to know about this test build**
- The map uses free OpenFreeMap tiles (OpenStreetMap data), so there's no map key to set up.
- Alerts reach a responder while EpiRelay is open, or running in the background after they allowed location
  "All the time". Alerts after the app has been fully closed need push notifications — see the next section.
- It's signed with a test key, which is fine for installing directly but not for the Play Store. Google plans to
  require verified developers for all Android apps, including directly installed ones, in 2027 — before then,
  move testing to a Play Console internal test track.

---

## One-time settings for you (Supabase dashboard)

- **Password reset links:** Authentication → URL Configuration → **Redirect URLs** → add `epirelay://**` → Save.
  Without this, the reset email's link opens a broken web page instead of the app.
- **Delete my account:** SQL Editor → New query → paste `supabase/add-account-deletion.sql` → Run.
- **Email confirmation:** off for testing (Authentication → Sign In / Providers → Email). Before launch, turn it
  back on and connect your own email sender (Authentication → Emails → SMTP), since the built-in one only sends a
  few emails per hour.
- **Admin view:** SQL Editor → Notebooks → "EpiRelay admin" or "EpiRelay safety" → Run all.
- **Server sleeping:** free Supabase projects pause after a quiet week. The "Keep server awake" GitHub job pings it
  twice a day; upgrading the project to the Pro plan removes the risk entirely and is recommended before a pilot.

## Turning on text messages (Twilio)

Two features send texts: **phone verification codes** and **safety texts to a responder's emergency contact**.
Both use [Twilio](https://www.twilio.com). Until this is set up, the app works, but "Verify phone" says text
messages aren't switched on yet, and safety texts are only logged in the "EpiRelay safety" notebook
(as `sms_not_configured`).

1. **Create a Twilio account and upgrade it** (add about $20 of credit). Free trial accounts can only text numbers
   you've verified with Twilio and can't send custom messages, so they won't work for real users.
2. **Verification codes — Twilio Verify** (no number registration needed):
   Twilio Console → **Verify → Services → Create new** (name it EpiRelay, channel SMS) → copy the **Service SID**.
   Then Supabase → **Authentication → Sign In / Providers → Phone** → turn it on → SMS provider **Twilio Verify** →
   paste your Twilio **Account SID**, **Auth Token** and the Verify **Service SID** → Save.
3. **Safety texts — a toll-free number:** Twilio Console → **Phone Numbers → Buy a number** → choose a **Toll-free**
   number with SMS. US carriers block texts from toll-free numbers until they're verified, so submit
   **toll-free verification** right away (Messaging → Regulatory compliance → Toll-free verification). Use case:
   "Safety alerts to a user's emergency contact when they volunteer during a medical emergency"; sample message:
   *"EpiRelay safety alert: Sam went to help someone in an allergy emergency and hasn't checked in. Last known
   location: (map link). Please call them."*; opt-in: "Users enter their emergency contact in the app's profile."
   Approval usually takes from a few days to a few weeks.
4. **Give the safety texts the keys:** Supabase → **Edge Functions → Secrets** → add `TWILIO_ACCOUNT_SID`,
   `TWILIO_AUTH_TOKEN` and `TWILIO_FROM` (the toll-free number, like `+18885551234`). These are secret: enter them
   only in the Supabase and Twilio dashboards — never in GitHub, the app, or a chat.
5. **Make verification required:** once codes arrive on your own phone, ask Claude (or your developer) to switch
   `require_verified_phone` to 1 in `public._cfg()`. After that, only people with a verified phone can send an SOS
   or respond to one.

## Turning on alerts when the app is closed (push notifications)

The code is ready; it needs two free accounts:

1. **Expo** — sign up at expo.dev → **Create project** named `epi-relay` → copy its **Project ID**. In GitHub:
   repository **Settings → Secrets and variables → Actions → Variables → New variable** named `EAS_PROJECT_ID`
   with that ID.
2. **Firebase** — at console.firebase.google.com create a project → **Add app → Android** with package name
   `com.epirelay.app` → download **google-services.json** and add it to the root of this repository.
   Then in Firebase: Project settings → Service accounts → **Generate new private key**, and upload that file in
   expo.dev → your project → **Credentials → Android → FCM V1 service account key**. (That key is secret: upload it
   only there, never into GitHub or a chat.)
3. Push any change (or Actions → Build Android app → Run workflow). The new build registers each phone for push,
   and the server already sends SOS alerts through Expo's push service.

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
   `2027-06-30` → add an **emergency contact** → turn on *Available to respond* → Save. Keep the app open.
2. **Phone A (person in need):** turn on **Practice mode**, then press and hold **SOS** for 2 seconds.
   (Accounts less than 24 hours old can only send practice alerts anyway.)
3. Phone B alerts within a second or two. Tap **I'm on my way** → Phone A sees Phone B on the map once it's within
   about ¼ mile → send messages → tap **I've arrived** → **Mark as resolved** → both leave feedback.
4. To try the safety check-in, leave Phone B "on the way" for 20 minutes: it asks "are you OK?". Tap **I feel
   unsafe** to see the emergency-contact flow (the text goes out once Twilio is set up).

The two phones need to be within ~2 miles of each other (or use "Widen search" for ~5 miles).

---

## What still needs a developer before a public launch

This is a working MVP, not a finished product. The most important next step is push notifications (above), so
alerts reach responders even after the app has been fully closed.

| Item | Why it matters | Effort |
|---|---|---|
| **Alerts when the app is closed** | Code done; needs the Expo + Firebase accounts described above. | ~1 hour once accounts exist |
| **iOS Critical Alerts** | Lets SOS alerts sound even on silent / Do Not Disturb. Requires applying to Apple for a special entitlement — worth doing early, approval takes time. | Apply now |
| **Background location review** | Built. Google Play and Apple require a written justification and a short video of the "Allow all the time" explanation screen when you submit. | 1 day |
| **Store accounts + release** | Apple Developer ($99/yr), Google Play ($25 once), store listings and screenshots. | 1–2 weeks |
| **Email confirmation + own email sender** | Password reset is built. Turn email confirmation back on with your own SMTP sender. | 1 day |
| **Text messages** | Phone verification and safety texts are built; they need the Twilio setup above, including toll-free verification. | 1 hour + waiting for approval |
| **Identity checks for responders (optional)** | Phone verification stops most throwaway accounts. For a public launch, consider an ID check (e.g. Stripe Identity or Persona) for people who send real SOS alerts. | 2–3 days |
| **Legal content** | Terms, Privacy Policy, waiver, state-by-state summaries for the Safety & legal screen (currently a marked placeholder). From a lawyer, not a developer. | — |
| **Medical review** | Have an allergist or EMS professional review the first-aid text on the Safety screen. | — |

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
  Realtime + pg_net), MapLibre React Native with OpenFreeMap tiles (`src/components/AlertMap.tsx`).
- **Builds:** `.github/workflows/android.yml` runs type-check, lint and backend tests, then `expo prebuild` +
  `gradlew assembleRelease` (arm64-v8a, armeabi-v7a, x86_64 — the last so the emulator launch check can run it) and publishes the APK as a GitHub Release. Config is in
  `app.config.js` (Expo project ID and version code come from the build environment). The `android/` folder is generated
  and not committed. For store releases, switch to EAS Build or add a real upload keystore.
- **Backend:** everything is in `supabase/schema.sql` — tables, row-level-security policies, and `security definer`
  RPCs. Matching uses a haversine distance with a lat/lng bounding box; switch to PostGIS when you outgrow it.
  Push goes out from Postgres via `pg_net` → Expo Push API. Tuning knobs are in `public._cfg()`.
- **Tests:** `supabase/test` runs the schema against embedded Postgres with Supabase-like stubs and checks 98
  behaviours (matching, privacy zone, races, permissions, reports, automatic holds, check-ins and escalations,
  phone and new-account rules, rate limits).
  `cd supabase/test && npm install && npm test`. CI also opens every APK on an Android emulator
  (`.github/scripts/launch-test.sh`) before publishing; `diagnose.yml` re-runs that on any release and prints crash logs.
- **Live server:** Supabase project `epirelay` (`nwmncmdqdooetjwzkueq`). `schema.sql` is the full setup for a fresh
  project; the live project was set up with the same SQL in parts, minus `add-account-deletion.sql`.
- **Responder safety:** check-in state lives on `alert_recipients` (`last_checkin_at`, `safe_confirmed_at`,
  `felt_unsafe_at`, `escalated_at`). A `pg_cron` job (`safety-escalations`, every minute) calls the
  `safety-escalation` Edge Function (`supabase/functions/safety-escalation`, `verify_jwt` off, guarded by a shared
  secret in Vault), which claims overdue rows via `_claim_due_safety_escalations()` and texts the contact through
  the Twilio Messages API. Live-server changes are in `supabase/migrations/`.
- **Background location:** `src/lib/backgroundLocation.ts` (expo-task-manager + foreground service); errors are
  reported to `public.app_errors` by `src/lib/errors.ts` and the root `ErrorBoundary`.
- **App:** routes in `src/app/` (`index` = home/SOS, `sos/[id]` = person in need, `respond/[id]` = responder),
  shared code in `src/lib/`, components in `src/components/`. `npm run typecheck` and `npx expo lint` both pass.
- **Real-time:** screens use Supabase Realtime for instant updates with a 4-second polling fallback
  (`useAlert` in `src/lib/hooks.ts`). Realtime respects RLS, so each user only receives rows they can read.
- **App settings** (search timings, units, app name) are in `src/lib/config.ts`.
