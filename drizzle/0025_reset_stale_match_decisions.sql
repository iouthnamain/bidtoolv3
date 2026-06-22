-- Reset accepted match decisions that should be pending again:
-- low confidence auto-accepts or matches pointing at deleted materials.
UPDATE "material_match_decisions" AS d
SET
  "status" = 'pending',
  "reviewed_at" = NULL
WHERE d."status" = 'accepted'
  AND d."confidence"::numeric < 0.85
  AND (
    d."matched_material_id" IS NULL
    OR EXISTS (
      SELECT 1
      FROM "materials" AS m
      WHERE m."id" = d."matched_material_id"
        AND m."deleted_at" IS NOT NULL
    )
  );
