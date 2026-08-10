# Lynx S3 attribution report

## Provenance

- Raw inputs: `heap-raw.json.gz`, `cpu-raw.json.gz`, `cold-raw.json.gz`, `storm-raw.json.gz`, `reference-raw.json.gz`, `control-raw.json.gz`
- The diagnostic `latest.json` cited by issue #23 was not present in the repository, issue attachments, or local workspace; its quoted values are treated as an unverified trigger, not substituted for fresh samples.
- Fresh realms, explicit CDP GC, sample order, host versions, runner options, commit SHAs, and bundle SHA-256 values are preserved in the raw inputs.

## Retained heap

| head  | bytes/row slope | 1k median MiB | 10k median MiB | 30k median MiB | released |
| ----- | --------------: | ------------: | -------------: | -------------: | -------- |
| main  |           13634 |          13.5 |          135.2 |          391.6 | yes      |
| pr-1  |           13601 |          13.5 |          134.9 |          390.7 | yes      |
| pr-10 |           13601 |          13.5 |          134.9 |          390.7 | yes      |
| pr-11 |           13601 |          13.5 |          134.9 |          390.7 | yes      |
| pr-12 |           14187 |          14.1 |          140.5 |          407.5 | yes      |
| pr-13 |           14188 |          14.1 |          140.5 |          407.5 | yes      |
| pr-14 |           15075 |          14.9 |          149.7 |          433.1 | yes      |
| pr-15 |           15075 |          14.9 |          149.7 |          433.0 | yes      |
| pr-22 |           15075 |          14.9 |          149.7 |          433.1 | yes      |

Retained-heap ≥15% gate: **not reproduced**.

## Create @ 10k CPU

| head  | wall median ms | BTS active ms | MTS active ms | named BTS share |
| ----- | -------------: | ------------: | ------------: | --------------: |
| main  |         3274.8 |         906.4 |        2467.2 |           73.8% |
| pr-1  |         3150.0 |         895.4 |        2374.5 |           71.2% |
| pr-10 |         3174.3 |         902.8 |        2393.8 |           70.1% |
| pr-11 |         3125.6 |         880.5 |        2386.1 |           71.1% |
| pr-12 |         3025.4 |         885.0 |        2249.5 |           89.0% |
| pr-13 |         2989.7 |         897.8 |        2245.6 |           82.9% |
| pr-14 |         2792.1 |         857.7 |        2081.2 |           87.4% |
| pr-15 |         2818.5 |         879.3 |        2099.1 |           82.8% |
| pr-22 |         2784.6 |         880.9 |        2057.6 |           81.8% |

Named-stage ≥80% gate at #22: **pass**.

### Observer-effect controls

| head  | heap slope profile/control | BTS active profile/control | cold create first profile/control |
| ----- | -------------------------: | -------------------------: | --------------------------------: |
| main  |              13634 / 13633 |              906.4 / 849.1 |                     360.8 / 361.5 |
| pr-22 |              15075 / 15075 |              880.9 / 865.4 |                     328.3 / 334.2 |

## Cold versus steady at #22

| operation  | first median ms | steady median ms | ratio | excess ms | semantic |
| ---------- | --------------: | ---------------: | ----: | --------: | -------- |
| swap       |            84.7 |             71.7 | 1.18× |      13.0 | pass     |
| replace    |           392.2 |            335.6 | 1.17× |      56.6 | pass     |
| create     |           328.3 |            255.2 | 1.29× |      73.1 | pass     |
| clear      |            76.4 |             60.2 | 1.27× |      16.2 | pass     |
| select     |            32.3 |             21.4 | 1.51× |      10.9 | pass     |
| update10th |            42.1 |             30.5 | 1.38× |      11.6 | pass     |

Cold ≥15% adjacent-head gate: **triggered at pr-12**.

## Reference cells

| cell      | heap slope bytes/row | BTS create@10k ms | #22 heap ratio | #22 BTS ratio |
| --------- | -------------------: | ----------------: | -------------: | ------------: |
| vue-vdom  |                 5256 |             296.5 |          2.87× |         2.97× |
| vue-vapor |                 8420 |             389.6 |          1.79× |         2.26× |
| react     |                 2987 |             198.4 |          5.05× |         4.44× |

## Storm semantics at #22

| operation   | wall median ms | presentation commits | changed rows | wire commits | wire commands | semantic |
| ----------- | -------------: | -------------------: | -----------: | -----------: | ------------: | -------- |
| updateStorm |          150.3 |              5 (5–6) |          500 |            5 |           500 | pass     |
| selectStorm |           43.1 |              2 (2–2) |            3 |            2 |             3 | pass     |
