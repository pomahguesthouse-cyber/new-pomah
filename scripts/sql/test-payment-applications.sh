#!/usr/bin/env bash
# Uji RPC ASLI di Postgres lokal terisolasi (data sintetis). Jangan arahkan ke produksi.
# Pakai: PGBIN=/path/to/pg/bin bash scripts/sql/test-payment-applications.sh
set -euo pipefail
DIR=$(cd "$(dirname "$0")/../.." && pwd)
PGBIN=${PGBIN:?set PGBIN}
DATA=$(mktemp -d); SOCK=$(mktemp -d); TMPD=$(mktemp -d); PORT=55439
"$PGBIN/initdb" -D "$DATA" -U postgres -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k $SOCK -c listen_addresses=''" -l "$DATA/log" -w start >/dev/null
trap '"$PGBIN/pg_ctl" -D "$DATA" -m fast stop >/dev/null; rm -rf "$DATA" "$SOCK" "$TMPD"' EXIT
Q() { psql -X -q -v ON_ERROR_STOP=1 -h "$SOCK" -p $PORT -U postgres -d postgres -At "$@"; }
fail() { echo "FAIL: $*"; exit 1; }
eq() { [ "$1" = "$2" ] || fail "$3: expected [$2] got [$1]"; }

Q -f "$DIR/scripts/sql/baseline-schema.sql"
Q -c "insert into guests(id,full_name,phone,phone_normalized) values
 ('00000000-0000-0000-0000-0000000000a1','Uji A','081900000963','6281900000963'),
 ('00000000-0000-0000-0000-0000000000a2','Uji B','+62 811-0000-0002','6281100000002');
insert into bookings(id,guest_id,reference_code,check_in,check_out,total_amount) values
 ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1','PG-T1','2099-12-01','2099-12-04',830000),
 ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000a1','PG-T2','2099-12-01','2099-12-04',830000),
 ('00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000a2','PG-T3','2099-12-01','2099-12-04',500000);
insert into invoices(booking_id,invoice_number,payment_status_snapshot) select id,'INV-'||reference_code,'unpaid' from bookings;"
BASE=$(Q -c "select string_agg(reference_code||':'||payment_status||':'||paid_amount||':'||total_amount, ',' order by reference_code) from bookings")

Q -f "$DIR/supabase/manual/20261108_payment_applications.sql"
echo "migration applied (local)"

B1=00000000-0000-0000-0000-0000000000b1; B2=00000000-0000-0000-0000-0000000000b2; B3=00000000-0000-0000-0000-0000000000b3
PH=6281900000963
apply() { Q -c "select apply_payment_proof('$1','$2','$3',gen_random_uuid(),$4,$5,'$6',$7)->>'reason'"; }
applyok() { Q -c "select coalesce(apply_payment_proof('$1','$2','$3',gen_random_uuid(),$4,$5,'$6',$7)->>'status_after','REJ')"; }

# Grants: anon/authenticated tidak bisa eksekusi/baca.
eq "$(Q -c "select has_function_privilege('anon','public.apply_payment_proof(uuid,text,text,uuid,numeric,numeric,text,numeric)','execute')")" f "anon execute"
eq "$(Q -c "select has_function_privilege('authenticated','public.claim_payment_notice(uuid,integer)','execute')")" f "auth execute"
eq "$(Q -c "select has_function_privilege('service_role','public.apply_payment_proof(uuid,text,text,uuid,numeric,numeric,text,numeric)','execute')")" t "service execute"
eq "$(Q -c "select has_table_privilege('anon','public.payment_applications','select')")" f "anon table"
eq "$(Q -c "select array_to_string(proconfig,',') from pg_proc where proname='apply_payment_proof'")" 'search_path=""' "search_path"
eq "$(Q -c "select prosecdef from pg_proc where proname='apply_payment_proof'")" t "secdef"

# Penolakan ketat
eq "$(apply $B1 $PH 'AB-12' 830000 830000 full 0)" missing_reference "ref pendek"
eq "$(apply $B1 6281111111111 'REF000001' 830000 830000 full 0)" not_owner "bukan pemilik"
eq "$(apply $B1 $PH 'REF000001' 830000 820000 full 0)" amount_mismatch "kurang bayar"
eq "$(apply $B1 $PH 'REF000001' 830000 836501 full 0)" amount_mismatch "fee > 6500"
eq "$(apply $B1 $PH 'REF000001' 800000 800000 full 0)" amount_mismatch "full bukan sisa"
eq "$(apply $B1 $PH 'REF000001' 830000 830000 dp 0)" amount_mismatch "dp = total"
eq "$(apply $B1 $PH 'REF000001' 830000 830000 full 5)" paid_amount_changed "expected paid basi"
eq "$(Q -c "select count(*) from payment_applications")" 0 "tidak ada catatan dari penolakan"

