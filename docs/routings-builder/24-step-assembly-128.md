# STEP assemblies with up to 128 placements

The selected-tray and complete-proposal STEP export limit is 128 saved component placements. The interface, pre-conversion snapshot, post-conversion snapshot, TypeScript converter client and isolated Python kernel enforce the same count. 129 placements are rejected without truncation.

The API sends each distinct STEP source once in a hash-verified source bank. Placements reference that source and retain their independent transform and optional straight cut length. The kernel imports each source once, caches cuts by source/length and writes each unique source once to its temporary directory. This lets repeated catalogue parts use the larger assembly limit without multiplying source payload or temporary source files.

Existing resource budgets remain enforced: 8 MiB unique source data, 12 MiB request, 32 MiB STEP output, 64 MiB temporary storage, 1 GiB converter memory and two CPUs. Historical inline-source requests remain supported. Routing-network publication and automatic-connection component limits are separate and are not changed by this STEP export update.

## Representative offline proof — 2026-11-11

A real hash-pinned Niedax straight source (823845 bytes) was exported as 128 independent placements: 43 stock 6000 mm pieces, 43 exact 1000 mm cuts and 42 exact 3750 mm cuts, over a 16 × 8 grid with four orientations. The request was 1123036 bytes; the STEP output was 2508562 bytes. The read-only offline test used the exact 64 MiB temporary-storage, 1 GiB memory and two-CPU production limits.

OCCT readback found 128 valid solids. All 128 bounds, centres of mass and volumes matched independently reconstructed cuts and transforms. Fifteen exact B-Rep comparisons covering the length/orientation combinations and grid corners had zero symmetric volume difference. Peak process memory was approximately 487.5 MiB. Uploaded/reference sources and application data were not modified. The test did not create 128 user-project instances.

## Deployment and checks

The isolated converter, API and web on 5181 were rebuilt and updated. Full frontend/server typecheck, repository lint and 60 targeted tests passed. Official offline kernel smoke accepted 128 placements, refused 129, and preserved legacy inline-source export and exact-cut behavior. Existing selected-tray and all-proposal STEP/CSV downloads were exercised after deployment against BC182; saved design revision 134, route revision 5 and all instance data stayed unchanged. Main and the original 5180 stack/data were not targeted.
