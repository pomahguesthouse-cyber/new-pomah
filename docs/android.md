# Pomah Admin Android app

The Android app is a Capacitor shell around the live admin at `https://pomahguesthouse.com/admin`. Faizal can create bookings, use WhatsApp chat, and the rest of `/admin` from the phone. A web deploy updates the app. A new APK is only needed when the native shell changes (icon, splash, OAuth scheme, Firebase config).

App id: `com.pomahguesthouse.admin`  
App name: `Pomah Admin`

## Why this is not a bundled WebView

The admin is a TanStack Start app. Pages call server functions on the website, and the session lives in the browser. Packaging a static copy would still depend on that server, and every UI fix would need a new APK. Pointing the shell at the live `/admin` URL avoids that.

The cost: the phone must be online, and the mobile layout, push registration, and OAuth return page only appear after those website changes are deployed (Lovable). The APK by itself does not contain the admin UI.

Google blocks OAuth inside an Android WebView. The app opens the existing Lovable broker (`/~oauth/initiate`) in Chrome Custom Tabs, then the site page `/native-oauth-return` hands the session back to the app with the custom scheme `pomahadmin://oauth-callback`. The WebView checks the `state` value it stored before opening the tab. Email and password sign-in stays inside the WebView and does not need this hop.

## What you do by hand

Lovable does not apply `supabase/migrations` for you. Push also needs a Firebase project. Until those steps are done, the app still installs and the admin still works. Notifications stay off.

### 1. Run the migration

In the Supabase SQL editor (Lovable Cloud project `gofvxeiulaljwyfyhnww`), run the whole file:

`supabase/migrations/20260927234500_staff_device_tokens_and_push.sql`

That creates:

- `device_tokens` — staff user id, FCM token, platform, timestamps. RLS lets the owning staff member or an admin read and write rows.
- `register_device_token` / `unregister_device_token` — the app calls these after login and on sign-out.
- `staff_push_config` — holds the webhook secret. No client policies.
- Triggers on new inbound WhatsApp rows (`whatsapp_messages`, direction `in`) and new `bookings` rows. They only call `pg_net`. They do not change prices, availability, or auto-reply.

The triggers do nothing until the secret row exists.

### 2. Firebase

1. Create a Firebase project (or use an existing one).
2. Add an Android app with package name `com.pomahguesthouse.admin`.
3. Download `google-services.json` and place it at `android/app/google-services.json`. That path is gitignored. Do not commit it.
4. In Firebase, open Project settings → Service accounts → Generate new private key.
5. That JSON is the FCM HTTP v1 credential. Do not commit it.

Rebuild the APK after adding `google-services.json`. The debug build still succeeds without the file; push registration will fail until it is present.

### 3. Deploy the edge function and secrets

From a machine logged into the Supabase CLI for this project:

```bash
supabase secrets set \
  FCM_SERVICE_ACCOUNT_JSON="$(cat /path/to/service-account.json)" \
  PUSH_WEBHOOK_SECRET="$(openssl rand -hex 32)"

supabase functions deploy send-staff-push --no-verify-jwt
```

`supabase/config.toml` already sets `verify_jwt = false` for `send-staff-push`. The function rejects calls that do not send the same value in the `x-push-secret` header. `FCM_SERVICE_ACCOUNT_JSON` is read only inside the function.

Copy the webhook secret into the database (SQL editor, not git):

```sql
insert into public.staff_push_config (id, webhook_secret)
values (1, '<the PUSH_WEBHOOK_SECRET value>')
on conflict (id) do update
  set webhook_secret = excluded.webhook_secret,
      updated_at = now();
```

Optional, if the function URL is not the default project URL:

```sql
update public.staff_push_config
set function_url = 'https://gofvxeiulaljwyfyhnww.supabase.co/functions/v1/send-staff-push'
where id = 1;
```

### 4. Deploy the website

The shell loads the live site, so these repo changes have to be on `https://pomahguesthouse.com` before the phone can:

- show the bottom nav and the tighter chat / booking form
- register the FCM token after login
- finish Google sign-in via `/native-oauth-return`
- open a chat or booking when a notification is tapped (`/admin/whatsapp?thread=…`, `/admin/bookings?booking=…`)

### 5. Install the APK

A debug APK is signed with the Android debug key and can be sideloaded. On the phone, allow installs from that source, copy the APK, and open it.

```bash
bash scripts/build-android-debug.sh
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`

The script needs a JDK and an Android SDK (`ANDROID_HOME` or `android/local.properties`). It does not use GitHub Actions.

Android Studio: **File → Open** the `android/` directory, then **Build → Build Bundle(s) / APK(s) → Build APK(s)**.

## Release signing

Debug builds are enough for sideloading. A Play upload or a key you want to keep using needs a release keystore. Generate it once and store it outside git:

```bash
keytool -genkeypair -v \
  -keystore pomah-admin-release.jks \
  -alias pomah-admin \
  -keyalg RSA -keysize 2048 -validity 10000
```

Create `android/keystore.properties` (gitignored). `storeFile` is relative to the `android/` directory:

```
storeFile=pomah-admin-release.jks
storePassword=YOUR_STORE_PASSWORD
keyAlias=pomah-admin
keyPassword=YOUR_KEY_PASSWORD
```

Put `pomah-admin-release.jks` in `android/` (that folder ignores `*.jks`) or point `storeFile` at an absolute path. Then:

```bash
cd android && ./gradlew assembleRelease
```

Release APK: `android/app/build/outputs/apk/release/app-release.apk`

Keep the `.jks` file. Losing it means you cannot update an install that was signed with it. Do not commit the keystore or `keystore.properties`.

If you later want `https://` App Links instead of `pomahadmin://`, put the release (and debug) SHA-256 fingerprints in `public/.well-known/assetlinks.json` on the website. The custom scheme does not need that file, and it is what the app uses now.

## Icons

`resources/pomah-logo.png` is the public wordmark. `resources/pomah-mark.png` is the house mark. Regenerate launcher and splash art with:

```bash
python3 scripts/generate-android-icons.py
```

Then copy the results into `android/app/src/main/res` (see the script’s outputs: `resources/icon.png`, `resources/splash.png`, `resources/notification-icon.png`). The committed mipmaps are already generated from those files.

## Phone behavior

- Bottom nav on small screens: Dashboard, Booking, Chat WA, More. More opens the existing sidebar. Desktop layout is unchanged.
- The Android back button walks the WebView history, including from a chat thread back to the thread list. At the start of the history stack it leaves the app.
- Pull down from the top of a scrollable admin page to reload.
- A notification tap opens that WhatsApp thread or booking. Inbound guest messages and new booking inserts are the only triggers. Outbound replies, AI drafts, and old synced history are ignored.
- Invoice **Download PDF** / **Cetak Invoice** writes the PDF with `@capacitor/filesystem` and opens the Android share sheet (`@capacitor/share`) so the WebView does not depend on `window.print()` or a blob download. Those plugins are native. A website deploy is enough for desktop and mobile Chrome. The installed APK must be rebuilt and reinstalled (`bash scripts/build-android-debug.sh`) before the share sheet works inside the app. Until then the buttons still build the PDF, but the WebView cannot save it.

## OAuth redirect allow-list

The broker is asked to return to `https://pomahguesthouse.com/native-oauth-return`. That URL must be allowed by the Lovable / Supabase auth redirect list, same as `/login`. If Google sign-in in the app ends on an error page inside the custom tab, add that return URL to the allow-list and try again.
