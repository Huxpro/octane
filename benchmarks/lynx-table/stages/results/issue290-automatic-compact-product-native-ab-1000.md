# Issue #290 automatic compact product — Native acceptance

- Base: `22dc9014bc3572c8cc04889a396f6d5428fc96d7`
- Candidate: `25abe4d35e43d694bed1faf1adbf181bc6edd935`
- Runtime: Android Aries 10, LynxExplorer 4.1.0
- Protocol: fresh-page production bundles, real Native tap, visible-tree postconditions
- Order: five interleaved AB/BA repetitions per cell
- Coverage: 60/60 completed, zero DNF
- Capture SHA-256: `e24b7226acf33921615db1385425f3fc3af3638b916ca4bbad7eb5d27d36af0a`
- Checked-in, Prettier-normalized JSON SHA-256: `aa2e766c3eac5695d2392a81b915dd9075ccdece997fb631b7c51717fe98cf61`

| Cell | Base samples (ms) | Candidate samples (ms) | Base median | Candidate median | Ratio |
| --- | --- | --- | ---: | ---: | ---: |
| startup@0 | 225, 189, 189, 185, 187 | 151, 143, 113, 139, 122 | 189 | 139 | 0.735x |
| startup@1000 | 1208, 1156, 1346, 1149, 1346 | 1218, 994, 1033, 986, 1084 | 1208 | 1033 | 0.855x |
| create@1000 | 1111, 1108, 1142, 1118, 1173 | 927, 759, 814, 780, 909 | 1118 | 814 | 0.728x |
| update10th@1000 | 155, 162, 161, 158, 158 | 78, 65, 61, 57, 58 | 158 | 61 | 0.386x |
| select@1000 | 78, 79, 78, 93, 88 | 31, 31, 22, 22, 29 | 79 | 29 | 0.367x |
| clear@1000 | 105, 95, 111, 110, 94 | 128, 76, 92, 77, 78 | 105 | 78 | 0.743x |

The candidate publishes the actual Element PAPI tree before acknowledgement. The
measured boundary therefore includes native creation, insertion, mutation, and
flush work; it is not a background-state proxy. The candidate artifacts are:

- rows 0: 184,457 bytes, SHA-256 `e7fca720ee7225547a070006c2fa40eb0370c2baa4d040d362d16e2fa4e2f8ab`
- rows 1000: 184,752 bytes, SHA-256 `ab1732e414d6719f2daef9d3cc4591cbfb0447bc6891f403f2b19eb3c2dd8cea`
