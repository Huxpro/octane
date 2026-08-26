import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const probe = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(probe, '../../..');
const plugin = path.join(repo, 'packages/rspeedy-plugin-octane');
const stage = path.join(plugin, 'examples/issue-195-list-probe');

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, 'src'), { recursive: true });
fs.copyFileSync(path.join(probe, 'lynx.config.mjs'), path.join(stage, 'lynx.config.mjs'));
fs.copyFileSync(path.join(probe, 'tsconfig.stage.json'), path.join(stage, 'tsconfig.json'));
for (const file of [
	'App.lynx.tsrx',
	'app.css',
	'index.ts',
	'issue-195-papi-loader.cjs',
	'probe-banner.js',
]) {
	fs.copyFileSync(path.join(probe, 'src', file), path.join(stage, 'src', file));
}

try {
	execFileSync('npx', ['rspeedy', 'build', '--root', 'examples/issue-195-list-probe'], {
		cwd: plugin,
		stdio: 'inherit',
		env: { ...process.env, NODE_ENV: 'production' },
	});
	fs.rmSync(path.join(probe, 'dist'), { recursive: true, force: true });
	fs.cpSync(path.join(stage, 'dist'), path.join(probe, 'dist'), { recursive: true });
} finally {
	if (process.env.OCTANE_ISSUE_195_KEEP_STAGE !== '1') {
		fs.rmSync(stage, { recursive: true, force: true });
	}
}
