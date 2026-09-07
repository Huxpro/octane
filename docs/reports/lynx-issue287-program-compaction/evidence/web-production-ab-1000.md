# Lynx 1,000-row production FCP baseline/candidate A/B

- measured: 2026-09-07T13:17:10.135Z
- host: 32× Intel(R) Xeon(R) Platinum 8336C CPU @ 2.30GHz; linux 5.15.120.bsk.3-amd64; Node v22.22.2; Chromium 149.0.7827.55
- protocol: fresh page per sample; production baseline/candidate order alternates AB/BA; neither cell reads profiler state
- repetitions: n=5 per baseline/candidate cell
- threshold: public contentCount>=5; settled finalRows=1000; finalCount=2000; checksum=1150422098
- baseline: /data00/home/xuan.huang/.codex/worktrees/68ea/octane-issue287-compact/benchmarks/lynx-table/app/dist-mtsprogram-base287compact-rows1000/main.web.bundle (582545 B, sha256 349ee799dc274fab6ce7e1b3949f87ff11ff5d4b3461691f53feb9cf5109c72a)
- candidate: /data00/home/xuan.huang/.codex/worktrees/68ea/octane-issue287-compact/benchmarks/lynx-table/app/dist-mtsprogram-cand287-8d834fb-rows1000/main.web.bundle (594553 B, sha256 9501d5e040cf5e24a5a8e6d28b1557f9be79acbdc2014eb336a3dd291764363f)

| metric | baseline median (min–max) | candidate median (min–max) | candidate/baseline |
|---|---:|---:|---:|
| FCP | 142.6 (142.3–146.1) ms | 145.1 (143.2–151.8) ms | 1.018× |
| settled | 142.6 (142.3–146.1) ms | 145.1 (143.2–151.8) ms | 1.018× |
