ALTER TABLE "Issue"
ADD COLUMN "designJson" JSONB;

UPDATE "Issue" AS issue
SET "designJson" = design.design
FROM (
    SELECT
        page."issueId",
        jsonb_build_object(
            'width', COALESCE(
                (array_agg(page."designJson" -> 'width' ORDER BY page."pageNumber")
                    FILTER (WHERE page."designJson" IS NOT NULL))[1],
                '850'::jsonb
            ),
            'height', COALESCE(
                (array_agg(page."designJson" -> 'height' ORDER BY page."pageNumber")
                    FILTER (WHERE page."designJson" IS NOT NULL))[1],
                '1100'::jsonb
            ),
            'fonts', COALESCE(
                (array_agg(page."designJson" -> 'fonts' ORDER BY page."pageNumber")
                    FILTER (WHERE page."designJson" IS NOT NULL))[1],
                '[]'::jsonb
            ),
            'pages', jsonb_agg(
                CASE
                    WHEN page."designJson" IS NOT NULL
                         AND jsonb_typeof(page."designJson" -> 'pages' -> 0) = 'object'
                    THEN jsonb_set(
                        page."designJson" -> 'pages' -> 0,
                        '{id}',
                        to_jsonb(page."id"),
                        true
                    ) || jsonb_build_object(
                        'custom',
                        COALESCE(page."designJson" -> 'pages' -> 0 -> 'custom', '{}'::jsonb)
                        || jsonb_build_object(
                            'bestAgentMedia',
                            jsonb_build_object(
                                'issuePageId', page."id",
                                'pageType', page."type"::text
                            )
                        )
                    )
                    ELSE jsonb_build_object(
                        'id', page."id",
                        'children', '[]'::jsonb,
                        'custom', jsonb_build_object(
                            'bestAgentMedia',
                            jsonb_build_object(
                                'issuePageId', page."id",
                                'pageType', page."type"::text
                            )
                        )
                    )
                END
                ORDER BY page."pageNumber"
            ),
            'schemaVersion', 3,
            'unit', 'px',
            'dpi', 72
        ) AS design
    FROM "IssuePage" AS page
    GROUP BY page."issueId"
) AS design
WHERE issue."id" = design."issueId";

ALTER TABLE "IssuePage"
DROP COLUMN "designJson";
