CREATE TABLE property_managers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'booking_manager', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, phone)
);

-- Enable RLS
ALTER TABLE property_managers ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view managers
CREATE POLICY "Authenticated users can view property managers"
ON property_managers
FOR SELECT
TO authenticated
USING (true);

-- Allow authenticated users to insert/update/delete managers
CREATE POLICY "Authenticated users can manage property managers"
ON property_managers
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
