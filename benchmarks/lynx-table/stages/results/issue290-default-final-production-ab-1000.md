# Lynx 1,000-row production FCP baseline/candidate A/B

- measured: 2026-09-11T10:28:17.747Z
- host: 32× Intel(R) Xeon(R) Platinum 8336C CPU @ 2.30GHz; linux 5.15.120.bsk.3-amd64; Node v22.22.2; Chromium 149.0.7827.55
- protocol: fresh page per sample; production baseline/candidate order alternates AB/BA; neither cell reads profiler state
- repetitions: n=7 per baseline/candidate cell
- threshold: all rowCount=1000; settled finalRows=1000; finalCount=2000; checksum=1150422098
- baseline: /data00/home/xuan.huang/.codex/tmp/octane-290-base/benchmarks/lynx-table/app/dist-automatic-rows1000/main.web.bundle (552965 B, sha256 63e0adba33fe2c4a426cc6e7507ddc568b80943ad78ada5d0bc66c8bae348278)
- candidate: /data00/home/xuan.huang/.codex/worktrees/68ea/octane/benchmarks/lynx-table/app/dist-automatic-rows1000/main.web.bundle (433485 B, sha256 181fa1ac3e3ae9d7a59bba5f782196d00c8d644105d9049b56bde7e456b1f32f)

| metric | baseline median (min–max) | candidate median (min–max) | candidate/baseline |
|---|---:|---:|---:|
| FCP | 150.7 (148.1–181.5) ms | 151.3 (146–189.1) ms | 1.004× |
| settled | 150.7 (148.1–181.5) ms | 151.3 (146–189.1) ms | 1.004× |

