CREATE TABLE payment_intent (
  id text PRIMARY KEY,
  status text NOT NULL CHECK (status = 'succeeded')
);