# DP → pelunasan (partial → paid), toleransi fee 6.500, total utuh
eq "$(applyok $B1 0819-0000-0963 'dp ref 0001' 415000 415000 dp 0)" partial "DP (format telp lokal)"
eq "$(Q -c "select payment_status||':'||paid_amount||':'||total_amount from bookings where id='$B1'")" "partial:415000.00:830000.00" "setelah DP"
eq "$(Q -c "select payment_status_snapshot from invoices where booking_id='$B1'")" partial "snapshot DP"
eq "$(apply $B1 $PH 'DPREF0001' 415000 415000 remaining 415000)" duplicate_reference "ref sama beda format"
eq "$(applyok $B1 $PH 'LUNAS-0002' 415000 421500 remaining 415000)" paid "pelunasan + fee 6500"
eq "$(Q -c "select payment_status||':'||paid_amount||':'||total_amount from bookings where id='$B1'")" "paid:830000.00:830000.00" "setelah lunas"
eq "$(Q -c "select transfer_fee from payment_applications where reference_norm='LUNAS0002'")" 6500.00 "fee tercatat"

# Referensi sama di booking lain → ditolak
eq "$(apply $B2 $PH 'LUNAS0002' 830000 830000 full 0)" duplicate_reference "ref lintas booking"
# source_message_id sama (retry webhook) → ditolak
MID=$(Q -c "select source_message_id from payment_applications limit 1")
eq "$(Q -c "select apply_payment_proof('$B2','$PH','NEWREF9999','$MID',830000,830000,'full',0)->>'reason'")" duplicate_reference "message id sama"
# Booking batal
Q -c "update bookings set status='cancelled' where id='$B3'"
eq "$(apply $B3 6281100000002 'CANCEL0001' 500000 500000 full 0)" booking_closed "batal"
Q -c "update bookings set status='pending' where id='$B3'"

# ── Konkurensi NYATA: transaksi paralel ──────────────────────────────────────
# (a) Dua referensi berbeda, booking sama, bersamaan (sesi 1 tahan lock 2 dtk).
( Q -c "begin; select apply_payment_proof('$B2','$PH','CONC-A-0001',gen_random_uuid(),830000,830000,'full',0)->>'reason'; select pg_sleep(2); commit;" > $TMPD/pa_c1 ) &
sleep 0.5
( Q -c "select apply_payment_proof('$B2','$PH','CONC-B-0002',gen_random_uuid(),830000,830000,'full',0)->>'reason'" > $TMPD/pa_c2 ) &
wait
eq "$(Q -c "select count(*) from payment_applications where booking_id='$B2'")" 1 "konkuren beda ref: 1 tercatat"
eq "$(Q -c "select paid_amount from bookings where id='$B2'")" 830000.00 "konkuren: paid tidak dobel"
grep -q paid_amount_changed $TMPD/pa_c1 $TMPD/pa_c2 || fail "sesi kedua harus paid_amount_changed"

# (b) Referensi sama, booking BERBEDA, bersamaan → indeks unik menahan sesi 2.
( Q -c "begin; select apply_payment_proof('$B3','6281100000002','SAME-REF-77',gen_random_uuid(),250000,250000,'dp',0)->>'status_after'; select pg_sleep(2); commit;" > $TMPD/pa_d1 ) &
sleep 0.5
Q -c "update bookings set paid_amount=0, payment_status='unpaid' where id='$B2'"  # buka B2 lagi untuk uji
Q -c "delete from payment_applications where booking_id='$B2'"
( Q -c "select apply_payment_proof('$B2','$PH','same ref 77',gen_random_uuid(),830000,830000,'full',0)->>'reason'" > $TMPD/pa_d2 ) &
wait
eq "$(cat $TMPD/pa_d2)" duplicate_reference "konkuren ref sama lintas booking"
eq "$(Q -c "select paid_amount from bookings where id='$B2'")" 0.00 "B2 tidak berubah"

