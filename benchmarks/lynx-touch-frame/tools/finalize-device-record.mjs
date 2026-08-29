import fs from 'node:fs';

const [inputFile, outputFile] = process.argv.slice(2);
if (inputFile === undefined || outputFile === undefined) {
	throw new Error('usage: node finalize-device-record.mjs <raw.json> <finalized.json>');
}

const record = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
const { meta } = record;
if (meta === null || typeof meta !== 'object' || !Array.isArray(record.samples)) {
	throw new Error('invalid device record');
}

const samples = record.samples.map((sample) => ({
	...sample,
	windowId: meta.windowId,
	deviceModel: meta.deviceModel,
	osVersion: meta.osVersion,
	lynxSdkVersion: meta.lynxSdkVersion,
	lepusVersion:
		sample.topology === 'T1' ? '3.2 (host ReportErrorWithMsg.engine version)' : meta.lepusVersion,
	devTool: meta.devTool,
}));

fs.writeFileSync(outputFile, `${JSON.stringify({ meta, samples }, null, 2)}\n`, { flag: 'wx' });
