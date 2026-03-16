import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

const sharedConfig = {
  bundle: true,
  minify: !isWatch,
  sourcemap: isWatch,
  target: 'es2020',
  format: 'iife',
  loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'css' },
  external: [],
};

const entries = [
  { in: 'chat/index.tsx', out: '../out/chatWebview' },
  { in: 'agents/index.tsx', out: '../out/agentsWebview' },
  { in: 'orchestrator/index.tsx', out: '../out/orchestratorWebview' },
];

async function build() {
  for (const entry of entries) {
    const ctx = await esbuild.context({
      ...sharedConfig,
      entryPoints: [entry.in],
      outfile: `${entry.out}.js`,
    });

    if (isWatch) {
      await ctx.watch();
      console.log(`Watching ${entry.in}...`);
    } else {
      await ctx.rebuild();
      await ctx.dispose();
    }
  }

  // CSS
  const cssCtx = await esbuild.context({
    entryPoints: ['shared/theme/main.css'],
    outfile: '../out/theme.css',
    bundle: true,
    minify: !isWatch,
  });

  if (isWatch) {
    await cssCtx.watch();
  } else {
    await cssCtx.rebuild();
    await cssCtx.dispose();
  }

  if (!isWatch) { console.log('Build complete'); }
}

build().catch((e) => { console.error(e); process.exit(1); });
