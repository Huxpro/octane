SELECT
  s.id,
  s.name,
  s.ts / 1e6 AS ts_ms,
  s.dur / 1e6 AS dur_ms,
  COALESCE(t.name, pt.name, '') AS track_name
FROM slice s
LEFT JOIN thread_track tt ON s.track_id = tt.id
LEFT JOIN thread t ON tt.utid = t.utid
LEFT JOIN process_track ptrack ON s.track_id = ptrack.id
LEFT JOIN process pt ON ptrack.upid = pt.upid
WHERE s.name LIKE 'Issue288::%'
   OR s.name IN (
     'TouchEventHandler::HandleTouchEvent',
     'TouchEventHandler::FireEvent',
     'EventTarget::DispatchEvent'
   )
ORDER BY s.ts;
