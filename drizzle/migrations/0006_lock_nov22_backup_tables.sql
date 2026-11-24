ALTER TABLE public._bak_bsh8p_rooms_20261122 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._bak_bsh8p_rooms_20261122 FROM anon, authenticated;

ALTER TABLE public._bak_bsh8p_bookings_20261122 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._bak_bsh8p_bookings_20261122 FROM anon, authenticated;

ALTER TABLE public._bak_wa_state_susilo_20261122 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._bak_wa_state_susilo_20261122 FROM anon, authenticated;

ALTER TABLE public._bak_bsh8p_guest_20261122 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._bak_bsh8p_guest_20261122 FROM anon, authenticated;