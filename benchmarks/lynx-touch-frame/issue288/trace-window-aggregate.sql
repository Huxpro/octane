WITH bounds AS (
  SELECT
    MIN(CASE WHEN name LIKE 'Issue288::%::mts-input' THEN ts END) AS start_ts,
    MAX(CASE WHEN name LIKE 'Issue288::%::changed-vsync' THEN ts END) AS end_ts
  FROM slice
), window_slices AS (
  SELECT s.*, t.name AS thread_name
  FROM slice s
  JOIN thread_track tt ON s.track_id = tt.id
  JOIN thread t ON tt.utid = t.utid
  CROSS JOIN bounds b
  WHERE s.ts >= b.start_ts
    AND s.ts <= b.end_ts
    AND t.name IN ('Lynx_JS', 'm.lynx.explorer', 'RenderThread')
)
SELECT
  thread_name,
  name,
  COUNT(*) AS count,
  SUM(dur) / 1e6 AS total_ms,
  MAX(dur) / 1e6 AS max_ms
FROM window_slices
GROUP BY thread_name, name
HAVING SUM(dur) >= 1e6
ORDER BY total_ms DESC
LIMIT 250;
