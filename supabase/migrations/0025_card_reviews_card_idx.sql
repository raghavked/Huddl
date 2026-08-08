-- Huddl schema: covering index for card_reviews.card_id — the (user_id,
-- card_id) primary key can't serve card-side lookups, and card deletions
-- cascade through this column.
create index card_reviews_card_idx on public.card_reviews (card_id);
