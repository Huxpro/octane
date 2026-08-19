/**
 * Minimal reader for the Lynx web-bundle binary container ("SDRAWROF").
 *
 * The stage prototype needs the Configurations (pageConfig) and Manifest
 * sections of the Octane-built `main.web.bundle` so the hand-built direct-PAPI
 * cell can share them byte-for-byte. The layout mirrors
 * `@lynx-js/web-core/dist/client/decodeWorker/decode.worker.js`:
 * 8-byte magic, u32 version, then `[u32 label][u32 length][bytes]` sections.
 * Labels come from `@lynx-js/web-core/dist/constants.js`.
 */
import { readFileSync } from 'node:fs';

export const SECTION_LABELS = Object.freeze({
	1: 'manifest',
	2: 'styleInfo',
	3: 'lepusCode',
	4: 'customSections',
	5: 'elementTemplates',
	6: 'configurations',
});

function decodeJSONMap(bytes) {
	const utf16 = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
	let json = '';
	const CHUNK = 8192;
	for (let i = 0; i < utf16.length; i += CHUNK) {
		json += String.fromCharCode.apply(null, utf16.subarray(i, i + CHUNK));
	}
	return JSON.parse(json);
}

function decodeBinaryMap(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = 0;
	const count = view.getUint32(offset, true);
	offset += 4;
	const decoder = new TextDecoder();
	const result = {};
	for (let i = 0; i < count; i += 1) {
		const keyLen = view.getUint32(offset, true);
		offset += 4;
		const key = decoder.decode(bytes.subarray(offset, offset + keyLen));
		offset += keyLen;
		const valLen = view.getUint32(offset, true);
		offset += 4;
		result[key] = decoder.decode(bytes.subarray(offset, offset + valLen));
		offset += valLen;
	}
	return result;
}

/**
 * Read the sections of a binary web bundle. StyleInfo stays raw: its payload
 * is wasm-encoded and the prototype regenerates styles from app.css instead.
 */
export function readWebBundleSections(path) {
	const bytes = new Uint8Array(readFileSync(path));
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const magic = new TextDecoder().decode(bytes.subarray(0, 8));
	if (magic !== 'SDRAWROF') {
		throw new Error(`Not a binary Lynx web bundle (magic ${JSON.stringify(magic)}): ${path}`);
	}
	const version = view.getUint32(8, true);
	if (version > 1) throw new Error(`Unsupported web bundle version ${version}: ${path}`);
	let offset = 12;
	const sections = {};
	while (offset + 8 <= bytes.byteLength) {
		const label = view.getUint32(offset, true);
		const length = view.getUint32(offset + 4, true);
		offset += 8;
		const content = bytes.subarray(offset, offset + length);
		offset += length;
		const name = SECTION_LABELS[label] ?? `section-${label}`;
		if (name === 'configurations') sections[name] = decodeJSONMap(content);
		else if (name === 'manifest' || name === 'lepusCode') sections[name] = decodeBinaryMap(content);
		else sections[name] = content;
	}
	return sections;
}
