UPDATE "collection_state"
SET
  "game_claims_last_indexed_block" = LEAST("game_claims_last_indexed_block", 25066641),
  "updated_at" = now()
WHERE
  "id" = 1
  AND "game_claims_last_indexed_block" > 25066641;
