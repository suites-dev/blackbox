CREATE TABLE users (
  user_id text PRIMARY KEY,
  tier text NOT NULL CHECK (tier = 'pro'),
  execution_path text NOT NULL CHECK (execution_path IN ('full', 'local-only'))
);

CREATE TABLE subscriptions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(user_id),
  tier text NOT NULL,
  status text NOT NULL CHECK (status = 'active'),
  payment_intent_id text,
  order_id text
);

CREATE TABLE fraud_audit (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  decision text NOT NULL,
  hint_profile text NOT NULL
);

INSERT INTO users (user_id, tier, execution_path) VALUES
  ('alice', 'pro', 'full'),
  ('bob', 'pro', 'full'),
  ('carol', 'pro', 'full'),
  ('dora', 'pro', 'local-only'),
  ('eve', 'pro', 'local-only');
