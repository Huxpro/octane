const fs = require('node:fs');

module.exports = function issue195PapiLoader(source) {
	const options = this.getOptions();
	const probeSource = fs.readFileSync(options.probeSource, 'utf8');
	return (
		probeSource +
		'\n' +
		source
			.replace(
				'const createListValue = listGlobals.__CreateList;',
				"const createListValue = issue195WrapListFunction('__CreateList', listGlobals.__CreateList);",
			)
			.replace(
				'const updateListCallbacksValue = listGlobals.__UpdateListCallbacks;',
				"const updateListCallbacksValue = issue195WrapListFunction('__UpdateListCallbacks', listGlobals.__UpdateListCallbacks);",
			)
			.replace('return Object.freeze(papi);', 'return issue195InstrumentPapi(papi);')
	);
};
