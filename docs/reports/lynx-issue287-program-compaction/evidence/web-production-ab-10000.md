# Lynx 10,000-row production FCP baseline/candidate A/B

- measured: 2026-09-07T13:17:53.256Z
- host: 32× Intel(R) Xeon(R) Platinum 8336C CPU @ 2.30GHz; linux 5.15.120.bsk.3-amd64; Node v22.22.2; Chromium 149.0.7827.55
- protocol: fresh page per sample; production baseline/candidate order alternates AB/BA; neither cell reads profiler state
- repetitions: n=5 per baseline/candidate cell
- threshold: public contentCount>=5; settled finalRows=10000; finalCount=20000; checksum=996039633
- baseline: /data00/home/xuan.huang/.codex/worktrees/68ea/octane-issue287-compact/benchmarks/lynx-table/app/dist-mtsprogram-base287compact-rows10000/main.web.bundle (582545 B, sha256 32949a6a899ef52d7949cf45d7ac1b81f6ef9205463cf40ba025227a99837f37)
- candidate: /data00/home/xuan.huang/.codex/worktrees/68ea/octane-issue287-compact/benchmarks/lynx-table/app/dist-mtsprogram-cand287-8d834fb-rows10000/main.web.bundle (594553 B, sha256 a3481c540576d93097fbf49b35ffea91811dee2ff681297cceccedf1fc43752b)

| metric | baseline median (min–max) | candidate median (min–max) | candidate/baseline |
|---|---:|---:|---:|
| FCP | 843.7 (800.5–873.6) ms | 821.6 (781.7–838.8) ms | 0.974× |
| settled | 843.7 (800.5–873.6) ms | 821.6 (781.7–838.8) ms | 0.974× |
