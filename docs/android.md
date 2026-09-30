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

### 1. Run the migrations

In the Supabase SQL editor (Lovable Cloud project `gofvxeiulaljwyfyhnww`), run these files in order, each one fully:

1. `supabase/migrations/20260927234500_staff_device_tokens_and_push.sql`
2. `supabase/migrations/20260930130000_app_role_manager.sql`
3. `supabase/migrations/20260930130100_staff_push_admin_manager.sql`

The first file creates:

- `device_tokens` — staff user id, FCM token, platform, timestamps. RLS lets the owning staff member or an admin read and write rows.
- `register_device_token` / `unregister_device_token` — the app calls these after login and on sign-out. Any staff caller (admin, staff, or manager) may register. Only admin and manager tokens receive pushes.
- `staff_push_config` — holds the webhook secret (and, after the 20260930150000 migration, optionally the FCM service account). No client policies.
- Triggers on new inbound WhatsApp rows (`whatsapp_messages`, direction `in`) and new `bookings` rows. They only call `pg_net`. They do not change prices, availability, or auto-reply.

Run the second file on its own. It only adds `manager` to the `app_role` enum. PostgreSQL cannot use a new enum value in the same transaction that adds it.

The third file includes `manager` in `is_staff()`, limits push delivery to users with role `admin` or `manager`, and throttles WhatsApp pushes to one per thread every 30 seconds (`staff_push_throttle`).

The triggers do nothing until the secret row exists.

### 2. Firebase

1. Create a Firebase project (or use an existing one).
2. Add an Android app with package name `com.pomahguesthouse.admin`.
3. Download `google-services.json` and place it at `android/app/google-services.json` (the `android/app` directory, next to `build.gradle`). That path is gitignored. Do not commit it.
4. In Firebase, open Project settings → Service accounts → Generate new private key.
5. That JSON is the FCM HTTP v1 credential. Do not commit it.

Rebuild the APK after adding `google-services.json`. The debug build still succeeds without the file. Push is skipped until that file is present: the shell checks a build flag before calling `PushNotifications.register()`, and a push failure is logged instead of closing the app. A WebView renderer crash reloads `/admin` instead of killing the process.

### 3. Deploy the edge function and secrets

From a machine logged into the Supabase CLI for this project:

```bash
supabase secrets set \
  FCM_SERVICE_ACCOUNT_JSON="$(cat /path/to/service-account.json)" \
  PUSH_WEBHOOK_SECRET="$(openssl rand -hex 32)"

supabase functions deploy send-staff-push --no-verify-jwt
```

`supabase/config.toml` already sets `verify_jwt = false` for `send-staff-push`. The function rejects calls that do not send the same value in the `x-push-secret` header. `FCM_SERVICE_ACCOUNT_JSON` is read only inside the function.

**Alternative: store the secrets in the database instead of function env.** Run `supabase/migrations/20260930150000_staff_push_config_fcm_key.sql`, which adds `staff_push_config.fcm_service_account` (jsonb). The table has RLS on, no policies, and no grants for `anon` or `authenticated`, so only the service role (the edge function) and the SECURITY DEFINER trigger can read it. The function looks for each secret in this order:

| Secret | 1st choice (function env) | Fallback (`staff_push_config`, `id = 1`) |
| --- | --- | --- |
| Webhook secret | `PUSH_WEBHOOK_SECRET` | `webhook_secret` |
| FCM service account | `FCM_SERVICE_ACCOUNT_JSON` | `fcm_service_account` |

So you can skip `supabase secrets set` entirely and only deploy the function. Run this in the SQL editor, not in git. The service account JSON contains a private key; do not paste it into a file that gets committed or into chat:

```sql
insert into public.staff_push_config (id, webhook_secret, fcm_service_account)
values (
  1,
  '<random secret, at least 16 characters>',
  '<contents of the service account JSON>'::jsonb
)
on conflict (id) do update
  set webhook_secret = excluded.webhook_secret,
      fcm_service_account = excluded.fcm_service_account,
      updated_at = now();
```

If you set the env variables, they win over the database values. The trigger always signs calls with `staff_push_config.webhook_secret`, so when `PUSH_WEBHOOK_SECRET` is set in env it must equal that column.

Otherwise (env approach), copy the webhook secret into the database (SQL editor, not git):

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

### 4. Grant the manager role

Pushes go to accounts with role `admin` or `manager`. A `staff` account can still sign in and register a phone token; that phone does not receive pushes until the account also has `admin` or `manager`.

In the SQL editor, after the person has signed up once:

```sql
insert into public.user_roles (user_id, role)
select id, 'manager'::public.app_role
from auth.users
where email = 'pengelola@example.com'
on conflict (user_id, role) do nothing;
```

Replace the email with the pengelola account. An existing admin already receives pushes and does not need this row.

### 5. Deploy the website

The shell loads the live site, so these repo changes have to be on `https://pomahguesthouse.com` before the phone can:

- show the bottom nav and the tighter chat / booking form
- register the FCM token after login
- finish Google sign-in via `/native-oauth-return`
- open a chat or booking when a notification is tapped (`/admin/whatsapp?thread=…`, `/admin/bookings?booking=…`)

### 6. Install the APK

A debug APK is signed with the Android debug key and can be sideloaded. On the phone, allow installs from that source, copy the APK, and open it.

Rebuild and reinstall after this change. The manifest declares `POST_NOTIFICATIONS` and the default FCM channel `pomah-staff`. The website deploy creates that channel at runtime and shows a toast while the app is open; the manifest entries are in the APK.

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
- A notification tap opens that WhatsApp thread or booking. Only phones signed in as admin or manager receive it. Inbound guest messages and every new booking insert are the triggers, including a booking a staff member creates in the admin. Outbound replies, AI drafts, and old synced history are ignored. WhatsApp is limited to one push per thread every 30 seconds, and a provider message id (`wpp_id` / `external_message_id`) never pushes twice. The body is the guest name (or phone) plus a preview of up to 100 characters; media without text shows `[Foto]`, `[Dokumen]`, `[Video]`, `[Audio]`, `[Stiker]`, or `[Lokasi]`. Run `20260930140000_wa_inbound_push_hardening.sql` in the Supabase SQL editor after `20260930130100`. While the app is open, the same alert shows as a toast. The Android channel is `pomah-staff` (“Pesan & booking”).
- On a Samsung phone, set the app battery mode to Unrestricted or pushes are delayed or dropped after the screen turns off: Settings → Apps → Pomah Admin → Battery → Unrestricted (Tidak dibatasi). Remove Pomah Admin from Sleeping apps and Deep sleeping apps if it is listed there.
- Invoice **Download PDF** / **Cetak Invoice** writes the PDF with `@capacitor/filesystem` and opens the Android share sheet (`@capacitor/share`) so the WebView does not depend on `window.print()` or a blob download. Those plugins are native. A website deploy is enough for desktop and mobile Chrome. The installed APK must be rebuilt and reinstalled (`bash scripts/build-android-debug.sh`) before the share sheet works inside the app. Until then the buttons still build the PDF, but the WebView cannot save it.

## OAuth redirect allow-list

The broker is asked to return to `https://pomahguesthouse.com/native-oauth-return`. That URL must be allowed by the Lovable / Supabase auth redirect list, same as `/login`. If Google sign-in in the app ends on an error page inside the custom tab, add that return URL to the allow-list and try again.
