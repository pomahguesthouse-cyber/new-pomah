CREATE TABLE IF NOT EXISTS room_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES rooms(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  status TEXT CHECK (status IN ('out_of_order', 'out_of_service', 'maintenance_block')),
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_modes (
  phone TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('guest', 'admin')),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
