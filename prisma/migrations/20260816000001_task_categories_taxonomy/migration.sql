-- Data migration: `tasks.categories` becomes a taxonomy, not a label list.
--
-- Phase 4 gives `Task.categoryId` (SPEC §4) something stable to point at, so
-- the setting changed from
--     ["تصميم", "تطوير", …]
-- to
--     [{"id": "design", "label": "تصميم"}, …]
--
-- The seed deliberately never overwrites an existing `Setting` row ("filling
-- gaps only, so re-running it after go-live cannot silently reset a grace
-- period"), which means an already-seeded database would keep the old shape
-- forever. `lib/settings` Zod-validates on *read*, so that row would start
-- throwing the moment anyone opened the task form. Hence a data migration
-- rather than a note in the changelog.
--
-- Labels that match a seeded default keep the meaningful id, so a migrated
-- database and a freshly seeded one agree. Anything an operator added gets a
-- positional `category-N`. `ROW_NUMBER()` guarantees the ids come out unique
-- even if two categories somehow shared a label — the old schema allowed that,
-- and the new one rejects duplicate ids.
--
-- Nothing references these ids yet: `tasks.categoryId` is created by the
-- migration immediately before this one, so no rows can exist to re-point.

UPDATE "settings" AS s
SET "value" = rebuilt.value
FROM (
    SELECT
        jsonb_agg(
            jsonb_build_object('id', mapped.id, 'label', mapped.label)
            ORDER BY mapped.ord
        ) AS value
    FROM (
        SELECT
            elem.ord,
            elem.value AS label,
            CASE
                WHEN known.id IS NOT NULL
                     AND ROW_NUMBER() OVER (
                         PARTITION BY elem.value ORDER BY elem.ord
                     ) = 1
                THEN known.id
                ELSE 'category-' || elem.ord::text
            END AS id
        FROM "settings" AS src
        CROSS JOIN LATERAL jsonb_array_elements_text(src."value")
            WITH ORDINALITY AS elem(value, ord)
        LEFT JOIN (
            VALUES
                ('تصميم', 'design'),
                ('تطوير', 'development'),
                ('محتوى', 'content'),
                ('تسويق', 'marketing'),
                ('مونتاج', 'video'),
                ('إدارة', 'management')
        ) AS known(label, id) ON known.label = elem.value
        WHERE src."key" = 'tasks.categories'
    ) AS mapped
) AS rebuilt
WHERE s."key" = 'tasks.categories'
  AND jsonb_typeof(s."value") = 'array'
  -- Only rewrite the old shape. Re-running against the new shape is a no-op,
  -- and a row already holding objects is left exactly as it is.
  AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(s."value") AS e
      WHERE jsonb_typeof(e) = 'string'
  );
