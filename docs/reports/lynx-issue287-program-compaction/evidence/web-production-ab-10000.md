# Lynx 10,000-row production FCP baseline/candidate A/B

- measured: 2026-09-07T12:22:43.303Z
- host: 32× Intel(R) Xeon(R) Platinum 8336C CPU @ 2.30GHz; linux 5.15.120.bsk.3-amd64; Node v22.22.2; Chromium 149.0.7827.55
- protocol: fresh page per sample; production baseline/candidate order alternates AB/BA; neither cell reads profiler state
- repetitions: n=5 per baseline/candidate cell
- threshold: public contentCount>=5; settled finalRows=10000; finalCount=20000; checksum=996039633
- baseline: /data00/home/xuan.huang/.codex/worktrees/68ea/octane-issue287/benchmarks/lynx-table/app/dist-mtsprogram-base287compact-rows10000/main.web.bundle (582545 B, sha256 32949a6a899ef52d7949cf45d7ac1b81f6ef9205463cf40ba025227a99837f37)
- candidate: /data00/home/xuan.huang/.codex/worktrees/68ea/octane-issue287-compact/benchmarks/lynx-table/app/dist-mtsprogram-cand287head-rows10000/main.web.bundle (594311 B, sha256 1514e8e95491d43754306b7d94eeb516296a90ebada4b6e79662659410681e9b)

| metric | baseline median (min–max) | candidate median (min–max) | candidate/baseline |
|---|---:|---:|---:|
| FCP | 835.2 (807.2–950.6) ms | 860.8 (815.9–883.2) ms | 1.031× |
| settled | 835.2 (807.2–950.6) ms | 860.8 (815.9–883.2) ms | 1.031× |
