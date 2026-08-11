-- Connect money received to the account it landed in.
--
-- Banking was a closed island. bank_transactions had tenant_id and account_id
-- and nothing else — no way to say "this line on the statement IS that customer
-- payment". So with 109 payments recorded, the banking module still showed an
-- empty ledger, and the only way to make the two agree was to retype every
-- payment by hand and hope nobody typed one twice.
--
-- The consequence is worse than duplicated effort: the two halves disagreed
-- silently. Invoices said a customer had paid; the bank balance did not move.
-- Nothing in the system could tell you which payments had actually cleared.

ALTER TABLE payments
  -- Which account the money went into. NULL = not reconciled to a bank yet,
  -- which is the honest default for cash or anything recorded before this
  -- existed — better than guessing an account and inventing a balance.
  ADD COLUMN bank_account_id INT NULL AFTER client_id;

ALTER TABLE bank_transactions
  -- The payment this statement line represents. NULL = a genuine bank movement
  -- with no counterpart in the app yet (fees, transfers, a customer payment not
  -- recorded), which is exactly what the reconciliation screen exists to show.
  ADD COLUMN payment_id INT UNSIGNED NULL AFTER account_id;

-- One payment can produce at most ONE bank line. This is the constraint that
-- makes double-counting impossible: without it, a retried request or two people
-- reconciling at once would credit the same money to the balance twice, and a
-- bank balance that overstates cash is worse than no balance at all.
CREATE UNIQUE INDEX idx_bank_tx_payment ON bank_transactions (tenant_id, payment_id);

-- "What is still unreconciled?" runs on every visit to the banking screen.
CREATE INDEX idx_payments_bank ON payments (tenant_id, bank_account_id);
