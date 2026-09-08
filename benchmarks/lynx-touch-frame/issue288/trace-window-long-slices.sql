WITH bounds AS (
  SELECT
    MIN(CASE WHEN name LIKE 'Issue288::%::mts-input' THEN ts END) AS start_ts,
    MAX(CASE WHEN name LIKE 'Issue288::%::changed-vsync' THEN ts END) AS end_ts
  FROM slice
)
SELECT
  s.id,
  s.parent_id,
  s.name,
  s.ts / 1e6 AS ts_ms,
  s.dur / 1e6 AS dur_ms,
  t.name AS thread_name,
  s.depth
FROM slice s
JOIN thread_track tt ON s.track_id = tt.id
JOIN thread t ON tt.utid = t.utid
CROSS JOIN bounds b
WHERE s.ts >= b.start_ts
  AND s.ts <= b.end_ts
  AND s.dur >= 5e6
  AND t.name IN ('Lynx_JS', 'm.lynx.explorer', 'RenderThread')
ORDER BY s.ts, s.depth;
