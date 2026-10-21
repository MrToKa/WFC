// Small actual child fixture for preload compatibility; no network or imports.
if(process.argv[2]==='guard-state'){process.stdout.write(process.env.NODE_OPTIONS?.includes('--import ')&&process.env.PREPARER_BASELINE_CONTROL&&/^[a-f0-9]{64}$/.test(process.env.PREPARER_BASELINE_CONTROL_SHA256??'')?'guard-active':'guard-missing');}
else if(process.argv[2]==='fail'){process.stdout.write('fixture-out');process.stderr.write('fixture-error');process.exitCode=7;}
else{process.stdout.write('fixture-out');process.stderr.write('fixture-error');}
