
# Pomah Guesthouse — MVP Plan

A scoped first build of the AI-native hospitality OS. The architecture diagram in your brief is the long-term north star; this plan delivers a thin, working vertical slice on top of it. Everything is structured so the deeper layers (event bus, agents, dynamic pricing, SEO automation, etc.) can be added in later iterations without rewrites.

## In scope (this build)

1. **Admin dashboard** — operations cockpit in the *Curated Ledger* design
   - Overview: KPIs (Occupancy, ADR, RevPAR, Today's Revenue), arrivals/departures table, 7-day room timeline, AI suggestion card, WhatsApp panel
   - Calendar: full room × date timeline with click-to-create booking
   - Bookings: list, detail drawer, create/edit/cancel, check-in / check-out
   - Guests: list + profile (stay history, notes)
   - Rooms & Rates: room types, rooms, base nightly rate
   - WhatsApp Inbox: conversation list + thread view, manual reply, "AI draft" button (LLM-generated suggested reply)
   - AI Front Office: simple chat panel that can answer questions about availability/pricing using live DB data
   - Settings: property info, user profile

2. **Public booking site** — guest-facing
   - Landing (`/`), Rooms (`/rooms`), Room detail (`/rooms/$slug`), Booking (`/book`), Confirmation (`/book/confirmation/$id`), About (`/about`), Contact (`/contact`)
   - Date-range search → real availability check → booking creation (no payment yet, status = `pending`)
   - Each route has its own SEO metadata

3. **Auth** — Lovable Cloud email/password + Google sign-in for staff. Public site is anonymous; bookings can be made without an account.

4. **Roles** — `admin`, `staff` via a separate `user_roles` table (RLS-safe pattern).

## Explicitly out of scope (future iterations)

- Fonnte WhatsApp integration (UI is built; webhook + send-message wiring deferred until you provide the Fonnte token). Inbox seeded with mock conversations.
- Upstash Redis, OpenRouter (using Lovable AI gateway instead), pgvector, dedicated event bus / task queue
- Dynamic pricing engine, SEO automation module, website builder module, analytics agent, payment processing
- Multi-property, channel manager (Booking.com / Airbnb sync)

## Design

"Curated Ledger" direction (selected):
- Background `#F8F7F4`, foreground `#1A1A1A`, accent sage `#5F6B5E`, hairline borders `#1A1A1A14`
- Inter (display, weights 400–800) + JetBrains Mono (labels, stats)
- Subtle slide-up entry animation, sticky translucent header, rounded `xl/2xl` cards with `ring-1 ring-black/5`
- Sage accent reserved for primary actions, AI moments, and active nav state
- Tokens go straight into `src/styles.css` via `@theme` + `:root` (oklch) — no per-component hex

## Data model (Lovable Cloud / Postgres)

```text
profiles            (id → auth.users, full_name, avatar_url)
user_roles          (id, user_id, role: 'admin' | 'staff')   ← RLS via has_role()
properties          (id, name, timezone, address, …)         ← single row for now
room_types          (id, property_id, name, slug, capacity, base_rate, description, hero_image_url)
rooms               (id, room_type_id, number, status)
guests              (id, full_name, email, phone, notes, whatsapp_id)
bookings            (id, property_id, room_id, guest_id, check_in, check_out,
                     adults, children, total_amount, status, source, created_at)
                    status: pending | confirmed | checked_in | checked_out | cancelled
                    source: direct | whatsapp | walk_in
booking_events      (id, booking_id, type, payload, created_at)         -- audit trail
whatsapp_threads    (id, guest_id, phone, last_message_at, unread_count, status)
whatsapp_messages   (id, thread_id, direction: in|out, body, ai_draft, sent_at)
ai_suggestions      (id, kind, title, body, action_payload, status, created_at)
```

RLS:
- All admin tables: read/write requires `has_role(auth.uid(), 'admin' | 'staff')`
- `bookings` insert from public site: allowed for anon when `status = 'pending'` and required fields validated server-side
- `guests` insert from public site: allowed for anon (deduped by email server-side)

## Server functions (TanStack Start `createServerFn`)

- `getDashboardOverview` — KPIs, arrivals, departures, timeline window
- `listBookings`, `getBooking`, `createBooking`, `updateBookingStatus`, `cancelBooking`
- `listAvailability(start, end)` — room × date occupancy matrix
- `searchAvailableRooms(checkIn, checkOut, guests)` — public booking search
- `submitPublicBooking(...)` — anon-allowed, validates with Zod, inserts pending booking + guest
- `listThreads`, `getThread`, `sendMessage`, `draftAiReply` (calls Lovable AI)
- `aiFrontOfficeChat` — Lovable AI chat that has tools to call `searchAvailableRooms` and quote prices
- `generateAiSuggestions` — periodic-ish job triggered on dashboard load (cached)

All admin functions use `requireSupabaseAuth`. Public functions are unauthenticated but strictly Zod-validated.

## Routes

```text
src/routes/
  __root.tsx
  index.tsx                       # public landing
  rooms.tsx                       # public room list
  rooms.$slug.tsx                 # public room detail
  book.tsx                        # public booking flow
  book.confirmation.$id.tsx
  about.tsx
  contact.tsx
  login.tsx
  _authenticated.tsx              # auth gate
  _authenticated/admin.tsx        # admin shell (sidebar + header)
  _authenticated/admin/index.tsx  # dashboard overview
  _authenticated/admin/calendar.tsx
  _authenticated/admin/bookings.tsx
  _authenticated/admin/bookings.$id.tsx
  _authenticated/admin/guests.tsx
  _authenticated/admin/rooms.tsx
  _authenticated/admin/whatsapp.tsx
  _authenticated/admin/ai.tsx
  _authenticated/admin/settings.tsx
```

## AI integration

- Lovable AI gateway, model `google/gemini-3-flash-preview` by default
- Three uses: WhatsApp draft replies, AI Front Office chat (with tool calls into DB), AI suggestions on the dashboard
- All prompts and model selection live server-side in server functions

## Build order

1. Enable Lovable Cloud + Lovable AI; apply schema migrations + RLS
2. Design tokens + shell (sidebar, header, route guard, role helper)
3. Auth (login, sign-up disabled for public; admin invites later)
4. Seed data (1 property, ~6 rooms across 3 room types, sample guests/bookings/WhatsApp threads)
5. Admin: dashboard → calendar → bookings → guests → rooms → settings
6. WhatsApp inbox UI + AI draft
7. AI Front Office chat
8. Public site: landing, rooms, room detail, booking flow, confirmation, about, contact
9. SEO metadata per route + `llms.txt` + sitemap basics
10. QA pass on both surfaces

## Open assumptions (flag if wrong)

- Currency: USD; timezone: configurable in settings, default UTC
- No payment capture in this iteration; bookings are reservation-only
- "AI Front Office" in this build is an in-dashboard assistant, not yet a guest-facing chatbot on the public site
- WhatsApp inbox will use seeded mock data until Fonnte is connected — the schema and UI will be unchanged when we wire the real webhook
