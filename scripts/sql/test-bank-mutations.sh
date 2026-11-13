#!/usr/bin/env bash
# Uji RPC mutasi ASLI di Postgres lokal terisolasi (data sintetis). Jangan arahkan ke produksi.
# Pakai: PGBIN=/path/to/pg/bin bash scripts/sql/test-bank-mutations.sh
set -euo pipefail
DIR=$(cd "$(dirname "$0")/../.." && pwd)
PGBIN=${PGBIN:?set PGBIN}
DATA=$(mktemp -d); SOCK=$(mktemp -d); TMPD=$(mktemp -d); PORT=55441
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
 ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000a1','PG-T2','2099-12-01','2099-12-04',830000);
insert into invoices(booking_id,invoice_number,payment_status_snapshot) select id,'INV-'||reference_code,'unpaid' from bookings;"

Q -f "$DIR/supabase/manual/20261108_payment_applications.sql"
Q -f "$DIR/supabase/manual/20261113_bank_mutations.sql"
echo "migrations applied (local)"

B1=00000000-0000-0000-0000-0000000000b1
B2=00000000-0000-0000-0000-0000000000b2
PH=6281900000963
P1=00000000-0000-0000-0000-0000000000c1
MID=00000000-0000-0000-0000-0000000000d1

eq "$(Q -c "select has_function_privilege('anon','public.apply_payment_with_mutation(uuid,text,text,uuid,numeric,numeric,text,numeric,text,uuid)','execute')")" f "anon execute"
eq "$(Q -c "select has_function_privilege('service_role','public.apply_payment_with_mutation(uuid,text,text,uuid,numeric,numeric,text,numeric,text,uuid)','execute')")" t "service execute"
eq "$(Q -c "select has_table_privilege('anon','public.bank_mutations','select')")" f "anon table"
eq "$(Q -c "select array_to_string(proconfig,',') from pg_proc where proname='apply_payment_with_mutation'")" 'search_path=""' "search_path"

# Insert mutasi kredit
Q -c "insert into bank_mutations(mutation_id, account_number, mutation_date, description, amount, type, match_status)
 values ('mutA0000001','0095584379', now(), 'TRSF PG-T1', 830000, 'CR', 'unmatched'),
        ('mutDB0000001','0095584379', now(), 'TARIKAN', 10000, 'DB', 'ignored_debit'),
        ('mutB0000002','0095584379', now(), 'TRSF', 830000, 'CR', 'unmatched');"

# Debit ditolak
eq "$(Q -c "select apply_payment_with_mutation('$B1','$PH','REF000001','$MID',830000,830000,'full',0,'mutDB0000001',null)->>'reason'")" ignored_debit "debit"

# Kurang bayar
eq "$(Q -c "select apply_payment_with_mutation('$B1','$PH','REF000001','$MID',830000,829000,'full',0,'mutA0000001',null)->>'reason'")" amount_mismatch "underpay"

# Apply sukses + pending
Q -c "insert into payment_proof_pending(id,message_id,booking_id,booking_code,phone,reference_no,reference_norm,amount,received_amount,kind,expected_paid)
 values ('$P1','$MID','$B1','PG-T1','$PH','REF-000001','REF000001',830000,836500,'full',0);"
eq "$(Q -c "select apply_payment_with_mutation('$B1','$PH','REF-000001','$MID',830000,836500,'full',0,'mutA0000001','$P1')->>'status_after'")" paid "apply + fee"
eq "$(Q -c "select payment_status||':'||paid_amount||':'||total_amount from bookings where id='$B1'")" "paid:830000.00:830000.00" "paid after apply"
eq "$(Q -c "select match_status from bank_mutations where mutation_id='mutA0000001'")" matched "mutation matched"
eq "$(Q -c "select status from payment_proof_pending where id='$P1'")" applied "pending applied"
eq "$(Q -c "select mutation_id from payment_applications where reference_norm='REF000001'")" mutA0000001 "linked"

# Replay mutasi
eq "$(Q -c "select apply_payment_with_mutation('$B1','$PH','REF000099',gen_random_uuid(),830000,830000,'full',0,'mutA0000001',null)->>'reason'")" duplicate_mutation "replay mutation"

# Referensi sama
eq "$(Q -c "select apply_payment_with_mutation('$B2','$PH','REF 000001',gen_random_uuid(),830000,830000,'full',0,'mutB0000002',null)->>'reason'")" duplicate_reference "same ref"

# Konkurensi: dua sesi, mutasi berbeda, booking sama
( Q -c "begin; select apply_payment_with_mutation('$B2','$PH','CONC-A-0001',gen_random_uuid(),830000,830000,'full',0,'mutB0000002',null)->>'reason'; select pg_sleep(2); commit;" > $TMPD/bm_c1 ) &
sleep 0.5
Q -c "insert into bank_mutations(mutation_id, amount, type, match_status) values ('mutC0000003',830000,'CR','unmatched')"
( Q -c "select apply_payment_with_mutation('$B2','$PH','CONC-B-0002',gen_random_uuid(),830000,830000,'full',0,'mutC0000003',null)->>'reason'" > $TMPD/bm_c2 ) &
wait
eq "$(Q -c "select count(*) from payment_applications where booking_id='$B2'")" 1 "konkuren: 1 tercatat"
eq "$(Q -c "select paid_amount from bookings where id='$B2'")" 830000.00 "konkuren: paid tidak dobel"
grep -q paid_amount_changed $TMPD/bm_c1 $TMPD/bm_c2 || fail "sesi kedua harus paid_amount_changed"

# 8 klaim paralel mutasi sama
Q -c "update bookings set paid_amount=0, payment_status='unpaid' where id='$B2'"
Q -c "delete from payment_applications where booking_id='$B2'"
Q -c "update bank_mutations set match_status='unmatched', payment_application_id=null where mutation_id='mutB0000002'"
for i in $(seq 1 8); do ( Q -c "select apply_payment_with_mutation('$B2','$PH','STORM-0001',gen_random_uuid(),830000,830000,'full',0,'mutB0000002',null)->>'ok'" >> $TMPD/bm_storm ) & done; wait
eq "$(grep -c true $TMPD/bm_storm)" 1 "storm: 1 sukses"
eq "$(Q -c "select paid_amount from bookings where id='$B2'")" 830000.00 "storm: paid sekali"
eq "$(Q -c "select match_status from bank_mutations where mutation_id='mutB0000002'")" matched "storm mutation matched"

# Rollback mengarsipkan tabel baru
Q -f "$DIR/supabase/manual/20261113_bank_mutations_rollback.sql"
eq "$(Q -c "select to_regclass('public.bank_mutations') is null and to_regclass('public._archive_bank_mutations_20261113') is not null")" t "tabel diarsipkan"
eq "$(Q -c "select to_regclass('public.apply_payment_proof') is not null")" t "RPC lama tetap ada"
# Re-apply
Q -f "$DIR/supabase/manual/20261113_bank_mutations.sql" >/dev/null
eq "$(Q -c "select to_regclass('public.bank_mutations') is not null")" t "re-apply setelah rollback"
echo "SQL bank_mutations: ALL PASS"