# (c) 8 klaim paralel referensi sama, booking sama → tepat 1.
Q -c "update bookings set paid_amount=0, payment_status='unpaid' where id='$B2'"
for i in $(seq 1 8); do ( Q -c "select apply_payment_proof('$B2','$PH','STORM-0001',gen_random_uuid(),830000,830000,'full',0)->>'ok'" >> $TMPD/pa_storm ) & done; wait
eq "$(grep -c true $TMPD/pa_storm)" 1 "storm: 1 sukses"
eq "$(Q -c "select paid_amount from bookings where id='$B2'")" 830000.00 "storm: paid sekali"
rm -f $TMPD/pa_c1 $TMPD/pa_c2 $TMPD/pa_d1 $TMPD/pa_d2 $TMPD/pa_storm

# ── Outbox notifikasi: lease, token, batas 5 ─────────────────────────────────
APP=$(Q -c "select id from payment_applications where reference_norm='STORM0001'")
T1=$(Q -c "select claim_payment_notice('$APP',300)")
[ -n "$T1" ] || fail "klaim pertama"
eq "$(Q -c "select claim_payment_notice('$APP',300) is null")" t "klaim ganda ditolak selama lease"
eq "$(Q -c "select finish_payment_notice('$APP',gen_random_uuid(),'sent')")" f "token salah tidak bisa menyelesaikan"
# Simulasi crash setelah kirim: lease habis → bisa diklaim ulang (at-least-once).
Q -c "update payment_applications set notice_lease_until=now()-interval '1 second' where id='$APP'"
T2=$(Q -c "select claim_payment_notice('$APP',300)")
[ -n "$T2" ] && [ "$T2" != "$T1" ] || fail "reclaim setelah lease"
eq "$(Q -c "select finish_payment_notice('$APP','$T1','sent')")" f "worker lama (token basi) ditolak"
eq "$(Q -c "select finish_payment_notice('$APP','$T2','sent')")" t "finish token benar"
eq "$(Q -c "select claim_payment_notice('$APP',300) is null")" t "sudah sent: tidak diklaim lagi"
# Batas 5 percobaan gagal
APP2=$(Q -c "select id from payment_applications where reference_norm='LUNAS0002'")
for i in 1 2 3 4 5; do T=$(Q -c "select claim_payment_notice('$APP2',300)"); Q -c "select finish_payment_notice('$APP2','$T','failed','meta down')" >/dev/null; done
eq "$(Q -c "select claim_payment_notice('$APP2',300) is null")" t "maks 5 percobaan"
eq "$(Q -c "select notice_attempts||':'||notice_status from payment_applications where id='$APP2'")" "5:failed" "attempts"
# Klaim notifikasi manual (admin)
K="$B1:paid:830000"
S1=$(Q -c "select claim_payment_status_notice('$K','$B1',300)")
eq "$(Q -c "select claim_payment_status_notice('$K','$B1',300) is null")" t "manual: klaim ganda"
eq "$(Q -c "select finish_payment_status_notice('$K','$S1',true)")" t "manual finish"
eq "$(Q -c "select claim_payment_status_notice('$K','$B1',300) is null")" t "manual: sudah terkirim"
# Paralel klaim manual
for i in $(seq 1 6); do ( Q -c "select claim_payment_status_notice('k2','$B1',300) is not null" >> $TMPD/pa_m ) & done; wait
eq "$(grep -c t $TMPD/pa_m)" 1 "manual paralel: 1 klaim"; rm -f $TMPD/pa_m

# ── Rollback → kembali ke baseline ───────────────────────────────────────────
Q -c "with s as (select booking_id, sum(amount) amt from payment_applications group by booking_id)
update bookings b set paid_amount=greatest(0,b.paid_amount-s.amt),
  payment_status=(case when b.paid_amount-s.amt<=0 then 'unpaid' when b.paid_amount-s.amt>=b.total_amount then 'paid' else 'partial' end)::payment_status
 from s where s.booking_id=b.id"
Q -f "$DIR/supabase/manual/20261108_payment_applications_rollback.sql"
eq "$(Q -c "select string_agg(reference_code||':'||payment_status||':'||paid_amount||':'||total_amount, ',' order by reference_code) from bookings")" "$BASE" "baseline setelah rollback"
eq "$(Q -c "select to_regclass('public.payment_applications') is null and to_regclass('public._archive_payment_applications_20261108') is not null")" t "tabel diarsipkan"
eq "$(Q -c "select count(*) from guests")" 2 "data lama utuh"
# Migrasi bisa dijalankan ulang setelah rollback
Q -f "$DIR/supabase/manual/20261108_payment_applications.sql" >/dev/null
eq "$(Q -c "select to_regclass('public.payment_applications') is not null")" t "re-apply setelah rollback"
echo "SQL payment_applications: ALL PASS"
