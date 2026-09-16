-- Seed data for Paradise Freight System demo environment
-- Password for all demo users: Demo1234!
-- bcrypt hash (12 rounds) of 'Demo1234!'
-- This file is executed automatically by PostgreSQL docker-entrypoint-initdb.d

DO $$
DECLARE
  v_company_id integer;
  v_password_hash text := '$2b$12$2HyTC/tkV2C2ZDSIAfsoJOMpXFU84cfarSPwqGCu6lGRbPhmDh6T2';
BEGIN
  -- Insert the demo company
  INSERT INTO companies (name, slug, active)
  VALUES ('Paradise Freight System', 'paradise-freight-system', true)
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, active = EXCLUDED.active
  RETURNING id INTO v_company_id;

  -- Platform admin (no company)
  INSERT INTO users (name, email, password_hash, role, active, company_id)
  VALUES ('mistri360 Platform Admin', 'platform@maintiq.ca', v_password_hash, 'platform_admin', true, NULL)
  ON CONFLICT (email) DO UPDATE SET
    name = EXCLUDED.name,
    password_hash = EXCLUDED.password_hash,
    role = EXCLUDED.role,
    active = EXCLUDED.active;

  -- Company admin
  INSERT INTO users (name, email, password_hash, role, active, phone, company_id)
  VALUES ('Palwinder Singh', 'admin@paradise-freight.com', v_password_hash, 'admin', true, '647-529-3908', v_company_id)
  ON CONFLICT (email) DO UPDATE SET
    name = EXCLUDED.name,
    password_hash = EXCLUDED.password_hash,
    role = EXCLUDED.role,
    active = EXCLUDED.active,
    phone = EXCLUDED.phone,
    company_id = EXCLUDED.company_id;

  -- Manager
  INSERT INTO users (name, email, password_hash, role, active, company_id)
  VALUES ('Palwinder Singh', 'manager@paradise-freight.com', v_password_hash, 'manager', true, v_company_id)
  ON CONFLICT (email) DO UPDATE SET
    name = EXCLUDED.name,
    password_hash = EXCLUDED.password_hash,
    role = EXCLUDED.role,
    active = EXCLUDED.active,
    company_id = EXCLUDED.company_id;

  -- Mechanic
  INSERT INTO users (name, email, password_hash, role, active, company_id)
  VALUES ('Dharminder Singh', 'mechanic@paradise-freight.com', v_password_hash, 'mechanic', true, v_company_id)
  ON CONFLICT (email) DO UPDATE SET
    name = EXCLUDED.name,
    password_hash = EXCLUDED.password_hash,
    role = EXCLUDED.role,
    active = EXCLUDED.active,
    company_id = EXCLUDED.company_id;

  -- Driver
  INSERT INTO users (name, email, password_hash, role, active, company_id)
  VALUES ('Defect Reporter', 'driver@paradise-freight.com', v_password_hash, 'driver', true, v_company_id)
  ON CONFLICT (email) DO UPDATE SET
    name = EXCLUDED.name,
    password_hash = EXCLUDED.password_hash,
    role = EXCLUDED.role,
    active = EXCLUDED.active,
    company_id = EXCLUDED.company_id;

  RAISE NOTICE 'Seed data inserted successfully. Company ID: %', v_company_id;
END $$;
