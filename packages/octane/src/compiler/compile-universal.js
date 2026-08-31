/**
 * Experimental universal-target lowering.
 *
 * This is intentionally separate from the mature DOM planner. It lowers host
 * JSX to immutable host/range/text/slot plans plus explicit component and
 * control-flow descriptors. The resulting JSX-free AST is handed directly to
 * the client hook/dependency pass with its final runtime imports already routed
 * to the selected renderer module.
 */
import { builders as b, clone_ast_node, parseModule } from '@tsrx/core';
import { normalizeUniversalRuntime } from './universal-runtime.js';

// Keep this catalogue in the compiler, never in generated application code. It
// is the union of actual constructor exports from Three r156, r172, and r183,
// so an authored built-in gets a tree-shakable named import while custom host
// names and primitives remain on their explicit-registration paths.
const THREE_BUILTIN_CONSTRUCTORS = new Set([
	'AmbientLight',
	'AmbientLightProbe',
	'AnimationAction',
	'AnimationClip',
	'AnimationLoader',
	'AnimationMixer',
	'AnimationObjectGroup',
	'AnimationUtils',
	'ArcCurve',
	'ArrayCamera',
	'ArrowHelper',
	'Audio',
	'AudioAnalyser',
	'AudioContext',
	'AudioListener',
	'AudioLoader',
	'AxesHelper',
	'BatchedMesh',
	'BezierInterpolant',
	'Bone',
	'BooleanKeyframeTrack',
	'Box2',
	'Box3',
	'Box3Helper',
	'BoxGeometry',
	'BoxHelper',
	'BufferAttribute',
	'BufferGeometry',
	'BufferGeometryLoader',
	'Camera',
	'CameraHelper',
	'CanvasTexture',
	'CapsuleGeometry',
	'CatmullRomCurve3',
	'CircleGeometry',
	'Clock',
	'Color',
	'ColorKeyframeTrack',
	'CompressedArrayTexture',
	'CompressedCubeTexture',
	'CompressedTexture',
	'CompressedTextureLoader',
	'ConeGeometry',
	'Controls',
	'CubeCamera',
	'CubeDepthTexture',
	'CubeTexture',
	'CubeTextureLoader',
	'CubicBezierCurve',
	'CubicBezierCurve3',
	'CubicInterpolant',
	'Curve',
	'CurvePath',
	'CylinderGeometry',
	'Cylindrical',
	'Data3DTexture',
	'DataArrayTexture',
	'DataTexture',
	'DataTextureLoader',
	'DataUtils',
	'DepthTexture',
	'DirectionalLight',
	'DirectionalLightHelper',
	'DiscreteInterpolant',
	'DodecahedronGeometry',
	'EdgesGeometry',
	'EllipseCurve',
	'Euler',
	'EventDispatcher',
	'ExternalTexture',
	'ExtrudeGeometry',
	'FileLoader',
	'Float16BufferAttribute',
	'Float32BufferAttribute',
	'Float64BufferAttribute',
	'Fog',
	'FogExp2',
	'FramebufferTexture',
	'Frustum',
	'FrustumArray',
	'GLBufferAttribute',
	'GridHelper',
	'Group',
	'HemisphereLight',
	'HemisphereLightHelper',
	'HemisphereLightProbe',
	'IcosahedronGeometry',
	'ImageBitmapLoader',
	'ImageLoader',
	'ImageUtils',
	'InstancedBufferAttribute',
	'InstancedBufferGeometry',
	'InstancedInterleavedBuffer',
	'InstancedMesh',
	'Int16BufferAttribute',
	'Int32BufferAttribute',
	'Int8BufferAttribute',
	'InterleavedBuffer',
	'InterleavedBufferAttribute',
	'Interpolant',
	'KeyframeTrack',
	'LOD',
	'LatheGeometry',
	'Layers',
	'Light',
	'LightProbe',
	'Line',
	'Line3',
	'LineBasicMaterial',
	'LineCurve',
	'LineCurve3',
	'LineDashedMaterial',
	'LineLoop',
	'LineSegments',
	'LinearInterpolant',
	'Loader',
	'LoaderUtils',
	'LoadingManager',
	'Material',
	'MaterialLoader',
	'Matrix2',
	'Matrix3',
	'Matrix4',
	'Mesh',
	'MeshBasicMaterial',
	'MeshDepthMaterial',
	'MeshDistanceMaterial',
	'MeshLambertMaterial',
	'MeshMatcapMaterial',
	'MeshNormalMaterial',
	'MeshPhongMaterial',
	'MeshPhysicalMaterial',
	'MeshStandardMaterial',
	'MeshToonMaterial',
	'NumberKeyframeTrack',
	'Object3D',
	'ObjectLoader',
	'OctahedronGeometry',
	'OrthographicCamera',
	'PMREMGenerator',
	'Path',
	'PerspectiveCamera',
	'Plane',
	'PlaneGeometry',
	'PlaneHelper',
	'PointLight',
	'PointLightHelper',
	'Points',
	'PointsMaterial',
	'PolarGridHelper',
	'PolyhedronGeometry',
	'PositionalAudio',
	'PropertyBinding',
	'PropertyMixer',
	'QuadraticBezierCurve',
	'QuadraticBezierCurve3',
	'Quaternion',
	'QuaternionKeyframeTrack',
	'QuaternionLinearInterpolant',
	'RawShaderMaterial',
	'Ray',
	'Raycaster',
	'RectAreaLight',
	'RenderTarget',
	'RenderTarget3D',
	'RenderTargetArray',
	'RingGeometry',
	'Scene',
	'ShaderMaterial',
	'ShadowMaterial',
	'Shape',
	'ShapeGeometry',
	'ShapePath',
	'ShapeUtils',
	'Skeleton',
	'SkeletonHelper',
	'SkinnedMesh',
	'Source',
	'Sphere',
	'SphereGeometry',
	'Spherical',
	'SphericalHarmonics3',
	'SplineCurve',
	'SpotLight',
	'SpotLightHelper',
	'Sprite',
	'SpriteMaterial',
	'StereoCamera',
	'StringKeyframeTrack',
	'TetrahedronGeometry',
	'Texture',
	'TextureLoader',
	'TextureUtils',
	'Timer',
	'TorusGeometry',
	'TorusKnotGeometry',
	'Triangle',
	'TubeGeometry',
	'Uint16BufferAttribute',
	'Uint32BufferAttribute',
	'Uint8BufferAttribute',
	'Uint8ClampedBufferAttribute',
	'Uniform',
	'UniformsGroup',
	'Vector2',
	'Vector3',
	'Vector4',
	'VectorKeyframeTrack',
	'VideoFrameTexture',
	'VideoTexture',
	'WebGL1Renderer',
	'WebGL3DRenderTarget',
	'WebGLArrayRenderTarget',
	'WebGLCubeRenderTarget',
	'WebGLMultipleRenderTargets',
	'WebGLRenderTarget',
	'WebGLRenderer',
	'WebXRController',
	'WireframeGeometry',
]);

const UNIVERSAL_RUNTIME_IMPORTS = new Set([
	'Activity',
	'createContext',
	'createPortal',
	'lazy',
	'memo',
	'requestFormReset',
	'startTransition',
	'use',
	'useActionState',
	'useCallback',
	'useContext',
	'useDebugValue',
	'useDeferredValue',
	'useEffect',
	'useEffectEvent',
	'useFormStatus',
	'useId',
	'useImperativeHandle',
	'useInsertionEffect',
	'useLayoutEffect',
	'useLinkedState',
	'useMemo',
	'useOptimistic',
	'useReducer',
	'useRef',
	'useState',
	'useSyncExternalStore',
	'useTransition',
]);

// A renderer must opt in explicitly before main-thread metadata changes emitted
// code. This keeps universalRuntime useful as cache/diagnostic identity for
// ordinary renderers while allowing native first-screen programs to erase
// background-owned callbacks from their render-only specialization.
const MAIN_THREAD_RENDER_ONLY_CAPABILITY = 'main-thread-render-only';
const COMPONENT_SCOPE_FOR_CAPABILITY = 'component-scope-for';
const THREAD_FUNCTION_CAPABILITY = 'thread-functions';
const THREAD_DIRECTIVES = new Map([
	['main thread', 'main-thread'],
	['background only', 'background'],
]);
const UNIVERSAL_REALM_GLOBALS = new Set([
	'Array',
	'ArrayBuffer',
	'Atomics',
	'BigInt',
	'BigInt64Array',
	'BigUint64Array',
	'Boolean',
	'DataView',
	'Date',
	'Error',
	'EvalError',
	'FinalizationRegistry',
	'Float32Array',
	'Float64Array',
	'Function',
	'Infinity',
	'Int16Array',
	'Int32Array',
	'Int8Array',
	'Intl',
	'JSON',
	'Map',
	'Math',
	'NaN',
	'Number',
	'Object',
	'Promise',
	'Proxy',
	'RangeError',
	'ReferenceError',
	'Reflect',
	'RegExp',
	'Set',
	'SharedArrayBuffer',
	'String',
	'Symbol',
	'SyntaxError',
	'TypeError',
	'URIError',
	'Uint16Array',
	'Uint32Array',
	'Uint8Array',
	'Uint8ClampedArray',
	'WeakMap',
	'WeakRef',
	'WeakSet',
	'WebAssembly',
	'console',
	'decodeURI',
	'decodeURIComponent',
	'encodeURI',
	'encodeURIComponent',
	'escape',
	'eval',
	'globalThis',
	'isFinite',
	'isNaN',
	'parseFloat',
	'parseInt',
	'undefined',
	'unescape',
]);
const MAIN_THREAD_BACKGROUND_EFFECTS = new Set([
	'useEffect',
	'useEffectEvent',
	'useImperativeHandle',
	'useInsertionEffect',
	'useLayoutEffect',
]);

function isMainThreadRenderOnly(state) {
	return (
		state.universalRuntime?.thread === 'main-thread' &&
		rendererHasCapability(state, MAIN_THREAD_RENDER_ONLY_CAPABILITY)
	);
}

function isFirstScreenEvent(name, state) {
	return (state.renderer.firstScreenEvents ?? []).some((pattern) => hostPropMatches(name, pattern));
}

function unwrapFirstScreenExpression(node) {
	while (
		node &&
		(node.type === 'ParenthesizedExpression' ||
			node.type === 'ChainExpression' ||
			node.type === 'TSAsExpression' ||
			node.type === 'TSNonNullExpression' ||
			node.type === 'TSSatisfiesExpression' ||
			node.type === 'TSTypeAssertion')
	) {
		node = node.expression;
	}
	return node;
}

function firstScreenEventHelper(state) {
	return (state.helpers.firstScreenEvent ??= allocName(state, '__octaneFirstScreenEvent'));
}

function universalError(filename, node, message) {
	const start = node?.loc?.start;
	const at = start ? ` at ${filename}:${start.line}:${start.column}` : '';
	return new Error(`Octane universal compiler: ${message}${at}`);
}

const AST_SKIP_KEYS = new Set(['end', 'loc', 'metadata', 'parent', 'range', 'start']);
const PLAN_ORIGIN = Symbol('octane.universalPlanOrigin');

function withPlanOrigin(value, origin) {
	if (value && typeof value === 'object' && origin) {
		Object.defineProperty(value, PLAN_ORIGIN, {
			configurable: false,
			enumerable: false,
			value: origin,
			writable: false,
		});
	}
	return value;
}

function inheritGeneratedOrigin(root, origin) {
	const seen = new WeakSet();
	const visit = (value) => {
		if (!value || typeof value !== 'object' || seen.has(value)) return;
		seen.add(value);
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		if (typeof value.type === 'string' && value.loc == null && origin?.loc != null) {
			value.start = origin.start;
			value.end = origin.end;
			value.loc = origin.loc;
		}
		for (const [key, child] of Object.entries(value)) {
			if (!AST_SKIP_KEYS.has(key)) visit(child);
		}
	};
	visit(root);
	return root;
}

function mapAstCow(value, replace) {
	if (!value || typeof value !== 'object') return value;
	if (Array.isArray(value)) {
		let output = null;
		for (let index = 0; index < value.length; index++) {
			const mapped = mapAstCow(value[index], replace);
			if (output === null && mapped !== value[index]) output = value.slice(0, index);
			if (output !== null && mapped !== null) output.push(mapped);
		}
		return output ?? value;
	}
	const replacement = replace(value);
	if (replacement !== undefined) return replacement;
	let output = null;
	for (const [key, child] of Object.entries(value)) {
		if (AST_SKIP_KEYS.has(key)) continue;
		const mapped = mapAstCow(child, replace);
		if (mapped !== child) {
			if (output === null) output = { ...value };
			output[key] = mapped;
		}
	}
	return output ?? value;
}

function jsonValueToAst(value, origin) {
	const valueOrigin =
		value && typeof value === 'object' && value[PLAN_ORIGIN] ? value[PLAN_ORIGIN] : origin;
	let node;
	if (value === null) node = b.literal(null, 'null');
	else if (typeof value === 'string') node = b.literal(value, JSON.stringify(value));
	else if (typeof value === 'number' || typeof value === 'boolean') node = b.literal(value);
	else if (Array.isArray(value)) {
		node = b.array(value.map((item) => jsonValueToAst(item, valueOrigin)));
	} else {
		node = b.object(
			Object.entries(value).map(([key, item]) =>
				b.prop('init', b.literal(key, JSON.stringify(key)), jsonValueToAst(item, valueOrigin)),
			),
		);
	}
	return inheritGeneratedOrigin(node, valueOrigin);
}

function generatedIdentifier(name, origin) {
	return inheritGeneratedOrigin(b.id(name), origin);
}

function generatedCall(callee, args, origin) {
	return inheritGeneratedOrigin(b.call(callee, ...args), origin);
}

function generatedArrow(params, body, origin) {
	return inheritGeneratedOrigin(b.arrow(params, body), origin);
}

function generatedConst(name, init, origin, kind = 'const') {
	const declaration =
		kind === 'let' ? b.let(name, init) : kind === 'var' ? b.var(name, init) : b.const(name, init);
	return inheritGeneratedOrigin(declaration, origin);
}

function isTemplateNode(node) {
	return (
		node?.type === 'JSXElement' ||
		node?.type === 'Element' ||
		node?.type === 'JSXFragment' ||
		node?.type === 'Fragment' ||
		node?.type === 'JSXForExpression' ||
		node?.type === 'JSXIfExpression' ||
		node?.type === 'JSXSwitchExpression' ||
		node?.type === 'JSXTryExpression'
	);
}

function assertNoResidualTemplate(node, state, context) {
	if (node == null || typeof node !== 'object') return;
	if (Array.isArray(node)) {
		for (const child of node) assertNoResidualTemplate(child, state, context);
		return;
	}
	if (
		typeof node.type === 'string' &&
		(node.type.startsWith('JSX') || node.type === 'Element' || node.type === 'Fragment')
	) {
		throw universalError(
			state.filename,
			node,
			`JSX in ${context} requires universal plan lowering and cannot fall back to DOM codegen.`,
		);
	}
	for (const [key, value] of Object.entries(node)) {
		if (key === 'loc' || key === 'start' || key === 'end') continue;
		assertNoResidualTemplate(value, state, context);
	}
}

function validateRuntimeImports(ast, state) {
	for (const node of ast.body ?? []) {
		if (node.type !== 'ImportDeclaration' || node.source?.value !== 'octane') continue;
		if (node.importKind === 'type') continue;
		for (const specifier of node.specifiers ?? []) {
			if (specifier.importKind === 'type') continue;
			if (specifier.type !== 'ImportSpecifier') {
				throw universalError(
					state.filename,
					specifier,
					'universal renderer modules require named imports from octane.',
				);
			}
			const imported = specifier.imported?.name ?? specifier.imported?.value;
			if (specifier.local?.name) state.runtimeImports.set(specifier.local.name, imported);
			if (!UNIVERSAL_RUNTIME_IMPORTS.has(imported)) {
				throw universalError(
					state.filename,
					specifier,
					`runtime import ${JSON.stringify(imported)} has no universal renderer implementation.`,
				);
			}
		}
	}
}

const NON_RUNTIME_AST_KEYS = new Set([
	'end',
	'implements',
	'loc',
	'metadata',
	'returnType',
	'start',
	'superTypeArguments',
	'superTypeParameters',
	'typeAnnotation',
	'typeArguments',
	'typeParameters',
]);
const RUNTIME_TYPESCRIPT_NODES = new Set([
	'TSAsExpression',
	'TSEnumDeclaration',
	'TSEnumMember',
	'TSExportAssignment',
	'TSImportEqualsDeclaration',
	'TSInstantiationExpression',
	'TSModuleBlock',
	'TSModuleDeclaration',
	'TSNonNullExpression',
	'TSParameterProperty',
	'TSQualifiedName',
	'TSSatisfiesExpression',
	'TSTypeAssertion',
]);

function forEachRuntimeAstChild(node, visit) {
	if (
		typeof node?.type === 'string' &&
		node.type.startsWith('TS') &&
		!RUNTIME_TYPESCRIPT_NODES.has(node.type)
	) {
		return;
	}
	for (const [key, value] of Object.entries(node)) {
		if (NON_RUNTIME_AST_KEYS.has(key) || value === null || typeof value !== 'object') continue;
		if (Array.isArray(value)) {
			for (const child of value) visit(child, key);
		} else {
			visit(value, key);
		}
	}
}

function forbiddenImportMatch(source, forbidden) {
	return forbidden.find((packageId) => source === packageId || source.startsWith(`${packageId}/`));
}

function validateForbiddenImports(
	ast,
	state,
	validation,
	isAuthored,
	lexicalAnalysis = null,
	referencedStaticSources = null,
) {
	const forbidden = validation.forbiddenImports;
	if (!forbidden || forbidden.length === 0) return;
	const { nodeScopes, rootScope, isBound } = lexicalAnalysis ?? createLexicalAnalysis(ast);
	const requests = [];
	const collectRequest = (sourceNode, kind = 'import') => {
		const source = sourceNode?.value;
		if (
			typeof source !== 'string' ||
			!isThreadNodeActive(state, sourceNode) ||
			isThreadImportElided(state, sourceNode) ||
			(!isAuthored(sourceNode) && !referencedStaticSources?.has(sourceNode))
		) {
			return;
		}
		const matched = forbiddenImportMatch(source, forbidden);
		if (matched !== undefined) requests.push({ kind, matched, source, sourceNode });
	};
	for (const node of ast.body ?? []) {
		let sourceNode = null;
		if (
			node.type === 'ImportDeclaration' ||
			node.type === 'ExportNamedDeclaration' ||
			node.type === 'ExportAllDeclaration'
		) {
			sourceNode = node.source;
		} else if (node.type === 'TSImportEqualsDeclaration') {
			sourceNode = node.moduleReference?.expression;
		}
		collectRequest(sourceNode);
	}
	const seen = new WeakSet();
	const visit = (node) => {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) {
			for (const child of node) visit(child);
			return;
		}
		if (seen.has(node)) return;
		seen.add(node);
		if (!isThreadNodeActive(state, node)) return;
		if (node.type === 'ImportExpression') collectRequest(node.source);
		if (node.type === 'CallExpression') {
			let bindingName = null;
			if (node.callee?.type === 'Identifier' && node.callee.name === 'require') {
				bindingName = 'require';
			} else if (
				(node.callee?.type === 'MemberExpression' ||
					node.callee?.type === 'OptionalMemberExpression') &&
				node.callee.object?.type === 'Identifier' &&
				node.callee.object.name === 'module'
			) {
				const propertyName = node.callee.computed
					? node.callee.property?.value
					: node.callee.property?.name;
				if (propertyName === 'require') bindingName = 'module';
			}
			const scope = nodeScopes.get(node) ?? rootScope;
			if (bindingName !== null && !isBound(scope, bindingName)) {
				collectRequest(node.arguments?.[0], 'CommonJS require');
			}
		}
		forEachRuntimeAstChild(node, visit);
	};
	visit(ast);
	if (requests.length > 0) {
		requests.sort((left, right) => (left.sourceNode.start ?? 0) - (right.sourceNode.start ?? 0));
		const { kind, matched, source, sourceNode } = requests[0];
		throw universalError(
			state.filename,
			sourceNode,
			`renderer ${JSON.stringify(state.renderer.id)} forbids static ${kind} ${JSON.stringify(source)} (matched ${JSON.stringify(matched)}).`,
		);
	}
}

function createLexicalScope(parent, isFunction = false) {
	const scope = { bindings: new Set(), functionScope: null, importSources: new Map(), parent };
	scope.functionScope = isFunction ? scope : (parent?.functionScope ?? scope);
	return scope;
}

export function createLexicalAnalysis(ast) {
	const bindingNodes = new WeakSet();
	const nonReferenceNodes = new WeakSet();
	const nodeScopes = new WeakMap();
	const rootScope = createLexicalScope(null, true);
	const hasBinding = (scope, name) => {
		for (let current = scope; current; current = current.parent) {
			if (current.bindings.has(name)) return true;
		}
		return false;
	};
	const commonJsSource = (node, scope) => {
		if (node?.type !== 'CallExpression') return null;
		if (
			node.callee?.type === 'Identifier' &&
			node.callee.name === 'require' &&
			!hasBinding(scope, 'require')
		) {
			return node.arguments?.[0] ?? null;
		}
		if (
			(node.callee?.type === 'MemberExpression' ||
				node.callee?.type === 'OptionalMemberExpression') &&
			node.callee.object?.type === 'Identifier' &&
			node.callee.object.name === 'module' &&
			!hasBinding(scope, 'module')
		) {
			const propertyName = node.callee.computed
				? node.callee.property?.value
				: node.callee.property?.name;
			if (propertyName === 'require') return node.arguments?.[0] ?? null;
		}
		return null;
	};
	const declarePattern = (pattern, scope, importSource = null) => {
		if (!pattern) return;
		if (pattern.type === 'Identifier') {
			if (scope !== null) {
				scope.bindings.add(pattern.name);
				if (importSource !== null) scope.importSources.set(pattern.name, importSource);
			}
			bindingNodes.add(pattern);
			return;
		}
		if (pattern.type === 'RestElement') {
			declarePattern(pattern.argument, scope, importSource);
			return;
		}
		if (pattern.type === 'AssignmentPattern') {
			declarePattern(pattern.left, scope, importSource);
			return;
		}
		if (pattern.type === 'TSParameterProperty') {
			declarePattern(pattern.parameter, scope, importSource);
			return;
		}
		if (pattern.type === 'ArrayPattern') {
			for (const element of pattern.elements ?? []) {
				declarePattern(element, scope, importSource);
			}
			return;
		}
		if (pattern.type === 'ObjectPattern') {
			for (const property of pattern.properties ?? []) {
				declarePattern(property.argument ?? property.value, scope, importSource);
			}
		}
	};
	const visitScopes = (node, scope) => {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) {
			for (const child of node) visitScopes(child, scope);
			return;
		}
		nodeScopes.set(node, scope);

		if (node.type === 'ImportDeclaration') {
			if (node.importKind !== 'type') {
				for (const specifier of node.specifiers ?? []) {
					if (specifier.importKind !== 'type' && specifier.local) {
						declarePattern(specifier.local, scope, node.source);
					}
				}
			}
			forEachRuntimeAstChild(node, (child) => visitScopes(child, scope));
			return;
		}
		if (
			node.type === 'ExportNamedDeclaration' &&
			(node.source != null || node.exportKind === 'type')
		) {
			for (const specifier of node.specifiers ?? []) {
				if (specifier.local) nonReferenceNodes.add(specifier.local);
				if (specifier.exported) nonReferenceNodes.add(specifier.exported);
			}
			forEachRuntimeAstChild(node, (child) => visitScopes(child, scope));
			return;
		}
		if (node.type === 'VariableDeclaration') {
			const bindingScope = node.kind === 'var' ? scope.functionScope : scope;
			for (const declaration of node.declarations ?? []) {
				declarePattern(
					declaration.id,
					node.declare === true ? null : bindingScope,
					node.declare === true ? null : commonJsSource(declaration.init, scope),
				);
			}
			forEachRuntimeAstChild(node, (child) => visitScopes(child, scope));
			return;
		}
		if (
			node.type === 'FunctionDeclaration' ||
			node.type === 'FunctionExpression' ||
			node.type === 'ArrowFunctionExpression'
		) {
			if (node.type === 'FunctionDeclaration' && node.id) declarePattern(node.id, scope);
			const parameterScope = createLexicalScope(scope, true);
			if (node.id) declarePattern(node.id, parameterScope);
			for (const parameter of node.params ?? []) declarePattern(parameter, parameterScope);
			if (node.id) visitScopes(node.id, parameterScope);
			for (const parameter of node.params ?? []) visitScopes(parameter, parameterScope);
			const bodyScope = createLexicalScope(parameterScope, true);
			visitScopes(node.body, bodyScope);
			return;
		}
		if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
			if (node.declare === true) {
				if (node.id) declarePattern(node.id, null);
				return;
			}
			if (node.type === 'ClassDeclaration' && node.id) declarePattern(node.id, scope);
			for (const decorator of node.decorators ?? []) visitScopes(decorator, scope);
			const classScope = createLexicalScope(scope);
			if (node.id) {
				declarePattern(node.id, classScope);
				visitScopes(node.id, classScope);
			}
			visitScopes(node.superClass, classScope);
			visitScopes(node.body, classScope);
			return;
		}
		if (node.type === 'BlockStatement' || node.type === 'JSXCodeBlock') {
			const blockScope = createLexicalScope(scope);
			forEachRuntimeAstChild(node, (child) => visitScopes(child, blockScope));
			return;
		}
		if (node.type === 'StaticBlock') {
			const staticScope = createLexicalScope(scope, true);
			forEachRuntimeAstChild(node, (child) => visitScopes(child, staticScope));
			return;
		}
		if (
			node.type === 'ForStatement' ||
			node.type === 'ForInStatement' ||
			node.type === 'ForOfStatement' ||
			node.type === 'SwitchStatement'
		) {
			const blockScope = createLexicalScope(scope);
			forEachRuntimeAstChild(node, (child) => visitScopes(child, blockScope));
			return;
		}
		if (node.type === 'CatchClause') {
			const catchScope = createLexicalScope(scope);
			declarePattern(node.param, catchScope);
			visitScopes(node.param, catchScope);
			visitScopes(node.body, catchScope);
			return;
		}
		if (node.type === 'JSXForExpression') {
			visitScopes(node.right, scope);
			const itemScope = createLexicalScope(scope);
			if (node.left?.type === 'VariableDeclaration') {
				for (const declaration of node.left.declarations ?? []) {
					declarePattern(declaration.id, itemScope);
				}
			} else {
				declarePattern(node.left, itemScope);
			}
			declarePattern(node.index, itemScope);
			visitScopes(node.left, itemScope);
			visitScopes(node.index, itemScope);
			visitScopes(node.key, itemScope);
			visitScopes(node.body, itemScope);
			visitScopes(node.empty, scope);
			return;
		}
		if (node.type === 'JSXTryExpression') {
			visitScopes(node.block, scope);
			visitScopes(node.pending, scope);
			if (node.handler) {
				const catchScope = createLexicalScope(scope);
				declarePattern(node.handler.param, catchScope);
				declarePattern(node.handler.resetParam, catchScope);
				visitScopes(node.handler.param, catchScope);
				visitScopes(node.handler.resetParam, catchScope);
				visitScopes(node.handler.body, catchScope);
			}
			return;
		}
		if (node.type === 'TSModuleDeclaration') {
			if (node.declare === true || node.kind === 'global') {
				if (node.id) declarePattern(node.id, null);
				return;
			}
			if (node.id) declarePattern(node.id, scope);
			const moduleScope = createLexicalScope(scope, true);
			if (node.id) {
				declarePattern(node.id, moduleScope);
				visitScopes(node.id, moduleScope);
			}
			visitScopes(node.body, moduleScope);
			return;
		}
		if (node.type === 'TSEnumDeclaration') {
			if (node.id) declarePattern(node.id, node.declare === true ? null : scope);
			if (node.declare === true) return;
			const enumScope = createLexicalScope(scope);
			if (node.id) declarePattern(node.id, enumScope);
			for (const member of node.members ?? []) {
				if (member.computed !== true && member.id?.type === 'Identifier') {
					declarePattern(member.id, enumScope);
				}
			}
			forEachRuntimeAstChild(node, (child) => visitScopes(child, enumScope));
			return;
		}
		if (node.type === 'TSImportEqualsDeclaration') {
			if (node.id) {
				declarePattern(
					node.id,
					node.declare === true ? null : scope,
					node.moduleReference?.expression ?? null,
				);
			}
			if (node.declare === true) return;
			forEachRuntimeAstChild(node, (child) => visitScopes(child, scope));
			return;
		}

		forEachRuntimeAstChild(node, (child) => visitScopes(child, scope));
	};
	visitScopes(ast, rootScope);
	const resolveBinding = (scope, name) => {
		for (let current = scope; current; current = current.parent) {
			if (current.bindings.has(name)) {
				return {
					importSource: current.importSources.get(name) ?? null,
					scope: current,
				};
			}
		}
		return null;
	};
	const isBound = (scope, name) => resolveBinding(scope, name) !== null;
	return {
		bindingNodes,
		commonJsSource,
		nonReferenceNodes,
		nodeScopes,
		rootScope,
		isBound,
		resolveBinding,
	};
}

function isIdentifierReference(node, parent, key, lexicalAnalysis) {
	const { bindingNodes, nonReferenceNodes } = lexicalAnalysis;
	if (bindingNodes.has(node) || nonReferenceNodes.has(node)) return false;
	if (
		parent?.type === 'ImportSpecifier' ||
		parent?.type === 'ImportDefaultSpecifier' ||
		parent?.type === 'ImportNamespaceSpecifier'
	) {
		return false;
	}
	if (
		(parent?.type === 'ExportSpecifier' && key === 'exported') ||
		(parent?.type === 'ExportAllDeclaration' && key === 'exported') ||
		parent?.type === 'ExportNamespaceSpecifier'
	) {
		return false;
	}
	if (
		(parent?.type === 'MemberExpression' || parent?.type === 'OptionalMemberExpression') &&
		key === 'property' &&
		!parent.computed
	) {
		return false;
	}
	if (parent?.type === 'Property' && key === 'key' && !parent.computed) {
		return parent.shorthand === true && parent.value === node;
	}
	if (
		(parent?.type === 'MethodDefinition' ||
			parent?.type === 'PropertyDefinition' ||
			parent?.type === 'TSEnumMember') &&
		(key === 'key' || key === 'id') &&
		!parent.computed
	) {
		return false;
	}
	if (parent?.type === 'TSQualifiedName' && key === 'right') return false;
	if (
		(parent?.type === 'LabeledStatement' && key === 'label') ||
		((parent?.type === 'BreakStatement' || parent?.type === 'ContinueStatement') &&
			key === 'label') ||
		(parent?.type === 'ImportAttribute' && key === 'key' && !parent.computed) ||
		parent?.type === 'MetaProperty'
	) {
		return false;
	}
	return true;
}

function threadHash(value) {
	let left = 5381;
	let right = 52711;
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		left = (Math.imul(left, 33) + code) | 0;
		right = (Math.imul(right, 31) ^ code) | 0;
	}
	return `${(left >>> 0).toString(36)}${(right >>> 0).toString(36)}`;
}

function compareSourcePosition(left, right) {
	if (left.line !== right.line) return left.line - right.line;
	return left.column - right.column;
}

function isThreadNodeActive(state, node) {
	const ranges = state.threadErasedRanges ?? [];
	const position = node?.loc?.start;
	if (position === undefined || ranges.length === 0) return true;
	let low = 0;
	let high = ranges.length - 1;
	while (low <= high) {
		const middle = (low + high) >>> 1;
		const range = ranges[middle];
		if (compareSourcePosition(position, range.start) < 0) {
			high = middle - 1;
		} else if (compareSourcePosition(position, range.end) >= 0) {
			low = middle + 1;
		} else {
			return false;
		}
	}
	return true;
}

function isThreadImportElided(state, sourceNode) {
	const position = sourceNode?.loc?.start;
	return (
		position !== undefined &&
		(state.threadElidedImportLocations ?? []).some(
			(candidate) => compareSourcePosition(position, candidate) === 0,
		)
	);
}

function scopeContains(scope, boundary) {
	for (let current = scope; current; current = current.parent) {
		if (current === boundary) return true;
	}
	return false;
}

function threadFunctionCaptures(site, state, lexicalAnalysis) {
	const { fn, directive } = site;
	const { nodeScopes, resolveBinding, rootScope } = lexicalAnalysis;
	const bodyScope = nodeScopes.get(fn.body);
	const functionBoundary = bodyScope?.parent ?? bodyScope;
	const captures = new Map();
	const seen = new WeakSet();
	const visit = (node, parent = null, key = null) => {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) {
			for (const child of node) visit(child, parent, key);
			return;
		}
		if (seen.has(node)) return;
		seen.add(node);
		if (node === directive) return;
		if (isTemplateNode(node)) {
			throw universalError(
				state.filename,
				node,
				'thread functions cannot contain JSX or TSRX template syntax.',
			);
		}
		if (node.type === 'ThisExpression' || node.type === 'Super') {
			throw universalError(
				state.filename,
				node,
				'thread functions cannot reference this or super; pass serializable values explicitly.',
			);
		}
		if (
			node.type === 'MetaProperty' &&
			node.meta?.name === 'new' &&
			node.property?.name === 'target'
		) {
			throw universalError(state.filename, node, 'thread functions cannot reference new.target.');
		}
		if (
			node.type === 'Identifier' &&
			node.name === 'arguments' &&
			isIdentifierReference(node, parent, key, lexicalAnalysis)
		) {
			throw universalError(
				state.filename,
				node,
				'thread functions cannot capture arguments; use an explicit rest parameter.',
			);
		}
		if (node.type === 'CallExpression' && node.callee?.type === 'Identifier') {
			const binding = resolveBinding(nodeScopes.get(node.callee) ?? rootScope, node.callee.name);
			if (node.callee.name === 'eval' && binding === null) {
				throw universalError(
					state.filename,
					node.callee,
					'thread functions cannot call direct eval.',
				);
			}
			const imported = state.runtimeImports.get(node.callee.name);
			if (imported === 'use' || /^use[A-Z]/.test(imported ?? node.callee.name)) {
				throw universalError(state.filename, node.callee, 'thread functions cannot call hooks.');
			}
		}
		if (node.type === 'Identifier' && isIdentifierReference(node, parent, key, lexicalAnalysis)) {
			const binding = resolveBinding(nodeScopes.get(node) ?? rootScope, node.name);
			if (
				(binding === null && state.threadExternalCaptures?.has(node.name)) ||
				(binding !== null &&
					binding.scope !== rootScope &&
					!scopeContains(binding.scope, functionBoundary))
			) {
				const existing = captures.get(node.name);
				if (existing === undefined || (node.start ?? Infinity) < existing.offset) {
					captures.set(node.name, { name: node.name, offset: node.start ?? Infinity });
				}
			}
		}
		forEachRuntimeAstChild(node, (child, childKey) => visit(child, node, childKey));
	};
	for (const parameter of fn.params ?? []) visit(parameter, fn, 'params');
	visit(fn.body, fn, 'body');
	return [...captures.values()].sort((left, right) => left.offset - right.offset);
}

function keepThreadImportBinding(references, source, name) {
	const counts = references.get(source)?.get(name);
	return counts === undefined || counts.total === 0 || counts.active > 0;
}

function isStaticThreadImportSource(source) {
	return source?.type === 'Literal' && typeof source.value === 'string';
}

function prepareMainThreadRenderOnlyAstReplacements(ast, state) {
	if (!isMainThreadRenderOnly(state)) return;
	state.astNodeReplacements ??= new WeakMap();
	const { nodeScopes, resolveBinding, rootScope } = createLexicalAnalysis(ast);
	const seen = new WeakSet();
	const visit = (node) => {
		if (!node || typeof node !== 'object' || seen.has(node)) return;
		seen.add(node);
		if (Array.isArray(node)) {
			for (const child of node) visit(child);
			return;
		}
		if (
			node.type === 'CallExpression' &&
			node.callee?.type === 'Identifier' &&
			resolveBinding(nodeScopes.get(node.callee) ?? rootScope, node.callee.name)?.importSource
				?.value === 'octane' &&
			MAIN_THREAD_BACKGROUND_EFFECTS.has(state.runtimeImports.get(node.callee.name))
		) {
			for (const argument of node.arguments ?? []) {
				if (argument && typeof argument === 'object') {
					state.astNodeReplacements.set(
						argument,
						inheritGeneratedOrigin(b.id('undefined'), argument),
					);
				}
			}
			return;
		}
		for (const [key, child] of Object.entries(node)) {
			if (!AST_SKIP_KEYS.has(key)) visit(child);
		}
	};
	visit(ast);
}

function threadFunctionExpression(site) {
	const fn = clone_ast_node(site.fn);
	if (fn.type === 'FunctionDeclaration') fn.type = 'FunctionExpression';
	fn.body = { ...fn.body, body: (fn.body.body ?? []).slice(1) };
	return fn;
}

function prepareThreadFunctionAstReplacements(ast, state) {
	if (!rendererHasCapability(state, THREAD_FUNCTION_CAPABILITY)) return;
	const parents = new WeakMap();
	const directives = [];
	const seen = new WeakSet();
	const visit = (node, parent = null) => {
		if (!node || typeof node !== 'object' || seen.has(node)) return;
		seen.add(node);
		if (Array.isArray(node)) {
			for (const child of node) visit(child, parent);
			return;
		}
		if (parent !== null) parents.set(node, parent);
		if (
			node.type === 'ExpressionStatement' &&
			THREAD_DIRECTIVES.has(node.directive ?? node.expression?.value)
		) {
			directives.push(node);
		}
		forEachRuntimeAstChild(node, (child) => visit(child, node));
	};
	visit(ast);
	if (directives.length === 0) return;

	const sites = [];
	for (const directive of directives.sort((left, right) => left.start - right.start)) {
		const directiveValue = directive.directive ?? directive.expression.value;
		let fn = parents.get(directive);
		while (
			fn &&
			fn.type !== 'FunctionDeclaration' &&
			fn.type !== 'FunctionExpression' &&
			fn.type !== 'ArrowFunctionExpression'
		) {
			fn = parents.get(fn);
		}
		if (!fn || fn.body?.type !== 'BlockStatement' || fn.body.body?.[0] !== directive) {
			throw universalError(
				state.filename,
				directive,
				`${JSON.stringify(directiveValue)} must be the first statement of a function body.`,
			);
		}
		const parent = parents.get(fn);
		if (
			parent?.type === 'MethodDefinition' ||
			(parent?.type === 'Property' && (parent.method === true || parent.kind !== 'init'))
		) {
			throw universalError(
				state.filename,
				directive,
				'thread directives are not supported in methods, getters, setters, or constructors; use a function-valued field or declaration.',
			);
		}
		let declarationContainer = null;
		if (fn.type === 'FunctionDeclaration') {
			const declarationParent = parents.get(fn);
			declarationContainer =
				declarationParent?.type === 'ExportNamedDeclaration' ||
				declarationParent?.type === 'ExportDefaultDeclaration'
					? parents.get(declarationParent)
					: declarationParent;
			if (
				declarationContainer?.type !== 'Program' &&
				declarationContainer?.type !== 'BlockStatement' &&
				declarationContainer?.type !== 'JSXCodeBlock'
			) {
				throw universalError(
					state.filename,
					directive,
					'thread function declarations require a module or block statement container.',
				);
			}
		}
		const kind = THREAD_DIRECTIVES.get(directiveValue);
		if (fn.generator || (kind === 'main-thread' && fn.async)) {
			throw universalError(
				state.filename,
				directive,
				kind === 'main-thread' && fn.async
					? 'main-thread functions cannot be async functions.'
					: 'thread functions cannot be generator functions.',
			);
		}
		sites.push({ fn, directive, kind, declarationContainer });
	}
	for (let index = 0; index < sites.length; index++) {
		const outer = sites[index];
		for (let nestedIndex = index + 1; nestedIndex < sites.length; nestedIndex++) {
			const nested = sites[nestedIndex];
			if (nested.fn.start >= outer.fn.end) break;
			if (nested.fn.end <= outer.fn.end) {
				throw universalError(
					state.filename,
					nested.directive,
					'thread functions cannot contain another thread function.',
				);
			}
		}
	}
	if (state.universalRuntime === undefined) {
		throw universalError(
			state.filename,
			sites[0].directive,
			'thread directives require universalRuntime.thread to select the current execution layer.',
		);
	}

	state.astNodeReplacements ??= new WeakMap();
	state.threadFunctionNodes = new WeakSet(sites.map((site) => site.fn));
	state.threadFunctionRegistrationsAst = [];
	state.threadFunctionDisposals = [];
	state.threadErasedRanges = sites
		.filter((site) => site.kind !== state.universalRuntime.thread)
		.map((site) => ({ start: site.fn.loc?.start, end: site.fn.loc?.end }))
		.sort((left, right) => compareSourcePosition(left.start, right.start));
	if (sites.some((site) => site.kind === state.universalRuntime.thread)) {
		state.helpers.registerThreadFunction = allocName(
			state,
			`${state.planPrefix ?? '__octane'}RegisterThreadFunction`,
		);
		if (state.hmr) {
			state.helpers.unregisterThreadFunction = allocName(
				state,
				`${state.planPrefix ?? '__octane'}UnregisterThreadFunction`,
			);
		}
	}
	if (sites.some((site) => site.fn.type !== 'FunctionDeclaration')) {
		state.helpers.bindThreadFunction = allocName(
			state,
			`${state.planPrefix ?? '__octane'}BindThreadFunction`,
		);
	}
	if (sites.some((site) => site.fn.type === 'FunctionDeclaration')) {
		state.helpers.attachThreadFunction = allocName(
			state,
			`${state.planPrefix ?? '__octane'}AttachThreadFunction`,
		);
		state.helpers.invokeThreadFunction = allocName(
			state,
			`${state.planPrefix ?? '__octane'}InvokeThreadFunction`,
		);
	}
	const captureParameter = allocName(state, '__octaneThreadCaptures');
	const receiverParameter = allocName(state, '__octaneThreadReceiver');
	const argumentParameter = allocName(state, '__octaneThreadArguments');
	const wrapperArguments = allocName(state, '__octaneThreadCallArguments');
	const lexicalAnalysis = createLexicalAnalysis(ast);

	for (const site of sites) {
		const captures = threadFunctionCaptures(site, state, lexicalAnalysis);
		const loc = site.fn.loc?.start;
		const id = `tf_${threadHash(
			`${state.profileFilename || state.filename || '<anon>'}\0${site.kind}\0${loc?.line ?? 0}:${
				loc?.column ?? 0
			}`,
		)}`;
		const metadata = {
			file: (state.profileFilename || state.filename || '<anon>').split(/[\\/]/).pop(),
			line: loc?.line ?? 0,
			column: loc?.column ?? 0,
		};
		const captureProvider = generatedArrow(
			[],
			inheritGeneratedOrigin(b.array(captures.map((capture) => b.id(capture.name))), site.fn),
			site.fn,
		);
		const helperArguments = [
			b.literal(site.kind),
			b.literal(id),
			captureProvider,
			jsonValueToAst(metadata, site.fn),
		];
		Object.assign(site, { captures, id, metadata, helperArguments });
	}

	const declarationAttachments = new Map();
	for (const site of sites) {
		const { captures, id, helperArguments } = site;
		if (site.fn.type === 'FunctionDeclaration') {
			let name = site.fn.id?.name;
			if (!name) name = allocName(state, '__octaneThreadDefault');
			const attachment = inheritGeneratedOrigin(
				b.stmt(
					generatedCall(
						state.helpers.attachThreadFunction,
						[generatedIdentifier(name, site.fn), ...helperArguments],
						site.fn,
					),
				),
				site.fn,
			);
			const wrapper = inheritGeneratedOrigin(
				{
					...site.fn,
					id: generatedIdentifier(name, site.fn),
					params: [b.rest(generatedIdentifier(wrapperArguments, site.fn))],
					body: b.block([
						attachment,
						b.return(
							generatedCall(
								state.helpers.invokeThreadFunction,
								[
									generatedIdentifier(name, site.fn),
									b.this,
									generatedIdentifier(wrapperArguments, site.fn),
								],
								site.fn,
							),
						),
					]),
				},
				site.fn,
			);
			state.astNodeReplacements.set(site.fn, wrapper);
			let attachments = declarationAttachments.get(site.declarationContainer);
			if (attachments === undefined) {
				attachments = [];
				declarationAttachments.set(site.declarationContainer, attachments);
			}
			attachments.push(attachment);
		} else {
			state.astNodeReplacements.set(
				site.fn,
				generatedCall(state.helpers.bindThreadFunction, helperArguments, site.fn),
			);
		}
		if (site.kind === state.universalRuntime.thread) {
			const registrationBody = [];
			if (captures.length > 0) {
				registrationBody.push(
					inheritGeneratedOrigin(
						b.let(
							b.array_pattern(captures.map((capture) => b.id(capture.name))),
							b.id(captureParameter),
						),
						site.fn,
					),
				);
			}
			const stripped = inheritGeneratedOrigin(threadFunctionExpression(site), site.fn);
			registrationBody.push(
				inheritGeneratedOrigin(
					b.return(
						b.call(b.member(stripped, 'apply'), b.id(receiverParameter), b.id(argumentParameter)),
					),
					site.fn,
				),
			);
			const runtimeFunction = inheritGeneratedOrigin(
				b.function(
					null,
					[b.id(captureParameter), b.id(receiverParameter), b.id(argumentParameter)],
					b.block(registrationBody),
				),
				site.fn,
			);
			state.threadFunctionRegistrationsAst.push(
				inheritGeneratedOrigin(
					b.stmt(
						generatedCall(
							state.helpers.registerThreadFunction,
							[
								b.literal(site.kind),
								b.literal(id),
								runtimeFunction,
								jsonValueToAst(site.metadata, site.fn),
							],
							site.fn,
						),
					),
					site.fn,
				),
			);
			if (state.hmr) state.threadFunctionDisposals.push({ kind: site.kind, id });
		}
	}
	state.astNodePrefixes ??= new WeakMap();
	for (const [container, attachments] of declarationAttachments) {
		if (container?.type === 'Program') {
			state.threadFunctionRegistrationsAst.push(...attachments);
			continue;
		}
		const firstStatement = (container?.body ?? []).find(
			(statement) => statement?.type !== 'ExpressionStatement' || statement.directive === undefined,
		);
		if (firstStatement === undefined) continue;
		state.astNodePrefixes.set(firstStatement, [
			...(state.astNodePrefixes.get(firstStatement) ?? []),
			...attachments,
		]);
	}

	const importReferences = new Map();
	const visitImportReferences = (node, parent = null, key = null) => {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) {
			for (const child of node) visitImportReferences(child, parent, key);
			return;
		}
		if (
			(node.type === 'Identifier' && isIdentifierReference(node, parent, key, lexicalAnalysis)) ||
			isJsxBindingReference(node, parent, key)
		) {
			const binding = lexicalAnalysis.resolveBinding(
				lexicalAnalysis.nodeScopes.get(node) ?? lexicalAnalysis.rootScope,
				node.name,
			);
			if (binding?.importSource) {
				let references = importReferences.get(binding.importSource);
				if (references === undefined) {
					references = new Map();
					importReferences.set(binding.importSource, references);
				}
				const counts = references.get(node.name) ?? { active: 0, total: 0 };
				counts.total++;
				if (isThreadNodeActive(state, node)) counts.active++;
				references.set(node.name, counts);
			}
		}
		forEachRuntimeAstChild(node, (child, childKey) => visitImportReferences(child, node, childKey));
	};
	visitImportReferences(ast);
	state.threadElidedImportLocations = [];
	for (const node of ast.body ?? []) {
		if (node.type === 'ImportDeclaration' && (node.specifiers?.length ?? 0) > 0) {
			const keptSpecifiers = (node.specifiers ?? []).filter((specifier) => {
				if (node.importKind === 'type' || specifier.importKind === 'type') return true;
				return keepThreadImportBinding(importReferences, node.source, specifier.local?.name);
			});
			if (keptSpecifiers.length === (node.specifiers ?? []).length) continue;
			state.astNodeReplacements.set(
				node,
				keptSpecifiers.length === 0 ? null : { ...node, specifiers: keptSpecifiers },
			);
			if (keptSpecifiers.length === 0 && node.source?.loc?.start) {
				state.threadElidedImportLocations.push(node.source.loc.start);
			}
			continue;
		}
		if (node.type === 'TSImportEqualsDeclaration') {
			const source = node.moduleReference?.expression;
			if (
				node.isExport !== true &&
				isStaticThreadImportSource(source) &&
				!keepThreadImportBinding(importReferences, source, node.id?.name)
			) {
				state.astNodeReplacements.set(node, null);
				if (source.loc?.start) state.threadElidedImportLocations.push(source.loc.start);
			}
			continue;
		}
		if (node.type === 'VariableDeclaration' && node.declare !== true) {
			const removedSources = [];
			const keptDeclarations = (node.declarations ?? []).filter((declaration) => {
				const source = lexicalAnalysis.commonJsSource(
					declaration.init,
					lexicalAnalysis.nodeScopes.get(declaration.init) ?? lexicalAnalysis.rootScope,
				);
				if (!isStaticThreadImportSource(source)) return true;
				const names = new Set();
				addPatternNames(declaration.id, names);
				if (
					names.size === 0 ||
					[...names].some((name) => keepThreadImportBinding(importReferences, source, name))
				) {
					return true;
				}
				removedSources.push(source);
				return false;
			});
			if (keptDeclarations.length === (node.declarations ?? []).length) continue;
			state.astNodeReplacements.set(
				node,
				keptDeclarations.length === 0 ? null : { ...node, declarations: keptDeclarations },
			);
			for (const source of removedSources) {
				if (source.loc?.start) state.threadElidedImportLocations.push(source.loc.start);
			}
		}
	}
}

function isJsxBindingReference(node, parent, key) {
	if (node.type !== 'JSXIdentifier') return false;
	if (
		(parent?.type === 'JSXOpeningElement' || parent?.type === 'JSXClosingElement') &&
		key === 'name'
	) {
		return !/^[a-z]/.test(node.name) && !node.name.includes('-');
	}
	return parent?.type === 'JSXMemberExpression' && key === 'object';
}

function referencedImportSources(ast, lexicalAnalysis, isAuthored, isActive = () => true) {
	const { nodeScopes, resolveBinding, rootScope } = lexicalAnalysis;
	const sources = new Set();
	const seen = new WeakSet();
	const visit = (node, parent = null, key = null) => {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) {
			for (const child of node) visit(child, parent, key);
			return;
		}
		if (seen.has(node)) return;
		seen.add(node);
		if (!isActive(node)) return;
		if (
			isAuthored(node) &&
			((node.type === 'Identifier' && isIdentifierReference(node, parent, key, lexicalAnalysis)) ||
				isJsxBindingReference(node, parent, key))
		) {
			const binding = resolveBinding(nodeScopes.get(node) ?? rootScope, node.name);
			if (binding?.importSource !== null && binding?.importSource !== undefined) {
				sources.add(binding.importSource);
			}
		}
		forEachRuntimeAstChild(node, (child, childKey) => visit(child, node, childKey));
	};
	visit(ast);
	return sources;
}

function importSourceRanges(sources) {
	return [...sources]
		.filter((source) => typeof source.start === 'number' && typeof source.end === 'number')
		.map((source) => Object.freeze({ end: source.end, start: source.start }))
		.sort((left, right) => left.start - right.start || left.end - right.end);
}

/** Validate a renderer-selected helper module without compiling or rewriting it. */
export function validateRendererModuleSource(source, filename, renderer) {
	if (renderer?.validation === undefined) return;
	const ast = parseModule(source, filename);
	validateRendererAst(ast, filename, renderer);
}

/** Reuse renderer restrictions without reparsing an already adopted AST. */
export function validateRendererAst(ast, filename, renderer) {
	if (renderer?.validation === undefined) return;
	validateRendererSource(ast, { filename, renderer });
}

function validateForbiddenGlobals(ast, state, validation, isAuthored, lexicalAnalysis = null) {
	const forbidden = new Set(validation.forbiddenGlobals ?? []);
	if (forbidden.size === 0) return;
	const analysis = lexicalAnalysis ?? createLexicalAnalysis(ast);
	const { nodeScopes, rootScope, isBound } = analysis;
	const references = [];
	const seen = new WeakSet();
	const visitReferences = (node, parent = null, key = null) => {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) {
			for (const child of node) visitReferences(child, parent, key);
			return;
		}
		if (seen.has(node)) return;
		seen.add(node);
		if (!isThreadNodeActive(state, node)) return;
		const scope = nodeScopes.get(node) ?? rootScope;
		if (
			node.type === 'Identifier' &&
			forbidden.has(node.name) &&
			isAuthored(node) &&
			isIdentifierReference(node, parent, key, analysis) &&
			!isBound(scope, node.name)
		) {
			references.push({ name: node.name, node });
		}
		if (
			(node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') &&
			node.object?.type === 'Identifier' &&
			node.object.name === 'globalThis' &&
			!isBound(nodeScopes.get(node.object) ?? scope, 'globalThis')
		) {
			const name = node.computed ? node.property?.value : node.property?.name;
			if (typeof name === 'string' && forbidden.has(name) && isAuthored(node.property ?? node)) {
				references.push({ name, node: node.property ?? node });
			}
		}
		forEachRuntimeAstChild(node, (child, childKey) => visitReferences(child, node, childKey));
	};
	visitReferences(ast);
	if (references.length > 0) {
		references.sort((left, right) => (left.node.start ?? 0) - (right.node.start ?? 0));
		const reference = references[0];
		throw universalError(
			state.filename,
			reference.node,
			`renderer ${JSON.stringify(state.renderer.id)} forbids unbound global ${JSON.stringify(reference.name)}.`,
		);
	}
}

function hostPropMatches(name, pattern) {
	return pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern;
}

function validationAttributeName(attribute) {
	const direct = attributeName(attribute);
	if (direct !== null) return direct;
	const name = attribute?.name;
	if (name?.type !== 'JSXNamespacedName') return null;
	const namespace = name.namespace?.name;
	const local = name.name?.name;
	return typeof namespace === 'string' && typeof local === 'string'
		? `${namespace}:${local}`
		: null;
}

function isStaticallyPrimitiveTextExpression(node) {
	if (!node || typeof node !== 'object') return false;
	if (
		node.type === 'ParenthesizedExpression' ||
		node.type === 'ChainExpression' ||
		node.type === 'TSNonNullExpression' ||
		node.type === 'TSSatisfiesExpression'
	) {
		return isStaticallyPrimitiveTextExpression(node.expression);
	}
	if (node.type === 'TSAsExpression' || node.type === 'TSTypeAssertion') {
		if (
			node.typeAnnotation?.type === 'TSStringKeyword' ||
			node.typeAnnotation?.type === 'TSNumberKeyword' ||
			node.typeAnnotation?.type === 'TSBigIntKeyword'
		) {
			return true;
		}
		return isStaticallyPrimitiveTextExpression(node.expression);
	}
	if (node.type === 'Literal') {
		return (
			typeof node.value === 'string' ||
			typeof node.value === 'number' ||
			typeof node.value === 'bigint'
		);
	}
	if (node.type === 'TemplateLiteral' || node.type === 'UpdateExpression') return true;
	if (node.type === 'UnaryExpression') {
		return (
			node.operator === '+' ||
			node.operator === '-' ||
			node.operator === '~' ||
			node.operator === 'typeof'
		);
	}
	if (node.type === 'BinaryExpression') {
		return ['+', '-', '*', '/', '%', '**', '<<', '>>', '>>>', '&', '|', '^'].includes(
			node.operator,
		);
	}
	if (node.type === 'ConditionalExpression') {
		return (
			isStaticallyPrimitiveTextExpression(node.consequent) &&
			isStaticallyPrimitiveTextExpression(node.alternate)
		);
	}
	if (node.type === 'SequenceExpression') {
		return isStaticallyPrimitiveTextExpression(node.expressions?.at(-1));
	}
	return false;
}

function validateHostTemplates(ast, state, validation, isAuthored) {
	const textParents = validation.textParents === undefined ? null : new Set(validation.textParents);
	const textHosts = validation.textHosts === undefined ? null : new Set(validation.textHosts);
	const hostProps = validation.hostProps;
	if (textParents === null && textHosts === null && hostProps === undefined) return;
	const sharedProps = hostProps?.['*'] ?? [];
	const seen = new WeakSet();
	const visit = (node, nearestHost = null) => {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) {
			for (const child of node) visit(child, nearestHost);
			return;
		}
		if (seen.has(node)) return;
		seen.add(node);
		if (node.type === 'JSXText') {
			if (
				textParents !== null &&
				nearestHost !== null &&
				isAuthored(node) &&
				normalizeJsxText(node.value ?? '') !== '' &&
				!textParents.has(nearestHost)
			) {
				throw universalError(
					state.filename,
					node,
					`renderer ${JSON.stringify(state.renderer.id)} does not allow authored JSX text under <${nearestHost}>.`,
				);
			}
			return;
		}
		if (node.type === 'JSXExpressionContainer') {
			if (
				textParents !== null &&
				nearestHost !== null &&
				!textParents.has(nearestHost) &&
				isAuthored(node) &&
				isStaticallyPrimitiveTextExpression(node.expression)
			) {
				throw universalError(
					state.filename,
					node.expression,
					`renderer ${JSON.stringify(state.renderer.id)} does not allow authored primitive text under <${nearestHost}>.`,
				);
			}
			visit(node.expression, nearestHost);
			return;
		}
		if (node.type === 'JSXElement' || node.type === 'Element') {
			const name = jsxName(node);
			const isHost = name !== null && /^[a-z]/.test(name) && !isComponentElement(node);
			// A component owns the eventual placement of its children. Do not carry
			// the caller's nearest host through that semantic boundary; the component
			// body is validated independently at the host site it actually authors.
			const nextHost = isHost ? name : null;
			if (
				isHost &&
				textHosts !== null &&
				textHosts.has(name) &&
				nearestHost !== null &&
				(textParents === null || !textParents.has(nearestHost)) &&
				isAuthored(node)
			) {
				throw universalError(
					state.filename,
					node,
					`renderer ${JSON.stringify(state.renderer.id)} does not allow <${name}> under <${nearestHost}>.`,
				);
			}
			const attributes = node.openingElement?.attributes ?? node.attributes ?? [];
			if (isHost && hostProps !== undefined && Object.hasOwn(hostProps, name)) {
				const tagProps = hostProps[name];
				for (const attribute of attributes) {
					if (
						attribute.type === 'JSXSpreadAttribute' ||
						attribute.type === 'SpreadAttribute' ||
						!isAuthored(attribute)
					) {
						continue;
					}
					const attributeValue = validationAttributeName(attribute);
					if (
						attributeValue === null ||
						attributeValue === 'key' ||
						attributeValue === 'children' ||
						sharedProps.some((pattern) => hostPropMatches(attributeValue, pattern)) ||
						tagProps.some((pattern) => hostPropMatches(attributeValue, pattern))
					) {
						continue;
					}
					throw universalError(
						state.filename,
						attribute,
						`renderer ${JSON.stringify(state.renderer.id)} does not allow static attribute ${JSON.stringify(attributeValue)} on <${name}>.`,
					);
				}
			}
			for (const attribute of attributes) {
				if (attribute.type === 'JSXSpreadAttribute' || attribute.type === 'SpreadAttribute') {
					visit(attribute.argument, null);
					continue;
				}
				const attributeHost =
					isHost && validationAttributeName(attribute) === 'children' ? nextHost : null;
				visit(attribute.value, attributeHost);
			}
			visit(node.children ?? [], nextHost);
			return;
		}
		if (node.type === 'JSXFragment' || node.type === 'Fragment') {
			visit(node.children ?? [], nearestHost);
			return;
		}
		forEachRuntimeAstChild(node, (child) => visit(child, nearestHost));
	};
	visit(ast);
}

function validateRendererSource(ast, state) {
	const validation = state.renderer.validation;
	if (validation === undefined) return;
	const isAuthored = () => true;
	const needsLexicalAnalysis =
		(validation.forbiddenImports?.length ?? 0) > 0 ||
		(validation.forbiddenGlobals?.length ?? 0) > 0;
	const lexicalAnalysis = needsLexicalAnalysis ? createLexicalAnalysis(ast) : null;
	validateForbiddenImports(ast, state, validation, isAuthored, lexicalAnalysis);
	validateForbiddenGlobals(ast, state, validation, isAuthored, lexicalAnalysis);
	validateHostTemplates(ast, state, validation, isAuthored);
}

function validateRendererSourceRanges(ast, state, ranges, exclusions = []) {
	const validation = state.renderer.validation;
	if (validation === undefined) return;
	const selected = ranges.filter(
		(range) =>
			typeof range?.start === 'number' &&
			typeof range?.end === 'number' &&
			range.end >= range.start,
	);
	const staticModuleSources = new WeakSet();
	for (const statement of ast.body ?? []) {
		const source =
			statement.type === 'TSImportEqualsDeclaration'
				? statement.moduleReference?.expression
				: statement.source;
		if (source && typeof source === 'object') staticModuleSources.add(source);
	}
	const isSelected = (node) =>
		typeof node?.start === 'number' &&
		typeof node?.end === 'number' &&
		selected.some((range) => range.start <= node.start && node.end <= range.end) &&
		!exclusions.some(
			(range) =>
				typeof range?.start === 'number' &&
				typeof range?.end === 'number' &&
				range.start <= node.start &&
				node.end <= range.end,
		);
	const isAuthored = (node) => isSelected(node) && !staticModuleSources.has(node);
	const needsLexicalAnalysis =
		(validation.forbiddenImports?.length ?? 0) > 0 ||
		(validation.forbiddenGlobals?.length ?? 0) > 0;
	const lexicalAnalysis = needsLexicalAnalysis ? createLexicalAnalysis(ast) : null;
	if (lexicalAnalysis !== null) {
		const referencedStaticSources = referencedImportSources(
			ast,
			lexicalAnalysis,
			isAuthored,
			(node) => isThreadNodeActive(state, node),
		);
		state.validationImportReferences = importSourceRanges(referencedStaticSources);
		validateForbiddenImports(
			ast,
			state,
			validation,
			isAuthored,
			lexicalAnalysis,
			referencedStaticSources,
		);
		validateForbiddenGlobals(ast, state, validation, isAuthored, lexicalAnalysis);
	}
	validateHostTemplates(ast, state, validation, isAuthored);
}

function collectAuthoredHookSites(fn, state) {
	const sites = [];
	const seen = new WeakSet();
	const visit = (node) => {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) {
			for (const child of node) visit(child);
			return;
		}
		if (seen.has(node)) return;
		seen.add(node);
		if (
			node !== fn &&
			(node.type === 'FunctionDeclaration' ||
				node.type === 'FunctionExpression' ||
				node.type === 'ArrowFunctionExpression')
		) {
			return;
		}
		if (node.type === 'CallExpression') {
			let name = null;
			if (node.callee?.type === 'Identifier') {
				name = state.runtimeImports.get(node.callee.name) ?? node.callee.name;
			} else if (
				node.callee?.type === 'MemberExpression' &&
				!node.callee.computed &&
				node.callee.property?.type === 'Identifier'
			) {
				name = node.callee.property.name;
			}
			if (name === 'use' || name === 'useContext' || /^use[A-Z]/.test(name ?? '')) {
				const loc = node.loc?.start;
				sites.push({
					name,
					line: loc?.line ?? 0,
					column: loc?.column ?? 0,
				});
			}
		}
		for (const [key, child] of Object.entries(node)) {
			if (key === 'loc' || key === 'start' || key === 'end' || key === 'metadata') continue;
			visit(child);
		}
	};
	visit(fn.body);
	return sites;
}

function jsxName(node) {
	const name = node?.openingElement?.name ?? node?.name;
	return name?.type === 'JSXIdentifier' ? name.name : null;
}

function attributeName(attribute) {
	return attribute?.name?.type === 'JSXIdentifier' ? attribute.name.name : null;
}

function hostAttributeName(attribute, state) {
	const direct = attributeName(attribute);
	if (direct !== null) return direct;
	const name = attribute?.name;
	if (
		!rendererHasCapability(state, THREAD_FUNCTION_CAPABILITY) ||
		name?.type !== 'JSXNamespacedName' ||
		name.namespace?.name !== 'main-thread' ||
		typeof name.name?.name !== 'string'
	) {
		return null;
	}
	return `main-thread:${name.name.name}`;
}

function canonicalHostAttributeName(name, canonicalizeHostClass) {
	return canonicalizeHostClass && name === 'className' ? 'class' : name;
}

function isComponentElement(node) {
	const name = node?.openingElement?.name ?? node?.name;
	if (name?.type === 'JSXMemberExpression' || name?.type === 'MemberExpression') return true;
	if (name?.type === 'JSXExpressionContainer') return true;
	const value = name?.name;
	return typeof value === 'string' && !/^[a-z]/.test(value) && !value.includes('-');
}

function collectComponentNames(ast) {
	const names = new Set();
	const seen = new WeakSet();
	const visit = (node) => {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) {
			for (const child of node) visit(child);
			return;
		}
		if (seen.has(node)) return;
		seen.add(node);
		if ((node.type === 'JSXElement' || node.type === 'Element') && isComponentElement(node)) {
			const name = node.openingElement?.name ?? node.name;
			if (name?.type === 'JSXIdentifier' || name?.type === 'Identifier') names.add(name.name);
		}
		for (const [key, value] of Object.entries(node)) {
			if (key === 'loc' || key === 'start' || key === 'end' || key === 'metadata') continue;
			visit(value);
		}
	};
	visit(ast);
	return names;
}

function collectExplicitThreeHostIntrinsics(ast, renderer) {
	if (renderer.id !== 'three' || renderer.module !== '@octanejs/three/renderer') return null;
	const aliases = new Set();
	for (const statement of ast.body ?? []) {
		if (
			statement.type !== 'ImportDeclaration' ||
			statement.importKind === 'type' ||
			statement.source?.value !== '@octanejs/three'
		) {
			continue;
		}
		for (const specifier of statement.specifiers ?? []) {
			if (
				specifier.type === 'ImportSpecifier' &&
				specifier.importKind !== 'type' &&
				(specifier.imported?.name ?? specifier.imported?.value) === 'extend' &&
				typeof specifier.local?.name === 'string'
			) {
				aliases.add(specifier.local.name);
			}
		}
	}
	if (aliases.size === 0) return null;
	const intrinsics = new Map();
	for (const statement of ast.body ?? []) {
		if (statement.type !== 'ExpressionStatement') continue;
		const call = statement.expression;
		if (
			call?.type !== 'CallExpression' ||
			call.optional === true ||
			call.callee?.type !== 'Identifier' ||
			!aliases.has(call.callee.name) ||
			call.arguments?.length !== 1 ||
			call.arguments[0]?.type !== 'ObjectExpression' ||
			typeof statement.end !== 'number'
		) {
			continue;
		}
		for (const property of call.arguments[0].properties ?? []) {
			if (property.type !== 'Property' || property.kind !== 'init' || property.method === true) {
				continue;
			}
			const key =
				property.key?.type === 'Identifier' && property.computed !== true
					? property.key.name
					: property.key?.type === 'Literal' && typeof property.key.value === 'string'
						? property.key.value
						: null;
			if (key !== null && THREE_BUILTIN_CONSTRUCTORS.has(key) && !intrinsics.has(key)) {
				intrinsics.set(key, statement.end);
			}
		}
	}
	return intrinsics.size === 0 ? null : intrinsics;
}

function collectOwnerFreeThreeHostComponents(ast, state, development) {
	if (
		development ||
		state.hmr ||
		state.profile ||
		state.renderer.id !== 'three' ||
		state.renderer.module !== '@octanejs/three/renderer'
	) {
		return null;
	}

	const constructors = new Set();
	for (const statement of ast.body ?? []) {
		if (
			statement.type !== 'ImportDeclaration' ||
			statement.importKind === 'type' ||
			statement.source?.value !== '@octanejs/three'
		) {
			continue;
		}
		for (const specifier of statement.specifiers ?? []) {
			if (
				specifier.type === 'ImportSpecifier' &&
				specifier.importKind !== 'type' &&
				(specifier.imported?.name ?? specifier.imported?.value) === 'extend' &&
				typeof specifier.local?.name === 'string'
			) {
				constructors.add(specifier.local.name);
			}
		}
	}
	if (constructors.size === 0) return null;

	const names = new Set();
	for (const statement of ast.body ?? []) {
		const declaration =
			statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
		if (declaration?.type !== 'VariableDeclaration' || declaration.kind !== 'const') continue;
		for (const binding of declaration.declarations ?? []) {
			const call = binding.init;
			if (
				binding.id?.type === 'Identifier' &&
				call?.type === 'CallExpression' &&
				call.optional !== true &&
				call.callee?.type === 'Identifier' &&
				constructors.has(call.callee.name) &&
				call.arguments?.length === 1 &&
				call.arguments[0]?.type !== 'SpreadElement'
			) {
				names.add(binding.id.name);
			}
		}
	}
	return names.size === 0 ? null : { names, lexical: createLexicalAnalysis(ast) };
}

function addPatternNames(pattern, names) {
	if (!pattern) return;
	if (pattern.type === 'Identifier') {
		names.add(pattern.name);
		return;
	}
	if (pattern.type === 'RestElement') {
		addPatternNames(pattern.argument, names);
		return;
	}
	if (pattern.type === 'AssignmentPattern') {
		addPatternNames(pattern.left, names);
		return;
	}
	if (pattern.type === 'ArrayPattern') {
		for (const element of pattern.elements ?? []) addPatternNames(element, names);
		return;
	}
	if (pattern.type === 'ObjectPattern') {
		for (const property of pattern.properties ?? []) {
			addPatternNames(property.argument ?? property.value, names);
		}
	}
}

function collectEntryCaptures(expression, excluded) {
	const lexicalAnalysis = createLexicalAnalysis(expression);
	const { nodeScopes, resolveBinding, rootScope } = lexicalAnalysis;
	const found = new Map();
	const visit = (node, parent = null, key = null) => {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) {
			for (const child of node) visit(child, parent, key);
			return;
		}
		if (node.type === 'Identifier' && isIdentifierReference(node, parent, key, lexicalAnalysis)) {
			if (
				resolveBinding(nodeScopes.get(node) ?? rootScope, node.name) === null &&
				!excluded.has(node.name)
			) {
				const entry = found.get(node.name) ?? { offset: Infinity, nodes: [] };
				entry.offset = Math.min(entry.offset, node.start ?? Infinity);
				entry.nodes.push(node);
				found.set(node.name, entry);
			}
			return;
		}
		forEachRuntimeAstChild(node, (child, childKey) => visit(child, node, childKey));
	};
	visit(expression);
	return [...found]
		.sort((left, right) => left[1].offset - right[1].offset)
		.map(([source, entry]) => ({ source, nodes: entry.nodes }));
}

function collectIdentifierNodes(root, names) {
	const output = new Map([...names].map((name) => [name, []]));
	const seen = new WeakSet();
	const visit = (node) => {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) {
			for (const child of node) visit(child);
			return;
		}
		if (seen.has(node)) return;
		seen.add(node);
		if (node.type === 'Identifier' && output.has(node.name)) output.get(node.name).push(node);
		for (const [key, child] of Object.entries(node)) {
			if (key === 'loc' || key === 'start' || key === 'end' || key === 'metadata') continue;
			visit(child);
		}
	};
	visit(root);
	return output;
}

function normalizeJsxText(value) {
	const lines = String(value).replace(/\r/g, '').split('\n');
	let output = '';
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index].replace(/\t/g, ' ');
		const text = index === 0 ? line.replace(/\s+$/g, '') : line.trim();
		if (text === '') continue;
		if (output !== '' && !output.endsWith(' ')) output += ' ';
		output += text;
	}
	return output;
}

function allocName(state, preferred) {
	let name = preferred;
	while (state.source.includes(name) || state.names.has(name)) name += '$';
	state.names.add(name);
	return name;
}

function rendererHasCapability(state, capability) {
	return Array.isArray(state.renderer.capabilities)
		? state.renderer.capabilities.includes(capability)
		: false;
}

const TEXT_CHILD_PROP_CAPABILITY = 'text-child-prop';
const TEXT_CONTENT_PROP = 'text';

// #242 Cause A. Some renderers give a text element the same content twice over:
// once as a `text` prop it accepts directly, and once as a child carrier element
// that holds nothing but that string. Where the compiler already knows the
// string, the carrier is a second element painted, addressed, retained and torn
// down to say what the parent could have said itself.
//
// A renderer opts in with the capability, which is the semantic claim that the
// prop and the child render identically, and names the hosts it holds for by
// listing `text` among their accepted props. Both are load-bearing: the
// capability alone would not say *which* elements have the prop, and `hostProps`
// alone would not say that setting it is equivalent to painting a child.
function hostAbsorbsTextChild(type, state) {
	if (!rendererHasCapability(state, TEXT_CHILD_PROP_CAPABILITY)) return false;
	const hostProps = state.renderer.validation?.hostProps;
	return Array.isArray(hostProps?.[type]) && hostProps[type].includes(TEXT_CONTENT_PROP);
}

// This proof deliberately covers data expressions, not arbitrary authored calls.
// Property reads can still reach getters or proxies, so the universal runtime
// lazily claims the keyed item owner if one invokes a hook or renderer region.
function isOwnerFreeForExpression(node) {
	if (!node || typeof node !== 'object') return false;
	if (node.type === 'Literal' || node.type === 'Identifier') return true;
	if (node.type === 'ArrayExpression') {
		return (node.elements ?? []).every(
			(element) =>
				element !== null && element.type !== 'SpreadElement' && isOwnerFreeForExpression(element),
		);
	}
	if (node.type === 'MemberExpression') {
		return (
			isOwnerFreeForExpression(node.object) &&
			(!node.computed || isOwnerFreeForExpression(node.property))
		);
	}
	if (
		node.type === 'ParenthesizedExpression' ||
		node.type === 'ChainExpression' ||
		node.type === 'TSAsExpression' ||
		node.type === 'TSNonNullExpression' ||
		node.type === 'TypeCastExpression'
	) {
		return isOwnerFreeForExpression(node.expression);
	}
	return false;
}

function isOwnerFreeForAttribute(attribute) {
	if (attribute.type === 'JSXSpreadAttribute' || attribute.type === 'SpreadAttribute') return false;
	const name = attributeName(attribute);
	if (
		name === null ||
		name === 'key' ||
		name === 'ref' ||
		name === 'children' ||
		name === 'attach' ||
		name === 'onUpdate' ||
		name.startsWith('on')
	) {
		return false;
	}
	const value = attribute.value;
	if (value === null || value?.type === 'Literal') return true;
	return (
		value?.type === 'JSXExpressionContainer' &&
		value.expression?.type !== 'JSXEmptyExpression' &&
		isOwnerFreeForExpression(value.expression)
	);
}

function ownerFreeForLeaf(node) {
	if (node.empty != null) return null;
	if (!isOwnerFreeForExpression(node.right) || !isOwnerFreeForExpression(node.key)) return null;
	const body = (node.body?.body ?? []).filter(
		(statement) => statement.type !== 'JSXText' || normalizeJsxText(statement.value ?? '') !== '',
	);
	if (body.length !== 1) return null;
	const leaf = body[0];
	if (leaf.type !== 'JSXElement' && leaf.type !== 'Element') return null;
	if (
		(leaf.children ?? []).some(
			(child) => child.type !== 'JSXText' || normalizeJsxText(child.value ?? '') !== '',
		)
	) {
		return null;
	}
	const attributes = leaf.openingElement?.attributes ?? leaf.attributes ?? [];
	return attributes.every(isOwnerFreeForAttribute) ? leaf : null;
}

function ownerFreeForHost(node) {
	const host = ownerFreeForLeaf(node);
	if (host === null || isComponentElement(host) || jsxName(host) === 'Activity') return null;
	const type = jsxName(host);
	return type !== null && /^[a-z]/.test(type) ? host : null;
}

function ownerFreeForThreeHostComponent(node, state) {
	const trusted = state.ownerFreeThreeHostComponents;
	if (trusted == null) return null;
	const component = ownerFreeForLeaf(node);
	if (component === null || !isComponentElement(component)) return null;
	const attributes = component.openingElement?.attributes ?? component.attributes ?? [];
	const attributesSeen = new Set();
	for (const attribute of attributes) {
		const attributeKey = attributeName(attribute);
		if (attributeKey === '__proto__' || attributesSeen.has(attributeKey)) return null;
		attributesSeen.add(attributeKey);
	}
	const name = component.openingElement?.name ?? component.name;
	if (name?.type !== 'JSXIdentifier' || !trusted.names.has(name.name)) return null;
	const binding = trusted.lexical.resolveBinding(
		trusted.lexical.nodeScopes.get(name) ?? trusted.lexical.rootScope,
		name.name,
	);
	return binding?.scope === trusted.lexical.rootScope ? component : null;
}

function isTemplateProgramForExpression(node) {
	if (isOwnerFreeForExpression(node)) return true;
	if (!node || typeof node !== 'object') return false;
	if (node.type === 'TemplateLiteral') {
		return (node.expressions ?? []).every(isTemplateProgramForExpression);
	}
	if (node.type === 'ConditionalExpression') {
		return (
			isTemplateProgramForExpression(node.test) &&
			isTemplateProgramForExpression(node.consequent) &&
			isTemplateProgramForExpression(node.alternate)
		);
	}
	if (node.type === 'BinaryExpression' || node.type === 'LogicalExpression') {
		return isTemplateProgramForExpression(node.left) && isTemplateProgramForExpression(node.right);
	}
	if (node.type === 'UnaryExpression') return isTemplateProgramForExpression(node.argument);
	if (
		node.type === 'ParenthesizedExpression' ||
		node.type === 'ChainExpression' ||
		node.type === 'TSAsExpression' ||
		node.type === 'TSNonNullExpression' ||
		node.type === 'TypeCastExpression'
	) {
		return isTemplateProgramForExpression(node.expression);
	}
	return false;
}

function isTemplateProgramForHost(node, state) {
	if (
		(node.type !== 'JSXElement' && node.type !== 'Element') ||
		isComponentElement(node) ||
		jsxName(node) === 'Activity'
	) {
		return false;
	}
	const type = jsxName(node);
	if (type === null || !/^[a-z]/.test(type) || type === 'list' || type === 'list-item') {
		return false;
	}
	for (const attribute of node.openingElement?.attributes ?? node.attributes ?? []) {
		if (attribute.type === 'JSXSpreadAttribute' || attribute.type === 'SpreadAttribute') {
			return false;
		}
		// A `main-thread:` prop is a namespaced name, which `attributeName` cannot
		// read, so resolving it here is what lets one be considered at all.
		const name = hostAttributeName(attribute, state);
		if (
			name === null ||
			name === 'key' ||
			name === 'ref' ||
			name === 'children' ||
			name === 'hidden' ||
			name === 'attach' ||
			name === 'onUpdate'
		) {
			return false;
		}
		const value = attribute.value;
		if (name.startsWith('main-thread:')) {
			// A worklet and a ref cell are both produced by the setup body and never
			// written as a literal, so a main-thread prop belongs in a program exactly
			// when it arrives as a per-instance binding. A literal one is refused,
			// which is the same answer the program derivation gives a static one.
			if (
				value?.type !== 'JSXExpressionContainer' ||
				value.expression?.type === 'JSXEmptyExpression' ||
				!isTemplateProgramForExpression(value.expression)
			) {
				return false;
			}
			continue;
		}
		if (value === null || value?.type === 'Literal') continue;
		if (value?.type !== 'JSXExpressionContainer') return false;
		const expression = value.expression;
		if (expression?.type === 'JSXEmptyExpression') return false;
		const event = /^(?:bind|catch|capture-bind|capture-catch|global-bind)/.test(name);
		if (
			event &&
			(expression.type === 'ArrowFunctionExpression' || expression.type === 'FunctionExpression')
		) {
			continue;
		}
		if (!isTemplateProgramForExpression(expression)) return false;
	}
	for (const child of node.children ?? []) {
		if (child.type === 'JSXText') continue;
		if (child.type === 'JSXExpressionContainer') {
			if (!isTemplateProgramForExpression(child.expression)) return false;
			continue;
		}
		if (!isTemplateProgramForHost(child, state)) return false;
	}
	return true;
}

function templateProgramForHost(node, state) {
	if (
		node.empty != null ||
		!rendererHasCapability(state, 'template-program-mount') ||
		!isOwnerFreeForExpression(node.right) ||
		!isOwnerFreeForExpression(node.key)
	) {
		return false;
	}
	const body = (node.body?.body ?? []).filter(
		(statement) => statement.type !== 'JSXText' || normalizeJsxText(statement.value ?? '') !== '',
	);
	return body.length === 1 && isTemplateProgramForHost(body[0], state);
}

function templateProgramForComponent(node, state) {
	if (
		node.empty != null ||
		(!rendererHasCapability(state, 'template-program-mount') &&
			!rendererHasCapability(state, COMPONENT_SCOPE_FOR_CAPABILITY)) ||
		!isOwnerFreeForExpression(node.right) ||
		!isOwnerFreeForExpression(node.key)
	) {
		return null;
	}
	const body = (node.body?.body ?? []).filter(
		(statement) => statement.type !== 'JSXText' || normalizeJsxText(statement.value ?? '') !== '',
	);
	if (body.length !== 1) return null;
	const component = body[0];
	if (
		(component.type !== 'JSXElement' && component.type !== 'Element') ||
		!isComponentElement(component) ||
		(component.openingElement?.name ?? component.name)?.type !== 'JSXIdentifier' ||
		(component.children ?? []).some(
			(child) => child.type !== 'JSXText' || normalizeJsxText(child.value ?? '') !== '',
		)
	) {
		return null;
	}
	const names = new Set();
	for (const attribute of component.openingElement?.attributes ?? component.attributes ?? []) {
		if (attribute.type === 'JSXSpreadAttribute' || attribute.type === 'SpreadAttribute') {
			return null;
		}
		const name = attributeName(attribute);
		if (
			name === null ||
			name === 'key' ||
			name === 'ref' ||
			name === 'children' ||
			name === '__proto__' ||
			names.has(name)
		) {
			return null;
		}
		names.add(name);
		const value = attribute.value;
		if (value === null || value?.type === 'Literal') continue;
		if (
			value?.type !== 'JSXExpressionContainer' ||
			value.expression?.type === 'JSXEmptyExpression' ||
			!isTemplateProgramForExpression(value.expression)
		) {
			return null;
		}
	}
	return component;
}

function allocPlan(state, root, origin = null) {
	const name = allocName(
		state,
		state.planPrefix
			? `${state.planPrefix}Plan${state.plans.length}`
			: `__octaneUniversalPlan${state.plans.length}`,
	);
	state.plans.push({ name, root, origin });
	return name;
}

function functionName(node) {
	return node?.id?.name ?? null;
}

function singleFunctionDeclarator(node, state) {
	if (node?.type !== 'VariableDeclaration' || node.declarations?.length !== 1) return null;
	const declaration = node.declarations[0];
	if (declaration.id?.type !== 'Identifier') return null;
	if (
		declaration.init?.type === 'ArrowFunctionExpression' ||
		declaration.init?.type === 'FunctionExpression'
	) {
		return { fn: declaration.init, name: declaration.id.name, binding: declaration.id };
	}
	const call = declaration.init;
	if (
		call?.type !== 'CallExpression' ||
		call.callee?.type !== 'Identifier' ||
		(state.runtimeImports.get(call.callee.name) ?? call.callee.name) !== 'memo'
	) {
		return null;
	}
	const fn = call.arguments?.[0];
	if (fn?.type !== 'ArrowFunctionExpression' && fn?.type !== 'FunctionExpression') return null;
	return {
		fn,
		name: declaration.id.name,
		binding: declaration.id,
		wrapper: {
			callee: call.callee,
			arguments: call.arguments.slice(1),
		},
	};
}

function componentShape(node, state) {
	if (node.type === 'FunctionDeclaration') {
		if (state.threadFunctionNodes?.has(node)) return null;
		return { fn: node, name: functionName(node), binding: node.id, exportKind: null };
	}
	const variable = singleFunctionDeclarator(node, state);
	if (variable !== null) {
		if (state.threadFunctionNodes?.has(variable.fn)) return null;
		return { ...variable, exportKind: null };
	}
	if (node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'FunctionDeclaration') {
		if (state.threadFunctionNodes?.has(node.declaration)) return null;
		return {
			fn: node.declaration,
			name: functionName(node.declaration),
			binding: node.declaration.id,
			exportKind: 'named',
		};
	}
	if (node.type === 'ExportNamedDeclaration') {
		const exportedVariable = singleFunctionDeclarator(node.declaration, state);
		if (exportedVariable !== null) {
			if (state.threadFunctionNodes?.has(exportedVariable.fn)) return null;
			return { ...exportedVariable, exportKind: 'named' };
		}
	}
	if (
		node.type === 'ExportDefaultDeclaration' &&
		node.declaration?.type === 'FunctionDeclaration'
	) {
		if (state.threadFunctionNodes?.has(node.declaration)) return null;
		return {
			fn: node.declaration,
			name: functionName(node.declaration),
			binding: node.declaration.id,
			exportKind: 'default',
		};
	}
	if (
		node.type === 'ExportDefaultDeclaration' &&
		(node.declaration?.type === 'ArrowFunctionExpression' ||
			node.declaration?.type === 'FunctionExpression')
	) {
		if (state.threadFunctionNodes?.has(node.declaration)) return null;
		return {
			fn: node.declaration,
			name: node.declaration.id?.name ?? null,
			exportKind: 'default',
		};
	}
	return null;
}

function hasOwnTemplateReturn(fn) {
	let found = false;
	const seen = new WeakSet();
	const returnContainsTemplate = (node) => {
		let contains = false;
		const visited = new WeakSet();
		const visitReturn = (value) => {
			if (contains || !value || typeof value !== 'object') return;
			if (Array.isArray(value)) {
				for (const child of value) visitReturn(child);
				return;
			}
			if (visited.has(value)) return;
			visited.add(value);
			if (isTemplateNode(value)) {
				contains = true;
				return;
			}
			if (
				value.type === 'FunctionDeclaration' ||
				value.type === 'FunctionExpression' ||
				value.type === 'ArrowFunctionExpression'
			) {
				return;
			}
			for (const [key, child] of Object.entries(value)) {
				if (key === 'loc' || key === 'start' || key === 'end' || key === 'metadata') continue;
				visitReturn(child);
			}
		};
		visitReturn(node);
		return contains;
	};
	const visit = (node, nested = false) => {
		if (found || !node || typeof node !== 'object') return;
		if (Array.isArray(node)) {
			for (const child of node) visit(child, nested);
			return;
		}
		if (seen.has(node)) return;
		seen.add(node);
		if (
			node !== fn &&
			(node.type === 'FunctionDeclaration' ||
				node.type === 'FunctionExpression' ||
				node.type === 'ArrowFunctionExpression')
		) {
			return;
		}
		if (node.type === 'ReturnStatement' && node.argument && returnContainsTemplate(node.argument)) {
			found = true;
			return;
		}
		for (const [key, value] of Object.entries(node)) {
			if (key === 'loc' || key === 'start' || key === 'end' || key === 'metadata') continue;
			visit(value, nested);
		}
	};
	visit(fn.body);
	return found;
}

function componentRender(fn, state, force = false) {
	if (fn.async || fn.generator) {
		throw universalError(
			state.filename,
			fn,
			'async/generator component functions are not supported yet.',
		);
	}
	if (fn.body?.type === 'JSXCodeBlock') {
		return {
			setup: fn.body.body ?? [],
			render: fn.body.render,
		};
	}
	if (fn.body?.type !== 'BlockStatement') {
		if (!force && !isTemplateNode(fn.body)) return null;
		return { setup: [], render: isTemplateNode(fn.body) ? fn.body : null, expression: fn.body };
	}
	if (!force && !hasOwnTemplateReturn(fn) && !state.componentNames.has(functionName(fn)))
		return null;
	return { setup: fn.body.body ?? [], render: null };
}

function jsxNameExpressionAst(node, state) {
	const name = node?.openingElement?.name ?? node?.name;
	if (name?.type === 'JSXIdentifier' || name?.type === 'Identifier') {
		return generatedIdentifier(name.name, name);
	}
	if (name?.type === 'JSXMemberExpression' || name?.type === 'MemberExpression') {
		return inheritGeneratedOrigin(
			b.member(
				jsxNameExpressionAst({ name: name.object }, state),
				name.property?.name ?? name.property?.value,
			),
			name,
		);
	}
	if (name?.type === 'JSXExpressionContainer') {
		assertNoResidualTemplate(name.expression, state, 'a dynamic component name');
		return rewriteSourceAst(name.expression, state);
	}
	throw universalError(state.filename, node, 'unsupported JSX tag name.');
}

function contextProviderExpressionAst(node, state) {
	const name = node?.openingElement?.name ?? node?.name;
	if (
		(name?.type === 'JSXMemberExpression' || name?.type === 'MemberExpression') &&
		(name.property?.name ?? name.property?.value) === 'Provider'
	) {
		return jsxNameExpressionAst({ name: name.object }, state);
	}
	return null;
}

function compileRenderableExpressionAst(node, state) {
	const context = { values: [] };
	const nodes = compileChildAst(node, context, state);
	const root =
		nodes.length === 1 ? nodes[0] : withPlanOrigin({ kind: 'range', children: nodes }, node);
	const plan = allocPlan(state, root, node);
	return generatedCall(
		state.helpers.value,
		[generatedIdentifier(plan, node), inheritGeneratedOrigin(b.array(context.values), node)],
		node,
	);
}

function rewriteSourceAst(node, state) {
	if (!node || typeof node !== 'object') return node;
	const visit = (value) => {
		if (!value || typeof value !== 'object') return value;
		if (Array.isArray(value)) {
			let output = null;
			for (let index = 0; index < value.length; index++) {
				const prefixes = state.astNodePrefixes?.get(value[index]) ?? [];
				if (prefixes.length > 0 && output === null) output = value.slice(0, index);
				if (output !== null) {
					for (const prefix of prefixes) {
						const mappedPrefix = visit(prefix);
						if (mappedPrefix !== null) output.push(mappedPrefix);
					}
				}
				const mapped = visit(value[index]);
				if (output === null && mapped !== value[index]) output = value.slice(0, index);
				if (output !== null && mapped !== null) output.push(mapped);
			}
			return output ?? value;
		}
		const replacement = state.astNodeReplacements?.get(value);
		if (replacement !== undefined) return replacement;
		if (value !== node && isTemplateNode(value)) {
			return compileRenderableExpressionAst(value, state);
		}
		let output = null;
		for (const [key, child] of Object.entries(value)) {
			if (AST_SKIP_KEYS.has(key)) continue;
			const mapped = visit(child);
			if (mapped !== child) {
				if (output === null) output = { ...value };
				output[key] = mapped;
			}
		}
		return output ?? value;
	};
	return visit(node);
}

function dynamicExpressionAst(node, state) {
	return rewriteSourceAst(node, state);
}

function firstScreenEventValueAst(expression, state) {
	const value = unwrapFirstScreenExpression(expression);
	if (value?.type === 'ArrowFunctionExpression' || value?.type === 'FunctionExpression') {
		return generatedIdentifier(firstScreenEventHelper(state), expression);
	}
	if (
		(value?.type === 'Literal' && value.value === null) ||
		(value?.type === 'Identifier' && value.name === 'undefined') ||
		(value?.type === 'UnaryExpression' && value.operator === 'void')
	) {
		return dynamicExpressionAst(expression, state);
	}
	if (value?.type === 'ConditionalExpression') {
		return inheritGeneratedOrigin(
			b.conditional(
				dynamicExpressionAst(value.test, state),
				firstScreenEventValueAst(value.consequent, state),
				firstScreenEventValueAst(value.alternate, state),
			),
			expression,
		);
	}
	return inheritGeneratedOrigin(
		b.conditional(
			b.binary('==', dynamicExpressionAst(expression, state), b.literal(null, 'null')),
			b.id('undefined'),
			b.id(firstScreenEventHelper(state)),
		),
		expression,
	);
}

function mainThreadHostValueAst(name, expression, state) {
	if (!isMainThreadRenderOnly(state)) return dynamicExpressionAst(expression, state);
	if (name === 'ref') return inheritGeneratedOrigin(b.id('undefined'), expression);
	return isFirstScreenEvent(name, state)
		? firstScreenEventValueAst(expression, state)
		: dynamicExpressionAst(expression, state);
}

function compilePropsAst(
	attributes,
	childrenExpression,
	state,
	origin,
	canonicalizeHostClass = false,
	host = false,
) {
	const entries = [];
	for (const attribute of attributes) {
		if (attribute.type === 'JSXSpreadAttribute' || attribute.type === 'SpreadAttribute') {
			entries.push(
				inheritGeneratedOrigin(
					b.array([
						b.literal('spread', '"spread"'),
						dynamicExpressionAst(attribute.argument, state),
					]),
					attribute,
				),
			);
			continue;
		}
		const rawName = host ? hostAttributeName(attribute, state) : attributeName(attribute);
		const name = canonicalHostAttributeName(rawName, canonicalizeHostClass);
		if (name === null) {
			throw universalError(state.filename, attribute, 'namespaced JSX attributes are unsupported.');
		}
		const value = attribute.value;
		let expression;
		if (value == null) expression = b.literal(true);
		else if (value.type === 'Literal') expression = b.literal(value.value);
		else if (
			value.type === 'JSXExpressionContainer' &&
			value.expression &&
			value.expression.type !== 'JSXEmptyExpression'
		) {
			expression = mainThreadHostValueAst(name, value.expression, state);
		} else if (value.type === 'JSXExpressionContainer') {
			continue;
		} else {
			throw universalError(
				state.filename,
				attribute,
				`unsupported value for JSX attribute ${name}.`,
			);
		}
		entries.push(
			inheritGeneratedOrigin(
				b.array([b.literal('set', '"set"'), b.literal(name, JSON.stringify(name)), expression]),
				attribute,
			),
		);
	}
	const args = [inheritGeneratedOrigin(b.array(entries), origin)];
	if (childrenExpression === null) {
		if (canonicalizeHostClass) args.push(inheritGeneratedOrigin(b.id('undefined'), origin));
	} else {
		args.push(childrenExpression);
	}
	if (canonicalizeHostClass) args.push(inheritGeneratedOrigin(b.literal(true), origin));
	return generatedCall(state.helpers.props, args, origin);
}

function compilePlainPropsObjectAst(attributes, state, origin) {
	const entries = [];
	for (const attribute of attributes) {
		if (attribute.type === 'JSXSpreadAttribute' || attribute.type === 'SpreadAttribute') {
			entries.push(
				inheritGeneratedOrigin(
					b.spread(dynamicExpressionAst(attribute.argument, state)),
					attribute,
				),
			);
			continue;
		}
		const name = attributeName(attribute);
		if (name === null) continue;
		const value = attribute.value;
		let expression;
		if (value == null) expression = b.literal(true);
		else if (value.type === 'Literal') expression = b.literal(value.value);
		else if (
			value.type === 'JSXExpressionContainer' &&
			value.expression &&
			value.expression.type !== 'JSXEmptyExpression'
		) {
			expression = dynamicExpressionAst(value.expression, state);
		} else {
			continue;
		}
		entries.push(
			inheritGeneratedOrigin(
				b.prop('init', b.literal(name, JSON.stringify(name)), expression),
				attribute,
			),
		);
	}
	return inheritGeneratedOrigin(b.object(entries), origin);
}

/**
 * Lower a `class={[…]}` array literal to its clsx-composed string when every
 * element is statically a string or falsy.
 *
 * The runtime composes class arrays clsx-style, so `['row', on && 'danger']`
 * is only ever observed as `'row'` or `'row danger'` — but as a slot value the
 * array is rebuilt on every render, and on a transported root each rebuild is
 * re-encoded, making the hottest per-row prop a fresh allocation per render.
 * Emitting the string-building expression instead makes the slot value a
 * primitive: identity-comparable, allocation-free, and byte-identical in the
 * background and main-thread programs (so first-screen adoption still sees
 * the same tree). An all-literal array folds further, into a static plan prop
 * with no slot at all. Anything not statically string-or-falsy (spreads,
 * nested arrays, objects, expressions with non-literal truthy arms) keeps the
 * authored array slot and the runtime's general composition.
 *
 * Returns `{ staticValue }` for a fully static class, `{ expression }` for a
 * string-building lowering, or `null` to keep the authored value.
 */
function loweredHostClassAst(expression, state) {
	if (expression.type !== 'ArrayExpression') return null;
	const elements = expression.elements ?? [];
	if (elements.length === 0) return { staticValue: '' };
	/** @type {({ static: string } | { test: any, value: string })[]} */
	const parts = [];
	for (const element of elements) {
		if (element == null || element.type === 'SpreadElement') return null;
		if (element.type === 'Literal' && typeof element.value === 'string') {
			if (element.value !== '') parts.push({ static: element.value });
			continue;
		}
		if (
			element.type === 'LogicalExpression' &&
			element.operator === '&&' &&
			element.right.type === 'Literal' &&
			typeof element.right.value === 'string' &&
			element.right.value !== ''
		) {
			parts.push({ test: element.left, value: element.right.value });
			continue;
		}
		return null;
	}
	// The first part must be a literal so every later piece can join with an
	// unconditional leading space.
	if (parts.length !== 0 && parts[0].static === undefined) return null;
	let composed = null;
	let pendingStatic = '';
	const flushStatic = () => {
		if (pendingStatic === '') return;
		const literal = b.literal(pendingStatic, JSON.stringify(pendingStatic));
		composed = composed === null ? literal : b.binary('+', composed, literal);
		pendingStatic = '';
	};
	for (const part of parts) {
		if (part.static !== undefined) {
			pendingStatic += pendingStatic === '' && composed === null ? part.static : ` ${part.static}`;
			continue;
		}
		flushStatic();
		const spaced = ` ${part.value}`;
		composed = b.binary(
			'+',
			composed,
			inheritGeneratedOrigin(
				b.conditional(
					dynamicExpressionAst(part.test, state),
					b.literal(spaced, JSON.stringify(spaced)),
					b.literal('', '""'),
				),
				part.test,
			),
		);
	}
	if (composed === null) return { staticValue: pendingStatic };
	flushStatic();
	return { expression: inheritGeneratedOrigin(composed, expression) };
}

function compileAttributeAst(attribute, context, state, canonicalizeHostClass) {
	if (attribute.type === 'JSXSpreadAttribute' || attribute.type === 'SpreadAttribute') {
		throw universalError(
			state.filename,
			attribute,
			'host spreads require the ordered universal prop program.',
		);
	}
	const name = canonicalHostAttributeName(
		hostAttributeName(attribute, state),
		canonicalizeHostClass,
	);
	if (name === null) {
		throw universalError(state.filename, attribute, 'namespaced host attributes are unsupported.');
	}
	if (name === 'key') return null;
	const value = attribute.value;
	if (value == null) return { name, staticValue: true };
	if (value.type === 'Literal') return { name, staticValue: value.value };
	if (value.type === 'JSXExpressionContainer') {
		if (!value.expression || value.expression.type === 'JSXEmptyExpression') return null;
		if (name === 'class') {
			const lowered = loweredHostClassAst(value.expression, state);
			if (lowered !== null) {
				if (lowered.expression === undefined) return { name, staticValue: lowered.staticValue };
				const slot = context.values.length;
				context.values.push(lowered.expression);
				return { name, slot };
			}
		}
		if (value.expression.type === 'Literal' && isStaticPropLiteral(value.expression.value)) {
			return { name, staticValue: value.expression.value };
		}
		const slot = context.values.length;
		context.values.push(mainThreadHostValueAst(name, value.expression, state));
		return { name, slot };
	}
	throw universalError(state.filename, attribute, `unsupported value for host attribute ${name}.`);
}

/**
 * Literal values that can ride the frozen plan instead of a per-render slot.
 * `null` stays a slot: it is a legal "no handler" value for event props, whose
 * erasure in main-thread first-screen programs happens at the slot site.
 */
function isStaticPropLiteral(value) {
	return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function addDynamicAst(context, expression) {
	const slot = context.values.length;
	context.values.push(expression);
	return withPlanOrigin({ kind: 'slot', slot }, expression);
}

function registerThreeHostIntrinsic(type, node, state) {
	if (
		state.renderer.id !== 'three' ||
		state.renderer.module !== '@octanejs/three/renderer' ||
		type === 'primitive'
	) {
		return;
	}
	let constructor = `${type[0].toUpperCase()}${type.slice(1)}`;
	if (!THREE_BUILTIN_CONSTRUCTORS.has(constructor) && /^three[A-Z]/.test(type)) {
		constructor = type.slice('three'.length);
	}
	if (!THREE_BUILTIN_CONSTRUCTORS.has(constructor)) return;
	const explicitlyRegistered = state.explicitThreeHostIntrinsics?.get(constructor);
	if (
		explicitlyRegistered !== undefined &&
		typeof node.start === 'number' &&
		explicitlyRegistered < node.start
	) {
		return;
	}
	const intrinsics = (state.threeHostIntrinsics ??= new Map());
	if (intrinsics.has(constructor)) return;
	const prefix = state.planPrefix ?? '__octaneThree';
	intrinsics.set(constructor, {
		local: allocName(state, `${prefix}${constructor}`),
		origin: node,
	});
	state.helpers.threeRegisterIntrinsic ??= allocName(state, `${prefix}RegisterIntrinsic`);
}

function compileHostElementAst(node, context, state) {
	const type = jsxName(node);
	if (type === 'Activity') return compileActivityElementAst(node, context, state);
	if (isComponentElement(node)) return compileComponentElementAst(node, context, state);
	if (type === null) {
		throw universalError(
			state.filename,
			node,
			'member-expression and namespaced host tags are unsupported.',
		);
	}
	if (!/^[a-z]/.test(type)) return compileComponentElementAst(node, context, state);
	registerThreeHostIntrinsic(type, node, state);
	const attributes = node.openingElement?.attributes ?? node.attributes ?? [];
	if (isMainThreadRenderOnly(state)) {
		const spread = attributes.find(
			(attribute) =>
				attribute.type === 'JSXSpreadAttribute' || attribute.type === 'SpreadAttribute',
		);
		if (spread !== undefined) {
			throw universalError(
				state.filename,
				spread,
				'main-thread render-only host spreads are unsupported because first-screen event and ref props must be statically named for callback erasure; expand the spread into explicit host props.',
			);
		}
	}
	const canonicalizeHostClass = rendererHasCapability(state, 'class-name-alias');
	const readAttributeName = (attribute) => hostAttributeName(attribute, state);
	const needsOrderedProps =
		attributes.some(
			(attribute) =>
				attribute.type === 'JSXSpreadAttribute' ||
				attribute.type === 'SpreadAttribute' ||
				readAttributeName(attribute) === 'key' ||
				readAttributeName(attribute) === 'children',
		) ||
		new Set(
			attributes
				.map(readAttributeName)
				.map((name) => canonicalHostAttributeName(name, canonicalizeHostClass))
				.filter(Boolean),
		).size !== attributes.filter((attribute) => readAttributeName(attribute) !== null).length;
	const props = {};
	const bindings = [];
	let propsSlot = null;
	if (needsOrderedProps) {
		propsSlot = context.values.length;
		context.values.push(
			compilePropsAst(attributes, null, state, node, canonicalizeHostClass, true),
		);
	} else {
		for (const attribute of attributes) {
			const compiled = compileAttributeAst(attribute, context, state, canonicalizeHostClass);
			if (compiled === null) continue;
			if ('slot' in compiled) bindings.push([compiled.name, compiled.slot]);
			else props[compiled.name] = compiled.staticValue;
		}
	}
	const children = compileChildrenAst(node.children ?? [], context, state);
	// Fold a lone compile-time-known text child onto the host, so the carrier
	// element is never painted. Deliberately narrow, and each condition earns its
	// place: exactly one child, because a carrier beside a sibling is not the
	// only thing the parent renders; `kind: 'text'`, which is authored JSX text
	// and string literals and never a dynamic hole, whose value is unknown here
	// and whose slot the renderer must still address; and no existing writer of
	// `text` on this host, since `propsSlot` builds an unordered bag at runtime
	// that the compiler cannot prove lacks the key. Refuse rather than race it.
	const absorbsTextChild =
		children.length === 1 &&
		children[0].kind === 'text' &&
		propsSlot === null &&
		!Object.hasOwn(props, TEXT_CONTENT_PROP) &&
		!bindings.some(([name]) => name === TEXT_CONTENT_PROP) &&
		hostAbsorbsTextChild(type, state);
	if (absorbsTextChild) props[TEXT_CONTENT_PROP] = children[0].value;
	const emitted = absorbsTextChild ? [] : children;
	return withPlanOrigin(
		{
			kind: 'host',
			type,
			...(Object.keys(props).length === 0 ? null : { props }),
			...(bindings.length === 0 ? null : { bindings }),
			...(propsSlot === null ? null : { propsSlot }),
			...(emitted.length === 0 ? null : { children: emitted }),
		},
		node,
	);
}

function compileActivityElementAst(node, context, state) {
	if (!rendererHasCapability(state, 'visibility')) {
		throw universalError(
			state.filename,
			node,
			'Activity requires an explicit renderer visibility capability.',
		);
	}
	const attributes = node.openingElement?.attributes ?? node.attributes ?? [];
	let mode = null;
	for (const attribute of attributes) {
		if (attribute.type === 'JSXSpreadAttribute' || attribute.type === 'SpreadAttribute') {
			throw universalError(
				state.filename,
				attribute,
				'Activity props must declare mode explicitly; spreads are unsupported.',
			);
		}
		const name = attributeName(attribute);
		if (name !== 'mode') {
			throw universalError(
				state.filename,
				attribute,
				`Activity does not support the ${JSON.stringify(name)} prop in universal content.`,
			);
		}
		if (mode !== null) {
			throw universalError(state.filename, attribute, 'Activity mode may be declared only once.');
		}
		const value = attribute.value;
		if (value?.type === 'Literal') {
			if (value.value !== 'visible' && value.value !== 'hidden') {
				throw universalError(
					state.filename,
					attribute,
					'Activity mode must be either "visible" or "hidden".',
				);
			}
			mode = inheritGeneratedOrigin(b.literal(value.value), value);
		} else if (
			value?.type === 'JSXExpressionContainer' &&
			value.expression &&
			value.expression.type !== 'JSXEmptyExpression'
		) {
			mode = dynamicExpressionAst(value.expression, state);
		} else {
			throw universalError(
				state.filename,
				attribute,
				'Activity mode must be "visible", "hidden", or an expression producing one.',
			);
		}
	}
	if (mode === null) {
		throw universalError(state.filename, node, 'Activity requires an explicit mode prop.');
	}
	const body = compileBlockValueAst(node.children ?? [], state, [], node);
	return addDynamicAst(context, generatedCall(state.helpers.activity, [mode, body], node));
}

function compileComponentElementAst(node, context, state) {
	const component = jsxNameExpressionAst(node, state);
	const providerContext = contextProviderExpressionAst(node, state);
	const childNodes = node.children ?? [];
	const meaningfulChildren = childNodes.filter(
		(child) => child.type !== 'JSXText' || normalizeJsxText(child.value) !== '',
	);
	let childrenExpression = null;
	if (
		meaningfulChildren.length === 1 &&
		meaningfulChildren[0].type === 'JSXExpressionContainer' &&
		meaningfulChildren[0].expression?.type !== 'JSXEmptyExpression'
	) {
		// A sole expression child has React value semantics: pass the value itself.
		// This is required for function-as-child APIs and scalar consumers. Nested
		// JSX inside the expression is still lowered by dynamicExpressionAst.
		childrenExpression = dynamicExpressionAst(meaningfulChildren[0].expression, state);
	} else if (meaningfulChildren.length > 0) {
		const body = compileBlockValueAst(childNodes, state, [], node);
		childrenExpression = generatedCall(
			state.helpers.children,
			[b.literal(state.renderer.id), body],
			node,
		);
	}
	const attributes = node.openingElement?.attributes ?? node.attributes ?? [];
	if (providerContext !== null) {
		const propsObject = compilePlainPropsObjectAst(attributes, state, node);
		const propsName = generatedIdentifier('__octaneContextProps', node);
		const selectedChildren =
			childrenExpression ?? inheritGeneratedOrigin(b.member(propsName, 'children'), node);
		const callback = generatedArrow(
			[propsName],
			generatedCall(
				state.helpers.context,
				[
					providerContext,
					inheritGeneratedOrigin(
						b.member(generatedIdentifier(propsName.name, node), 'value'),
						node,
					),
					selectedChildren,
				],
				node,
			),
			node,
		);
		return addDynamicAst(context, generatedCall(callback, [propsObject], node));
	}
	const props = compilePropsAst(attributes, childrenExpression, state, node);
	return addDynamicAst(
		context,
		generatedCall(
			state.helpers.nestedComponent,
			[b.literal(state.renderer.id), component, props],
			node,
		),
	);
}

function rewriteSetupStatementsAst(statements, state) {
	const hoisted = [];
	const body = [];
	for (const statement of statements ?? []) {
		const component = nestedFunctionComponentAst(statement, state);
		const nodes = component === null ? rewriteSetupStatementAst(statement, state) : component;
		const prefixed = [
			...(state.astNodePrefixes?.get(statement) ?? []),
			...(Array.isArray(nodes) ? nodes : nodes === null ? [] : [nodes]),
		];
		if (component === null) body.push(...prefixed);
		else hoisted.push(...prefixed);
	}
	return [...hoisted, ...body];
}

function compileBlockValueAst(statements, state, params = [], origin = null) {
	const context = { values: [] };
	const templates = [];
	const setup = [];
	for (const statement of statements ?? []) {
		if (
			statement.type === 'JSXElement' ||
			statement.type === 'Element' ||
			statement.type === 'JSXFragment' ||
			statement.type === 'Fragment' ||
			statement.type === 'JSXText' ||
			statement.type === 'JSXExpressionContainer' ||
			statement.type === 'JSXForExpression' ||
			statement.type === 'JSXIfExpression' ||
			statement.type === 'JSXSwitchExpression' ||
			statement.type === 'JSXTryExpression'
		) {
			templates.push(...compileChildAst(statement, context, state));
		} else {
			setup.push(statement);
		}
	}
	const root =
		templates.length === 1
			? templates[0]
			: withPlanOrigin({ kind: 'range', children: templates }, origin ?? statements?.[0]);
	const plan = allocPlan(state, root, origin ?? statements?.[0]);
	const value = generatedCall(
		state.helpers.value,
		[
			generatedIdentifier(plan, origin ?? statements?.[0]),
			inheritGeneratedOrigin(b.array(context.values), origin ?? statements?.[0]),
		],
		origin ?? statements?.[0],
	);
	const block = inheritGeneratedOrigin(
		b.block([...rewriteSetupStatementsAst(setup, state), b.return(value)]),
		origin ?? statements?.[0],
	);
	return generatedArrow(params, block, origin ?? statements?.[0]);
}

function nestedFunctionComponentAst(statement, state) {
	if (statement?.type !== 'FunctionDeclaration' || state.threadFunctionNodes?.has(statement)) {
		return null;
	}
	const name = functionName(statement);
	if (
		statement.body?.type !== 'JSXCodeBlock' &&
		!hasOwnTemplateReturn(statement) &&
		!state.componentNames.has(name)
	) {
		return null;
	}
	return emitComponentAst({ fn: statement, name, exportKind: null }, state);
}

function rewriteSetupStatementAst(statement, state) {
	const variable = singleFunctionDeclarator(statement, state);
	if (
		variable !== null &&
		(variable.fn.body?.type === 'JSXCodeBlock' ||
			hasOwnTemplateReturn(variable.fn) ||
			state.componentNames.has(variable.name))
	) {
		return emitComponentAst({ ...variable, exportKind: null }, state);
	}
	const rewritten = rewriteSourceAst(statement, state);
	return rewritten === null ? [] : [rewritten];
}

function compileOwnerFreeForHostAst(host, state, itemBinding, indexBinding) {
	const context = { values: [] };
	const plan = allocPlan(state, compileHostElementAst(host, context, state), host);
	return {
		plan: generatedIdentifier(plan, host),
		render: generatedArrow(
			[itemBinding, indexBinding],
			inheritGeneratedOrigin(b.array(context.values), host),
			host,
		),
	};
}

function compileOwnerFreeThreeHostComponentAst(component, state, itemBinding, indexBinding) {
	const attributes = component.openingElement?.attributes ?? component.attributes ?? [];
	const names = [];
	const values = [];
	for (const attribute of attributes) {
		const name = attributeName(attribute);
		const value = attribute.value;
		const expression =
			value === null
				? inheritGeneratedOrigin(b.literal(true), attribute)
				: value.type === 'Literal'
					? inheritGeneratedOrigin(b.literal(value.value), value)
					: mainThreadHostValueAst(name, value.expression, state);
		names.push(name);
		values.push(expression);
	}
	const helper = (state.helpers.hostComponentLeafPlan ??= allocName(
		state,
		'__octaneUniversalHostComponentLeafPlan',
	));
	const signature = JSON.stringify(names);
	return {
		plan: generatedCall(
			helper,
			[b.literal(state.renderer.id), jsxNameExpressionAst(component, state), b.literal(signature)],
			component,
		),
		render: generatedArrow(
			[itemBinding, indexBinding],
			inheritGeneratedOrigin(b.array(values), component),
			component,
		),
		signature: inheritGeneratedOrigin(b.literal(signature), component),
	};
}

function compileTemplateProgramForComponentAst(component, state, itemBinding, indexBinding) {
	const attributes = component.openingElement?.attributes ?? component.attributes ?? [];
	const props = generatedCall(
		state.helpers.props,
		[
			compilePlainPropsObjectAst(attributes, state, component),
			inheritGeneratedOrigin(b.unary('void', b.literal(0)), component),
			b.literal(false),
			b.literal(true),
		],
		component,
	);
	const descriptor = generatedCall(
		state.helpers.nestedComponent,
		[b.literal(state.renderer.id), jsxNameExpressionAst(component, state), props],
		component,
	);
	return generatedArrow([itemBinding, indexBinding], descriptor, component);
}

function compileForAst(node, context, state) {
	if (node.await) {
		throw universalError(
			state.filename,
			node,
			'await @for requires the async-collection capability.',
		);
	}
	if (!node.key) {
		throw universalError(state.filename, node, 'universal @for ranges require an explicit key.');
	}
	const declaration = node.left?.declarations?.[0];
	if (!declaration?.id) {
		throw universalError(state.filename, node, 'universal @for requires one item binding.');
	}
	const itemBinding = declaration.id;
	const indexBinding =
		node.index ?? generatedIdentifier(allocName(state, '__octaneUniversalIndex'), node);
	assertNoResidualTemplate(node.right, state, '@for source');
	assertNoResidualTemplate(node.key, state, '@for key');
	const host = !state.hmr ? ownerFreeForHost(node) : null;
	const component = host === null ? ownerFreeForThreeHostComponent(node, state) : null;
	const templateComponent =
		host === null && component === null && !state.hmr
			? templateProgramForComponent(node, state)
			: null;
	const compactHost =
		host === null ? null : compileOwnerFreeForHostAst(host, state, itemBinding, indexBinding);
	const compactComponent =
		component === null
			? null
			: compileOwnerFreeThreeHostComponentAst(component, state, itemBinding, indexBinding);
	const args = [
		rewriteSourceAst(node.right, state),
		generatedArrow([itemBinding, indexBinding], rewriteSourceAst(node.key, state), node.key),
		compactHost?.render ??
			compactComponent?.render ??
			(templateComponent === null
				? null
				: compileTemplateProgramForComponentAst(
						templateComponent,
						state,
						itemBinding,
						indexBinding,
					)) ??
			compileBlockValueAst(
				node.body?.body ?? [],
				state,
				[itemBinding, indexBinding],
				node.body ?? node,
			),
	];
	if (host !== null) {
		args.push(
			b.literal(null, 'null'),
			b.literal(true),
			b.literal(true),
			inheritGeneratedOrigin(b.unary('void', b.literal(0)), host),
			compactHost.plan,
		);
	} else if (component !== null) {
		args.push(
			b.literal(null, 'null'),
			b.literal(true),
			b.literal(true),
			jsxNameExpressionAst(component, state),
			compactComponent.plan,
			compactComponent.signature,
		);
	} else if (templateComponent !== null) {
		args.push(
			b.literal(null, 'null'),
			b.literal(false),
			b.literal(false),
			inheritGeneratedOrigin(b.unary('void', b.literal(0)), templateComponent),
			inheritGeneratedOrigin(b.unary('void', b.literal(0)), templateComponent),
			inheritGeneratedOrigin(b.unary('void', b.literal(0)), templateComponent),
			b.literal(true),
		);
	} else if (!state.hmr && templateProgramForHost(node, state)) {
		args.push(b.literal(null, 'null'), b.literal(false), b.literal(false), b.literal(true));
	} else if (node.empty) {
		args.push(compileBlockValueAst(node.empty?.body ?? [], state, [], node.empty));
	}
	return addDynamicAst(context, generatedCall(state.helpers.for, args, node));
}

function compileIfAst(node, context, state) {
	assertNoResidualTemplate(node.test, state, '@if condition');
	const consequent = compileBlockValueAst(
		node.consequent?.body ?? [node.consequent],
		state,
		[],
		node.consequent ?? node,
	);
	let alternate = null;
	if (node.alternate) {
		alternate =
			node.alternate.type === 'JSXIfExpression'
				? generatedArrow([], compileIfValueAst(node.alternate, state), node.alternate)
				: compileBlockValueAst(node.alternate?.body ?? [node.alternate], state, [], node.alternate);
	}
	const args = [rewriteSourceAst(node.test, state), consequent];
	if (alternate !== null) args.push(alternate);
	return addDynamicAst(context, generatedCall(state.helpers.if, args, node));
}

function compileIfValueAst(node, state) {
	const context = { values: [] };
	const slot = compileIfAst(node, context, state);
	return context.values[slot.slot];
}

function compileSwitchAst(node, context, state) {
	assertNoResidualTemplate(node.discriminant, state, '@switch discriminant');
	const cases = [];
	let fallback = null;
	for (const item of node.cases ?? []) {
		const thunk = compileBlockValueAst(item.consequent ?? [], state, [], item);
		if (item.test == null) fallback = thunk;
		else {
			assertNoResidualTemplate(item.test, state, '@case expression');
			cases.push(
				inheritGeneratedOrigin(b.array([rewriteSourceAst(item.test, state), thunk]), item),
			);
		}
	}
	const args = [
		rewriteSourceAst(node.discriminant, state),
		inheritGeneratedOrigin(b.array(cases), node),
	];
	if (fallback !== null) args.push(fallback);
	return addDynamicAst(context, generatedCall(state.helpers.switch, args, node));
}

function compileTryAst(node, context, state) {
	const body = compileBlockValueAst(node.block?.body ?? [], state, [], node.block ?? node);
	const pending = node.pending
		? compileBlockValueAst(node.pending.body ?? [], state, [], node.pending)
		: inheritGeneratedOrigin(b.literal(null, 'null'), node);
	const caught = node.handler
		? compileBlockValueAst(
				node.handler.body?.body ?? [],
				state,
				[node.handler.param, node.handler.resetParam].filter(Boolean),
				node.handler,
			)
		: inheritGeneratedOrigin(b.literal(null, 'null'), node);
	return addDynamicAst(context, generatedCall(state.helpers.try, [body, pending, caught], node));
}

function compileChildAst(node, context, state) {
	if (node == null) return [];
	if (node.type === 'JSXText') {
		const value = normalizeJsxText(node.value);
		if (value === '' || state.renderer.text === 'ignore') return [];
		if (state.renderer.text !== 'host') {
			throw universalError(
				state.filename,
				node,
				`renderer ${JSON.stringify(state.renderer.id)} rejects authored text children.`,
			);
		}
		return [withPlanOrigin({ kind: 'text', value }, node)];
	}
	if (node.type === 'JSXExpressionContainer') {
		if (!node.expression || node.expression.type === 'JSXEmptyExpression') return [];
		// A string-literal child is authored text with braces around it: fold it
		// into the plan like JSXText, so the constant stops riding every render's
		// slot array. Renderers without host text keep the renderable-hole slot.
		if (
			node.expression.type === 'Literal' &&
			typeof node.expression.value === 'string' &&
			state.renderer.text === 'host'
		) {
			return [withPlanOrigin({ kind: 'text', value: node.expression.value }, node)];
		}
		return [addDynamicAst(context, dynamicExpressionAst(node.expression, state))];
	}
	if (node.type === 'JSXElement' || node.type === 'Element') {
		return [compileHostElementAst(node, context, state)];
	}
	if (node.type === 'JSXFragment' || node.type === 'Fragment') {
		return [
			withPlanOrigin(
				{ kind: 'range', children: compileChildrenAst(node.children ?? [], context, state) },
				node,
			),
		];
	}
	if (node.type === 'JSXForExpression') return [compileForAst(node, context, state)];
	if (node.type === 'JSXIfExpression') return [compileIfAst(node, context, state)];
	if (node.type === 'JSXSwitchExpression') return [compileSwitchAst(node, context, state)];
	if (node.type === 'JSXTryExpression') return [compileTryAst(node, context, state)];
	if (node.type === 'JSXStyleElement') {
		throw universalError(
			state.filename,
			node,
			'scoped <style> requires a renderer style/assets capability.',
		);
	}
	if (node.type === 'JSXActivityExpression') {
		throw universalError(state.filename, node, 'unsupported Activity expression shape.');
	}
	throw universalError(state.filename, node, `unsupported template node ${node.type}.`);
}

function compileChildrenAst(children, context, state) {
	const output = [];
	for (const child of children) output.push(...compileChildAst(child, context, state));
	return output;
}

function extractEntryParallelUsesAst(expression, state) {
	const useAliases = new Set(
		[...state.runtimeImports].filter(([, imported]) => imported === 'use').map(([local]) => local),
	);
	if (useAliases.size === 0) return [];
	const calls = [];
	const seen = new WeakSet();
	const visit = (node) => {
		if (!node || typeof node !== 'object' || seen.has(node)) return;
		seen.add(node);
		if (Array.isArray(node)) {
			for (const child of node) visit(child);
			return;
		}
		if (
			node !== expression &&
			(node.type === 'FunctionDeclaration' ||
				node.type === 'FunctionExpression' ||
				node.type === 'ArrowFunctionExpression')
		) {
			return;
		}
		if (
			node.type === 'JSXIfExpression' ||
			node.type === 'JSXSwitchExpression' ||
			node.type === 'JSXForExpression' ||
			node.type === 'JSXTryExpression' ||
			node.type === 'ConditionalExpression' ||
			(node.type === 'LogicalExpression' && (node.operator === '&&' || node.operator === '||'))
		) {
			return;
		}
		if (
			node.type === 'CallExpression' &&
			node.callee?.type === 'Identifier' &&
			useAliases.has(node.callee.name)
		) {
			calls.push(node);
			return;
		}
		for (const [key, child] of Object.entries(node)) {
			if (!AST_SKIP_KEYS.has(key)) visit(child);
		}
	};
	visit(expression);
	calls.sort((left, right) => left.start - right.start);
	state.astNodeReplacements ??= new WeakMap();
	return calls.map((call, index) => {
		const name = allocName(state, `${state.planPrefix}EntryUse${index}`);
		const value = dynamicExpressionAst(call, state);
		state.astNodeReplacements.set(call, generatedIdentifier(name, call));
		return generatedConst(name, value, call);
	});
}

function emitComponentAst(shape, state) {
	const { fn, exportKind } = shape;
	const exportedComponentName = shape.name ?? fn.id?.name;
	const force =
		state.componentNames.has(exportedComponentName) ||
		exportKind === 'default' ||
		(exportKind === 'named' && /^[A-Z]/.test(exportedComponentName ?? ''));
	const render = componentRender(fn, state, force);
	if (render === null) return null;
	let name = shape.name ?? fn.id?.name;
	if (!name) name = allocName(state, '__octaneUniversalDefault');
	const loc = fn.loc?.start;
	state.components.push({
		name,
		exportKind,
		line: loc?.line ?? 0,
		column: loc?.column ?? 0,
		hooks: collectAuthoredHookSites(fn, state),
	});
	for (const parameter of fn.params ?? []) {
		assertNoResidualTemplate(parameter, state, 'component parameters');
	}
	const setup = rewriteSetupStatementsAst(render.setup, state);
	const body = [...setup];
	if (render.render !== null) {
		body.push(
			inheritGeneratedOrigin(
				b.return(compileRenderableExpressionAst(render.render, state)),
				render.render,
			),
		);
	} else if (render.expression !== undefined) {
		body.push(
			inheritGeneratedOrigin(
				b.return(rewriteSourceAst(render.expression, state)),
				render.expression,
			),
		);
	}
	const componentFunction = inheritGeneratedOrigin(
		Object.assign(
			b.function(
				generatedIdentifier(name, fn),
				(fn.params ?? []).map((param) => rewriteSourceAst(param, state)),
				b.block(body),
				false,
				fn.typeParameters,
			),
			fn.returnType === undefined ? null : { returnType: fn.returnType },
		),
		fn,
	);
	let wrapped = generatedCall(
		state.helpers.component,
		[
			b.literal(state.renderer.id),
			componentFunction,
			jsonValueToAst({ module: state.renderer.module }, fn),
		],
		fn,
	);
	if (shape.wrapper) {
		wrapped = generatedCall(
			rewriteSourceAst(shape.wrapper.callee, state),
			[wrapped, ...shape.wrapper.arguments.map((argument) => rewriteSourceAst(argument, state))],
			fn,
		);
	}
	if (state.hmr && exportKind !== null) {
		wrapped = generatedCall(state.helpers.hmr, [b.literal(state.renderer.id), wrapped], fn);
		state.hmrComponents.push({ name, exportKind, origin: fn });
	}
	if (state.profile) {
		const metadata = {
			id: `${state.profileFilename || state.filename || '<anon>'}#${name}@${loc?.line ?? 0}:${loc?.column ?? 0}`,
			name,
			file: state.profileFilename || state.filename || '<anon>',
			line: loc?.line ?? 0,
			column: loc?.column ?? 0,
			kind: 'component',
		};
		wrapped = generatedCall(state.helpers.profile, [wrapped, jsonValueToAst(metadata, fn)], fn);
	}
	const declaration = generatedConst(
		name,
		wrapped,
		fn,
		state.hmr && exportKind !== null ? 'let' : 'const',
	);
	if (exportKind === 'named') {
		return [inheritGeneratedOrigin(b.export(declaration), fn)];
	}
	if (exportKind === 'default') {
		return [
			declaration,
			inheritGeneratedOrigin(
				state.hmr
					? b.export(null, [b.export_specifier(name, 'default')])
					: b.export_default(generatedIdentifier(name, fn)),
				fn,
			),
		];
	}
	return [declaration];
}

export const UNIVERSAL_COMPILER_RUNTIME_IMPORTS = new Set([
	...UNIVERSAL_RUNTIME_IMPORTS,
	'__useLinkedStateWithGetter',
	'__useReducerWithGetter',
	'__useStateWithGetter',
	'hookSlots',
	'useBatch',
	'warmChild',
	'warmMemo',
	'withSlot',
]);

export const UNIVERSAL_THREAD_RUNTIME_IMPORTS = new Set([
	'attachThreadFunction',
	'bindThreadFunction',
	'invokeThreadFunction',
	'registerThreadFunction',
	'runOnBackground',
	'runOnMainThread',
	'unregisterThreadFunction',
	'useMainThreadRef',
]);

function threadHelperImportPairs(state) {
	return [
		['registerThreadFunction', state.helpers.registerThreadFunction],
		['unregisterThreadFunction', state.helpers.unregisterThreadFunction],
		['bindThreadFunction', state.helpers.bindThreadFunction],
		['attachThreadFunction', state.helpers.attachThreadFunction],
		['invokeThreadFunction', state.helpers.invokeThreadFunction],
	].filter(([, local]) => local !== undefined);
}

function universalHelperImportAsts(state, extraPairs = [], origin = null) {
	const threadPairs = threadHelperImportPairs(state);
	const threadModule = state.renderer.threadFunctionsModule ?? state.renderer.module;
	const pairs = [
		['defineUniversalComponent', state.helpers.component],
		['universalPlan', state.helpers.plan],
		['universalValue', state.helpers.value],
		['universalComponent', state.helpers.nestedComponent],
		...(state.helpers.hostComponentLeafPlan === undefined
			? []
			: [['universalHostComponentLeafPlan', state.helpers.hostComponentLeafPlan]]),
		...(state.helpers.threeRegisterIntrinsic === undefined
			? []
			: [['registerThreeIntrinsic', state.helpers.threeRegisterIntrinsic]]),
		['universalProps', state.helpers.props],
		['universalIf', state.helpers.if],
		['universalSwitch', state.helpers.switch],
		['universalFor', state.helpers.for],
		['universalTry', state.helpers.try],
		['universalChildren', state.helpers.children],
		['universalContext', state.helpers.context],
		['universalActivity', state.helpers.activity],
		...(state.helpers.firstScreenEvent === undefined
			? []
			: [['firstScreenEvent', state.helpers.firstScreenEvent]]),
		...(state.hmr
			? [
					['hmrUniversalComponent', state.helpers.hmr],
					['UNIVERSAL_HMR', state.helpers.hmrSymbol],
				]
			: []),
		...extraPairs,
		...(threadModule === state.renderer.module ? threadPairs : []),
	];
	const imports = [inheritGeneratedOrigin(b.imports(pairs, state.renderer.module), origin)];
	if (threadPairs.length !== 0 && threadModule !== state.renderer.module) {
		imports.push(inheritGeneratedOrigin(b.imports(threadPairs, threadModule), origin));
	}
	return imports;
}

function threeHostIntrinsicStatementsAst(state, origin = null) {
	if (state.threeHostIntrinsics === undefined) return { imports: [], registrations: [] };
	const entries = [...state.threeHostIntrinsics];
	const imports = [
		inheritGeneratedOrigin(
			b.imports(
				entries.map(([constructor, { local }]) => [constructor, local]),
				'three',
			),
			origin,
		),
	];
	const registrations = entries.map(([constructor, entry]) =>
		inheritGeneratedOrigin(
			b.stmt(
				generatedCall(
					state.helpers.threeRegisterIntrinsic,
					[
						b.literal(constructor, JSON.stringify(constructor)),
						generatedIdentifier(entry.local, entry.origin),
					],
					entry.origin,
				),
			),
			entry.origin,
		),
	);
	return { imports, registrations };
}

function universalProfileImportAst(state, origin = null) {
	return state.profile
		? inheritGeneratedOrigin(
				b.imports([['__profileComponent', state.helpers.profile]], 'octane/profiling'),
				origin,
			)
		: null;
}

// Event props are recognized by name shape on both threads; keep this in sync
// with the main-thread renderer's EVENT_PROP (packages/lynx/src/main-renderer.ts).
const LYNX_EVENT_PROP = /^(?:capture-bind|capture-catch|global-bind|bind|catch)[A-Za-z]+$/;

/**
 * A plan is lowered to a create function only when every node is compile-time
 * host structure: host/text/slot nodes, no props program (`propsSlot`), no
 * component/if/switch/range nodes, and no prop that the record path would
 * filter (`key`/`ref`/`children`) or classify by value (a static prop with an
 * event-shaped name). Anything else keeps the interpreted plan encoding, so
 * mixed modules stay correct while the hot host templates go straight-line.
 */
function lynxTemplateEligible(node) {
	if (node.kind === 'text') return true;
	if (node.kind === 'slot') return true;
	if (node.kind !== 'host') return false;
	if (node.propsSlot !== undefined) return false;
	for (const name of Object.keys(node.props || {})) {
		if (name === 'key' || name === 'ref' || name === 'children') return false;
		if (LYNX_EVENT_PROP.test(name)) return false;
	}
	for (const binding of node.bindings || []) {
		if (binding[0] === 'key' || binding[0] === 'ref' || binding[0] === 'children') return false;
	}
	return (node.children || []).every(lynxTemplateEligible);
}

/**
 * A slot kind selects which operation may write the slot, so a scalar hole and
 * a range site must not share one. `c` is content the writer sets in place; `r`
 * is a range site whose members are instantiated and removed, which is every
 * directive and component hole. Conflating them leaves the dispatch from
 * operation to slot undecidable (see the closure analysis on #61).
 */
function lynxTemplateSlotKinds(node, kinds) {
	if (node.kind === 'text') {
		if (node.slot !== undefined) kinds[node.slot] = 'c';
		return kinds;
	}
	if (node.kind === 'slot') {
		kinds[node.slot] = 'r';
		return kinds;
	}
	for (const binding of node.bindings || []) {
		kinds[binding[1]] = LYNX_EVENT_PROP.test(binding[0]) ? `e:${binding[0]}` : `p:${binding[0]}`;
	}
	for (const child of node.children || []) lynxTemplateSlotKinds(child, kinds);
	return kinds;
}

function lynxValueSlotAst(slot, origin) {
	return inheritGeneratedOrigin(b.member(b.id('values'), b.literal(slot), true), origin);
}

function lynxEnvCallAst(method, args, origin) {
	return inheritGeneratedOrigin(b.stmt(b.call(b.member(b.id('env'), method), ...args)), origin);
}

function lynxTemplateCreateStatementsAst(node, parentName, statements, naming, origin, depth) {
	if (node.kind === 'text') {
		if (node.slot === undefined) {
			const value = node.value ?? '';
			statements.push(
				lynxEnvCallAst('t', [b.id(parentName), b.literal(value, JSON.stringify(value))], origin),
			);
		} else {
			statements.push(
				lynxEnvCallAst('s', [b.id(parentName), lynxValueSlotAst(node.slot, origin)], origin),
			);
		}
		return;
	}
	if (node.kind === 'slot') {
		statements.push(
			lynxEnvCallAst('s', [b.id(parentName), lynxValueSlotAst(node.slot, origin)], origin),
		);
		return;
	}
	// Locals are named by depth, not by a per-node counter. A host's binding is
	// live only from its own creation until the `env.a` that appends it, and
	// that window nests exactly with tree depth, so siblings can share a name.
	// Unique names would make every repeated subtree differ from the last by the
	// bytes of its identifier, which is what LZ77 matches on: the raw output is
	// slightly smaller than the interpreted encoding either way, but with unique
	// names the gzipped output grows without bound in node count.
	const name = `n${depth}`;
	const create = b.call(
		b.member(b.id('env'), 'h'),
		b.literal(node.type, JSON.stringify(node.type)),
	);
	statements.push(
		inheritGeneratedOrigin(
			naming.declared.has(depth)
				? b.stmt(b.assignment('=', b.id(name), create))
				: b.let(name, create),
			origin,
		),
	);
	naming.declared.add(depth);
	for (const [propName, value] of Object.entries(node.props || {})) {
		statements.push(
			lynxEnvCallAst(
				'p',
				[b.id(name), b.literal(propName, JSON.stringify(propName)), jsonValueToAst(value, origin)],
				origin,
			),
		);
	}
	for (const binding of node.bindings || []) {
		const method = LYNX_EVENT_PROP.test(binding[0]) ? 'e' : 'p';
		statements.push(
			lynxEnvCallAst(
				method,
				[
					b.id(name),
					b.literal(binding[0], JSON.stringify(binding[0])),
					lynxValueSlotAst(binding[1], origin),
				],
				origin,
			),
		);
	}
	for (const child of node.children || []) {
		lynxTemplateCreateStatementsAst(child, name, statements, naming, origin, depth + 1);
	}
	if (parentName !== null) {
		statements.push(lynxEnvCallAst('a', [b.id(parentName), b.id(name)], origin));
	}
	if (parentName === null) naming.rootName = name;
}

/** A plan's slot-kind table as an array literal, unwritten slots included as `null`. */
function lynxSlotKindsAst(root) {
	const kinds = lynxTemplateSlotKinds(root, []);
	return b.array(
		Array.from(kinds, (kind) =>
			kind === undefined ? b.literal(null, 'null') : b.literal(kind, JSON.stringify(kind)),
		),
	);
}

function lynxTemplateObjectAst(root, origin) {
	const statements = [];
	const naming = { declared: new Set(), rootName: null };
	lynxTemplateCreateStatementsAst(root, null, statements, naming, origin, 0);
	statements.push(inheritGeneratedOrigin(b.return(b.id(naming.rootName)), origin));
	const createAst = b.arrow([b.id('env'), b.id('values')], b.block(statements));
	return inheritGeneratedOrigin(
		b.object([
			b.prop('init', b.literal('kind', '"kind"'), b.literal('template', '"template"')),
			b.prop('init', b.literal('slots', '"slots"'), lynxSlotKindsAst(root)),
			b.prop('init', b.literal('create', '"create"'), createAst),
		]),
		origin,
	);
}

/**
 * Re-parse a backend's generated source as one expression, with the positions of
 * the string it came from removed.
 *
 * A backend hands this compiler JavaScript source rather than an AST, because a
 * string is the only interface between two packages that does not make one of
 * them depend on the other's parser. The compiler owns the AST, so the compiler
 * is what parses it.
 *
 * Clearing the positions is not cosmetic. `parseModule` records offsets into the
 * synthetic string, while this module's source map is keyed to the authored
 * file, so a surviving `loc` would aim a debugger at whatever happens to sit at
 * that offset of the `.tsrx`. Cleared, the subtree is in the state everything the
 * builders make is in, and `inheritGeneratedOrigin` then attributes the whole
 * emission to the template it was derived from.
 */
function generatedExpressionFromSource(source, filename, origin) {
	// The whole parse must be one expression statement — checking only body[0]
	// would let source shaped like `fn); (sideEffect` embed its first expression
	// and silently drop everything after it, a truncated create function instead
	// of the build error this guard exists to raise.
	const parsed = parseModule(`(${source});`, filename).body;
	const statement = parsed[0];
	if (parsed.length !== 1 || statement?.type !== 'ExpressionStatement') {
		throw new TypeError(
			'Octane main-thread program backend returned source that is not a single expression.',
		);
	}
	const seen = new WeakSet();
	const clearPositions = (value) => {
		if (!value || typeof value !== 'object' || seen.has(value)) return;
		seen.add(value);
		if (Array.isArray(value)) {
			for (const item of value) clearPositions(item);
			return;
		}
		if (typeof value.type === 'string') {
			value.loc = null;
			delete value.start;
			delete value.end;
			delete value.range;
		}
		for (const [key, child] of Object.entries(value)) {
			if (key !== 'loc') clearPositions(child);
		}
	};
	clearPositions(statement.expression);
	return inheritGeneratedOrigin(statement.expression, origin);
}

/**
 * One plan lowered to the compiled create function a main-thread chunk carries,
 * or `null` when this compile is not the one that carries it (issue #163).
 *
 * The first screen this aims at is straight-line compiled code in the main-thread
 * script driving the host directly: no commands, no description, no interpreter
 * walking a plan per node. The code that does the driving cannot be written here.
 * It encodes the renderer's dense applier semantics down to which prop shadows
 * which and when a class coerces from a number, and that applier lives in the
 * renderer's own package. `packages/octane` must not import it, and a second copy
 * of it here would be a copy that can disagree — which would not be a build
 * error but a first screen painted by one implementation and updated by another.
 * So the renderer hands this compiler a backend, and this function is the join.
 *
 * Two gates beyond the caller's eligibility check, and the second is the one that
 * matters. `universalRuntime.thread` must be `main-thread`, even though only the
 * main-thread layer is ever given a backend: #163 keeps the background chunk and
 * the universal bundle byte-identical across the switch, and that claim should
 * not rest on every caller passing the option to exactly one layer. And the
 * derivation must return a program; `null` is the ordinary answer for a plan this
 * renderer cannot describe as one, and those plans stay on the interpreted
 * encoding rather than failing the build.
 *
 * A refusal is the other kind of answer and is deliberately not caught here. The
 * backend refuses a plan it *can* describe but would paint differently from the
 * command path, naming the prop or node it could not emit. That is a build error,
 * because the alternative is shipping a first screen that differs from the one
 * the rest of the pipeline agrees on.
 */
/**
 * Where each keyed range sits in a program's own pre-order.
 *
 * A consumer numbering a first screen walks hosts and ranges in the order the
 * interpreted plan would have produced, and a range's members are numbered
 * between the range and whatever follows it. The program's node list is already
 * that pre-order minus the ranges, so the one thing a consumer cannot recover
 * from it is where the ranges were — the program dropped them, which is what
 * makes them ranges.
 *
 * Answering it here rather than at run time is the same trade the whole emission
 * makes: the walk happens once per program at build time instead of once per
 * mount, and the chunk carries `ranges.length` small integers instead of the
 * parent table a consumer would need to redo the walk. `universalTemplate-
 * ProgramWithoutRanges` guarantees a range hole is the last child of its host,
 * so a range is emitted after that host's whole subtree.
 */
function lynxProgramRangeOrder(wire, ranges) {
	const children = wire.nodes.map(() => []);
	for (let index = 1; index < wire.nodes.length; index++) {
		children[wire.nodes[index].parent].push(index);
	}
	const pending = new Map();
	for (const range of ranges) {
		const list = pending.get(range.node);
		if (list === undefined) pending.set(range.node, [range]);
		else list.push(range);
	}
	const order = new Map();
	let next = 0;
	const visit = (index) => {
		next++;
		for (const child of children[index]) visit(child);
		for (const range of pending.get(index) ?? []) order.set(range, next++);
	};
	if (wire.nodes.length !== 0) visit(0);
	// A range whose node the walk never reached would silently lose its position
	// and be numbered as if it did not exist, which is a first screen the two
	// arms disagree about rather than a build that failed.
	for (const range of ranges) {
		if (!order.has(range)) {
			throw new Error(
				`Octane main-thread program declares a keyed range at slot ${range.slot} on node ` +
					`${range.node}, which is not in the program's node tree.`,
			);
		}
	}
	return order;
}

/**
 * Canonical bytes for a derived wire program, so two compiles hash the same
 * thing (issue #246 §6.1).
 *
 * `JSON.stringify` is not canonical — it preserves insertion order — and the
 * two compiles build these objects through the same code, so their key order
 * agrees today. Sorting is what keeps that from being a property of the current
 * implementation: a refactor that reorders a spread must not silently change a
 * digest, because a changed digest is a failed build and a failing build for a
 * reason no one can name is worse than the drift it was guarding.
 */
function canonicalDigestSource(value) {
	if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(canonicalDigestSource).join(',')}]`;
	const keys = Object.keys(value).sort();
	const parts = [];
	for (const key of keys) {
		if (value[key] === undefined) continue;
		parts.push(`${JSON.stringify(key)}:${canonicalDigestSource(value[key])}`);
	}
	return `{${parts.join(',')}}`;
}

/**
 * FNV-1a over the canonical bytes, as 16 lowercase hex digits.
 *
 * Hand-rolled rather than `node:crypto` because this module has no node imports
 * and gains nothing by acquiring one: the digest is a build-time equality
 * witness between two compiles of the same source, not a security primitive.
 * What it has to be is deterministic across machines and package managers,
 * which a fixed integer recurrence over a canonical string is and a hash of an
 * object's iteration order is not.
 */
function programDigest(wire) {
	const source = canonicalDigestSource(wire);
	let high = 0x811c9dc5;
	let low = 0x9dc5811c;
	for (let index = 0; index < source.length; index++) {
		const code = source.charCodeAt(index);
		high = (high ^ code) >>> 0;
		low = (low ^ ((code << 7) | (code >>> 9))) >>> 0;
		high = Math.imul(high, 0x01000193) >>> 0;
		low = Math.imul(low, 0x85ebca6b) >>> 0;
	}
	return `${high.toString(16).padStart(8, '0')}${low.toString(16).padStart(8, '0')}`;
}

/**
 * The cross-realm name of one plan, or `null` when this build does not address
 * programs or this plan is not one.
 *
 * Called from *both* compiles of a module, and that is the whole point. The
 * address is positional, so it is only safe if the two compiles agree about
 * which plans are programs and in what order — and the way to make them agree is
 * to ask the same question, of the same plan root, through the same derivation,
 * rather than to have each infer it from its own emission.
 *
 * The background is `target: 'universal'` and emits an ordinary host plan, so it
 * never builds a program and cannot decide eligibility from what it emitted. It
 * runs the derivation purely as an oracle: `deriveLynxMainThreadProgram` is a
 * pure build-time lowering with no side effects, and its `null` is exactly the
 * main thread's "no program here". So the two threads agree by construction
 * instead of by a rule each implements separately.
 *
 * The digest covers exactly the derived wire, per the §6.1 ruling. Derivation by
 * execution is what makes that complete rather than hopeful: the emission reads
 * nothing outside the surface the derivation produced, so hashing that surface
 * hashes everything the emission depends on.
 */
function universalProgramAddressAst(state, plan, index, origin) {
	const backend = state.mainThreadProgramBackend;
	if (backend === undefined || state.programModuleId === undefined) return null;
	if (!lynxTemplateEligible(plan.root) || plan.root.kind !== 'host') return null;
	const derived = backend.deriveLynxMainThreadProgram(plan.root);
	if (derived === null || derived === undefined) return null;
	return jsonValueToAst(
		{ module: state.programModuleId, index, digest: programDigest(derived.wire) },
		origin,
	);
}

function lynxMainThreadProgramObjectAst(state, plan, origin) {
	const backend = state.mainThreadProgramBackend;
	if (backend === undefined) return null;
	if (state.universalRuntime?.thread !== 'main-thread') return null;
	const derived = backend.deriveLynxMainThreadProgram(plan.root);
	if (derived === null || derived === undefined) return null;
	// Not `plan.name`: the module already binds that, and the emission's name
	// becomes a named function expression whose binding would shadow it.
	const name = allocName(state, `${plan.name}Create`);
	// The derivation's own range sites, handed straight back: a hole holding a
	// string is a `#text` either way, and the create function is where the value
	// is known, so the emission compiles the test rather than sending the node
	// over the command path (issue #163 C5). It reports which sites it took,
	// because only it knows — a hole under a `view` is the ordinary keyed list at
	// every value and keeps its parameter without compiling anything.
	const emission = backend.emitLynxMainThreadProgram(derived.wire, {
		name,
		ranges: derived.ranges,
	});
	// The create function takes its values, listeners and range sites
	// positionally, so the maps below are the only thing that says which plan
	// slot each position reads. A count that disagrees with them is a miscompile
	// that would surface as a first screen painted from shifted arguments, so it
	// fails the build here instead.
	if (
		emission.valueCount !== derived.values.length ||
		emission.eventCount !== derived.events.length ||
		emission.rangeCount !== derived.ranges.length ||
		emission.paintsText.length !== derived.ranges.length
	) {
		throw new Error(
			`Octane main-thread program ${name} takes ${emission.valueCount} value, ` +
				`${emission.eventCount} listener and ${emission.rangeCount} range parameters, ` +
				`but its derivation declares ${derived.values.length} values, ` +
				`${derived.events.length} events and ${derived.ranges.length} ranges.`,
		);
	}
	const rangeOrder = lynxProgramRangeOrder(derived.wire, derived.ranges);
	return inheritGeneratedOrigin(
		b.object([
			b.prop('init', b.literal('kind', '"kind"'), b.literal('program', '"program"')),
			// The keyed slot map is the contract #163 keeps, so the compiled object
			// carries the same one the interpreted object does. It is per program and
			// fixed size — the update path's dispatch table, not a per-node
			// description anything walks to paint.
			b.prop('init', b.literal('slots', '"slots"'), lynxSlotKindsAst(plan.root)),
			// How many hosts the create function makes. A consumer that claims the
			// program's first-screen IDs needs the count, and the count alone: the
			// nodes come back from `bind` in this order, so nothing walks anything to
			// pair them up.
			b.prop('init', b.literal('nodes', '"nodes"'), b.literal(derived.wire.nodes.length)),
			// Still reduced to plan-slot indices. A value site also carries the node
			// and prop name it was derived from, and neither has a reader until #163's
			// C4 applies updates through them — the chunk whose size is the point does
			// not carry data nothing reads.
			b.prop(
				'init',
				b.literal('values', '"values"'),
				jsonValueToAst(
					derived.values.map((value) => value.slot),
					origin,
				),
			),
			// An event site carries all four. `slot` says which plan slot holds the
			// handler and orders the positional `e0..eM`; `node`, `type` and
			// `priority` are what a first screen announces to the background so it can
			// route a tap — the driver's event type rather than the authored prop
			// name, at the priority the driver classified it.
			b.prop(
				'init',
				b.literal('events', '"events"'),
				jsonValueToAst(
					derived.events.map((event) => ({
						slot: event.slot,
						node: event.node,
						type: event.type,
						priority: event.priority,
					})),
					origin,
				),
			),
			// All four are load-bearing: `slot` is the plan slot the keyed range
			// occupies, `node` the emitted node its members are appended into, `id`
			// where the range sits in the program's own pre-order — the one thing the
			// node list cannot say, because the program dropped it — and `paintsText`
			// whether the create function above compiles this hole when its value
			// turns out to be a string. The last one is copied from the emission
			// rather than re-derived here: it is a fact about that source, and a
			// consumer reading it wrong would either lose the text or paint it twice.
			b.prop(
				'init',
				b.literal('ranges', '"ranges"'),
				jsonValueToAst(
					derived.ranges.map((range, index) => ({
						slot: range.slot,
						node: range.node,
						id: rangeOrder.get(range),
						paintsText: emission.paintsText[index] === true,
					})),
					origin,
				),
			),
			// `bind`, not `create`: the emission takes the host once per program and
			// returns the per-instance create. A distinct `kind` above means a consumer
			// that only knows the interpreted ABI fails loudly rather than calling this
			// one with `(env, values)`.
			b.prop(
				'init',
				b.literal('bind', '"bind"'),
				generatedExpressionFromSource(emission.source, state.filename, origin),
			),
		]),
		origin,
	);
}

function universalPlanDeclarationsAst(state, origin = null) {
	return state.plans.map((plan, index) => {
		const planOrigin = plan.origin ?? origin;
		const rootAst =
			state.lynxTemplates && lynxTemplateEligible(plan.root) && plan.root.kind === 'host'
				? (lynxMainThreadProgramObjectAst(state, plan, planOrigin) ??
					lynxTemplateObjectAst(plan.root, planOrigin))
				: jsonValueToAst(plan.root, planOrigin);
		// The third argument, and nothing else, is what an addressing build adds to
		// the background chunk. #163's byte-identity gate for that chunk is
		// retired by exactly this and replaced by the narrower one #246 §5 named:
		// the background compile changes by the addressing and by nothing else.
		const addressAst = universalProgramAddressAst(state, plan, index, planOrigin);
		return generatedConst(
			plan.name,
			generatedCall(
				state.helpers.plan,
				addressAst === null
					? [b.literal(state.renderer.id), rootAst]
					: [b.literal(state.renderer.id), rootAst, addressAst],
				planOrigin,
			),
			planOrigin,
		);
	});
}

function importMetaExpression(origin) {
	return inheritGeneratedOrigin(
		{
			type: 'MetaProperty',
			meta: b.id('import'),
			property: b.id('meta'),
			metadata: { path: [] },
		},
		origin,
	);
}

function importMetaMember(name, origin) {
	return inheritGeneratedOrigin(b.member(importMetaExpression(origin), name), origin);
}

function memberPath(root, names, origin) {
	let expression = root;
	for (const name of names) expression = b.member(expression, name);
	return inheritGeneratedOrigin(expression, origin);
}

function hmrComponentStore(root, origin) {
	return memberPath(root, ['data', '__octaneUniversalComponents'], origin);
}

function hmrDisposalStatements(state, origin) {
	return (state.threadFunctionDisposals ?? []).map((site) =>
		inheritGeneratedOrigin(
			b.stmt(
				generatedCall(
					state.helpers.unregisterThreadFunction,
					[b.literal(site.kind), b.literal(site.id)],
					origin,
				),
			),
			origin,
		),
	);
}

function hmrHandoffStatements(state, hot, origin) {
	const output = [];
	for (const component of state.hmrComponents) {
		const componentOrigin = component.origin ?? origin;
		const exportName = component.exportKind === 'default' ? 'default' : component.name;
		const existing = b.member(hmrComponentStore(hot, componentOrigin), exportName);
		// Webpack/rspack leave `hot.data` undefined until a previous instance of
		// the module has disposed, so first evaluation must guard the bag itself.
		const test = b.logical(
			'&&',
			b.logical(
				'&&',
				memberPath(hot, ['data'], componentOrigin),
				hmrComponentStore(hot, componentOrigin),
			),
			// Newly added exports can share names with Object.prototype properties.
			b.logical(
				'&&',
				b.call(
					b.member(b.member(b.object([]), 'hasOwnProperty'), 'call'),
					hmrComponentStore(hot, componentOrigin),
					b.literal(exportName),
				),
				existing,
			),
		);
		const update = b.stmt(
			b.call(
				b.member(b.member(existing, b.id(state.helpers.hmrSymbol), true), 'update'),
				b.id(component.name),
			),
		);
		const assign = b.stmt(b.assignment('=', b.id(component.name), existing));
		output.push(inheritGeneratedOrigin(b.if(test, b.block([update, assign])), componentOrigin));
	}
	return output;
}

function hmrComponentObject(state, existing, origin) {
	return inheritGeneratedOrigin(
		b.object([
			b.spread(existing),
			...state.hmrComponents.map((component) => {
				const exportName = component.exportKind === 'default' ? 'default' : component.name;
				// Export lowering can expand __proto__ shorthand into a prototype setter.
				// A computed key keeps the retained wrapper an own data property.
				const computed = exportName === '__proto__';
				return b.prop(
					'init',
					computed ? b.literal(exportName) : b.id(exportName),
					b.id(component.name),
					computed,
					!computed && component.exportKind !== 'default',
				);
			}),
		]),
		origin,
	);
}

function buildUniversalHmrBlocksAst(state, origin) {
	const disposals = hmrDisposalStatements(state, origin);
	if (state.hmrComponents.length === 0 && disposals.length === 0) {
		return { prelude: [], tail: [] };
	}
	// Rspack only lowers the webpackHot root reliably. Vite's self-accept call
	// must stay a direct import.meta.hot.accept(...) for its static analysis.
	const webpack = state.hmrDialect === 'webpack';
	const hotName = webpack ? allocName(state, '__octaneWebpackHot') : null;
	const hot =
		hotName === null ? importMetaMember('hot', origin) : generatedIdentifier(hotName, origin);
	const prelude =
		hotName === null
			? []
			: [generatedConst(hotName, importMetaMember('webpackHot', origin), origin)];
	const tail = [];
	const data = generatedIdentifier('data', origin);
	const store = inheritGeneratedOrigin(b.member(data, '__octaneUniversalComponents'), origin);
	const save = b.stmt(b.assignment('=', store, hmrComponentObject(state, store, origin)));
	const ready =
		webpack && state.hmrComponents.length > 0 && disposals.length > 0
			? allocName(state, '__octaneUniversalHmrComponentsReady')
			: null;
	if (ready !== null) prelude.push(generatedConst(ready, b.literal(false), origin, 'let'));
	if (disposals.length > 0) {
		// Register thread cleanup before any registration can throw. A failed
		// webpack evaluation must not read component bindings still in their TDZ.
		const disposalBody = [
			...(ready === null ? [] : [b.if(b.id(ready), b.block([save]))]),
			...disposals,
		];
		prelude.push(
			inheritGeneratedOrigin(
				b.if(
					hot,
					b.block([
						b.stmt(b.call(b.member(hot, 'dispose'), b.arrow([data], b.block(disposalBody)))),
					]),
				),
				origin,
			),
		);
	}
	if (state.hmrComponents.length > 0) {
		// Each evaluation must keep exporting the wrapper that owns mounted roots.
		// Updating a fresh wrapper from its own accept callback loses those owners
		// on the second edit. Hand off once while evaluating the replacement.
		const handoff = hmrHandoffStatements(state, hot, origin);
		if (webpack) {
			handoff.push(
				ready === null
					? b.stmt(b.call(b.member(hot, 'dispose'), b.arrow([data], b.block([save]))))
					: b.stmt(b.assignment('=', b.id(ready), b.literal(true))),
			);
		} else {
			// Vite keeps hot.data across evaluations but has only one dispose handler
			// per module. Persist now so DOM and sibling regions cannot replace thread
			// cleanup or each other's retained component tables.
			const currentStore = hmrComponentStore(hot, origin);
			// Without persistent data, the accept callback falls back to invalidation.
			handoff.push(
				b.if(
					b.member(hot, 'data'),
					b.stmt(b.assignment('=', currentStore, hmrComponentObject(state, currentStore, origin))),
				),
			);
		}
		const acceptArgs = [];
		if (!webpack) {
			const moduleName = allocName(state, '__octaneUniversalHmrModule');
			const changedExports = state.hmrComponents
				.map((component) =>
					b.binary(
						'!==',
						b.member(
							b.id(moduleName),
							component.exportKind === 'default' ? 'default' : component.name,
						),
						b.id(component.name),
					),
				)
				.reduce((left, right) => b.logical('||', left, right));
			// The handoff already refreshed compatible exports. Missing or changed
			// boundaries must invalidate rather than leave the previous owner live.
			acceptArgs.push(
				b.arrow(
					[b.id(moduleName)],
					b.block([
						b.if(
							b.logical('&&', b.id(moduleName), changedExports),
							b.stmt(b.call(b.member(hot, 'invalidate'))),
						),
					]),
				),
			);
		}
		handoff.push(b.stmt(b.call(b.member(hot, 'accept'), ...acceptArgs)));
		tail.push(inheritGeneratedOrigin(b.if(hot, b.block(handoff)), origin));
	}
	return { prelude, tail };
}

/**
 * Lower an already parsed renderer-owned region without printing or reparsing
 * generated source. Authored region/component nodes retain their locations;
 * generated scaffolding inherits the nearest authored origin.
 */
export function lowerUniversalRendererRegionAst(
	regionExpression,
	filename,
	ownerRenderer,
	renderer,
	index,
	options = {},
) {
	if (
		!renderer ||
		typeof renderer.id !== 'string' ||
		typeof renderer.module !== 'string' ||
		renderer.target !== 'universal'
	) {
		throw new TypeError('A renderer-owned universal region requires a universal renderer.');
	}
	const universalRuntime = normalizeUniversalRuntime(options.universalRuntime);
	const prefix = `__octaneRendererRegion${index}`;
	const origin = regionExpression;
	const runtimeImports = options.runtimeImports ?? [];
	const runtimeImportAst =
		runtimeImports.length === 0
			? null
			: inheritGeneratedOrigin(
					b.imports(
						runtimeImports.map(({ imported, local }) => [imported, local]),
						'octane',
					),
					origin,
				);
	const analysisEntryName = `${prefix}Source`;
	const analysisEntry = generatedConst(analysisEntryName, regionExpression, origin);
	const componentStatements = options.components ?? [];
	const analysisAst = {
		type: 'Program',
		sourceType: 'module',
		body: [
			...(runtimeImportAst === null ? [] : [runtimeImportAst]),
			...componentStatements,
			analysisEntry,
		],
		start: origin?.start,
		end: origin?.end,
		loc: origin?.loc,
		metadata: { path: [] },
	};
	const hmrDialect = options.hmr === true ? 'vite' : options.hmr || false;
	const state = {
		source: options.authoredSource ?? '',
		filename,
		renderer,
		universalRuntime,
		names: new Set(),
		plans: [],
		components: [],
		hmr: hmrDialect !== false,
		hmrDialect,
		hmrComponents: [],
		profile: options.profile === true,
		profileFilename: options.profileFilename,
		helpers: {},
		componentNames: collectComponentNames(analysisAst),
		runtimeImports: new Map(),
		planPrefix: prefix,
		validationImportReferences: [],
		mainThreadProgramBackend: options.mainThreadProgramBackend,
		programModuleId: options.programModuleId,
	};
	state.explicitThreeHostIntrinsics = collectExplicitThreeHostIntrinsics(
		options.authoredAst ?? analysisAst,
		renderer,
	);
	state.helpers.component = allocName(state, `${prefix}Define`);
	state.helpers.plan = allocName(state, `${prefix}Plan`);
	state.helpers.value = allocName(state, `${prefix}Value`);
	state.helpers.nestedComponent = allocName(state, `${prefix}Component`);
	state.helpers.props = allocName(state, `${prefix}Props`);
	state.helpers.if = allocName(state, `${prefix}If`);
	state.helpers.switch = allocName(state, `${prefix}Switch`);
	state.helpers.for = allocName(state, `${prefix}For`);
	state.helpers.try = allocName(state, `${prefix}Try`);
	state.helpers.children = allocName(state, `${prefix}Children`);
	state.helpers.context = allocName(state, `${prefix}Context`);
	state.helpers.activity = allocName(state, `${prefix}Activity`);
	const generatedRuntimeAliases = Object.freeze(
		Object.fromEntries(
			[
				'__useStateWithGetter',
				'__useLinkedStateWithGetter',
				'__useReducerWithGetter',
				'useMemo',
				'useBatch',
				'warmMemo',
				'warmChild',
				'withSlot',
				'hookSlots',
			].map((imported) => [
				imported,
				allocName(
					state,
					`${prefix}${imported
						.replace(/^__/, '')
						.replace(/(^|_)([a-z])/g, (_match, _separator, letter) => letter.toUpperCase())}`,
				),
			]),
		),
	);
	if (state.hmr) {
		state.helpers.hmr = allocName(state, `${prefix}Hmr`);
		state.helpers.hmrSymbol = allocName(state, `${prefix}HmrSymbol`);
	}
	if (state.profile) state.helpers.profile = allocName(state, `${prefix}Profile`);

	const specializationBindings = new Set();
	const entryExcluded = new Set(runtimeImports.map(({ local }) => local));
	for (const region of options.deferredRendererRegions ?? []) entryExcluded.add(region.token);
	for (const statement of componentStatements) {
		const declaration =
			statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration'
				? statement.declaration
				: statement;
		if (declaration?.id?.name) {
			entryExcluded.add(declaration.id.name);
			specializationBindings.add(declaration.id.name);
		}
		if (declaration?.type === 'VariableDeclaration') {
			for (const item of declaration.declarations ?? []) {
				addPatternNames(item.id, entryExcluded);
				addPatternNames(item.id, specializationBindings);
			}
		}
	}
	const entryCaptureCandidates = collectEntryCaptures(regionExpression, entryExcluded)
		.filter((capture) => !UNIVERSAL_REALM_GLOBALS.has(capture.source))
		.map((capture) => ({ ...capture, local: capture.source }));
	state.threadExternalCaptures = new Set(entryCaptureCandidates.map((capture) => capture.source));
	validateRuntimeImports(analysisAst, state);
	prepareThreadFunctionAstReplacements(analysisAst, state);
	const entryCaptures = entryCaptureCandidates.filter((capture) =>
		capture.nodes.some((node) => isThreadNodeActive(state, node)),
	);
	if (renderer.validation !== undefined && options.authoredAst && options.validationRanges) {
		validateRendererSourceRanges(
			options.authoredAst,
			state,
			options.validationRanges,
			options.validationExclusions,
		);
	} else if (renderer.validation !== undefined) {
		validateRendererSource(analysisAst, state);
	}
	prepareMainThreadRenderOnlyAstReplacements(analysisAst, state);

	const emittedComponents = [];
	for (const statement of componentStatements) {
		emittedComponents.push(...(state.astNodePrefixes?.get(statement) ?? []));
		const shape = componentShape(statement, state);
		const component = shape === null ? null : emitComponentAst(shape, state);
		if (component === null) {
			assertNoResidualTemplate(statement, state, 'a renderer specialization helper');
			const rewritten = rewriteSourceAst(statement, state);
			if (rewritten !== null) emittedComponents.push(rewritten);
		} else {
			emittedComponents.push(...component);
		}
	}
	state.astNodeReplacements ??= new WeakMap();
	for (const capture of entryCaptures) {
		for (const node of capture.nodes) {
			state.astNodeReplacements.set(node, generatedIdentifier(capture.local, node));
		}
	}
	const deferredRendererNodes = collectIdentifierNodes(
		regionExpression,
		new Set((options.deferredRendererRegions ?? []).map((region) => region.token)),
	);
	for (const [regionIndex, region] of (options.deferredRendererRegions ?? []).entries()) {
		const local = allocName(state, `${prefix}RendererRegionRender${regionIndex}`);
		const descriptor = generatedCall(
			region.helper,
			[
				b.literal(region.ownerRenderer.id),
				b.literal(region.childRenderer.id),
				b.id(region.body),
				b.object([b.prop('init', b.id('render'), b.id(local))]),
			],
			origin,
		);
		for (const node of deferredRendererNodes.get(region.token) ?? []) {
			state.astNodeReplacements.set(node, descriptor);
		}
		entryCaptures.push({ local, nodes: [], source: region.renderToken });
	}
	const entryUseSetup = extractEntryParallelUsesAst(regionExpression, state);
	const loweredExpression = isTemplateNode(regionExpression)
		? compileRenderableExpressionAst(regionExpression, state)
		: rewriteSourceAst(regionExpression, state);
	const regionHelper = allocName(state, `${prefix}Descriptor`);
	const componentName = allocName(state, `${prefix}Body`);
	const entryProps = generatedIdentifier(allocName(state, `${prefix}EntryProps`), origin);
	const componentBody = [];
	if (entryCaptures.length > 0) {
		componentBody.push(
			inheritGeneratedOrigin(
				b.const(
					b.array_pattern(
						entryCaptures.map((capture) => generatedIdentifier(capture.local, origin)),
					),
					b.member(entryProps, 'captures'),
				),
				origin,
			),
		);
	}
	componentBody.push(...entryUseSetup, inheritGeneratedOrigin(b.return(loweredExpression), origin));
	const componentFunction = inheritGeneratedOrigin(
		b.function(generatedIdentifier(componentName, origin), [entryProps], b.block(componentBody)),
		origin,
	);
	let componentValue = generatedCall(
		state.helpers.component,
		[
			b.literal(renderer.id),
			componentFunction,
			jsonValueToAst({ module: renderer.module }, origin),
		],
		origin,
	);
	state.components.push({
		name: componentName,
		exportKind: 'named',
		line: origin?.loc?.start?.line ?? 0,
		column: origin?.loc?.start?.column ?? 0,
		hooks: collectAuthoredHookSites({ body: regionExpression }, state),
	});
	if (state.hmr) {
		componentValue = generatedCall(
			state.helpers.hmr,
			[b.literal(renderer.id), componentValue],
			origin,
		);
		state.hmrComponents.push({ name: componentName, exportKind: 'named', origin });
	}
	if (state.profile) {
		const loc = origin?.loc?.start;
		componentValue = generatedCall(
			state.helpers.profile,
			[
				componentValue,
				jsonValueToAst(
					{
						id: `${state.profileFilename || filename || '<anon>'}#${componentName}@${
							loc?.line ?? 0
						}:${loc?.column ?? 0}`,
						name: componentName,
						file: state.profileFilename || filename || '<anon>',
						line: loc?.line ?? 0,
						column: loc?.column ?? 0,
						kind: 'component',
					},
					origin,
				),
			],
			origin,
		);
	}
	const componentDeclaration = inheritGeneratedOrigin(
		b.export(generatedConst(componentName, componentValue, origin, state.hmr ? 'let' : 'const')),
		origin,
	);
	specializationBindings.add(componentName);
	const hmrBlocks = buildUniversalHmrBlocksAst(state, origin);
	const profileImport = universalProfileImportAst(state, origin);
	const threeHostIntrinsics = threeHostIntrinsicStatementsAst(state, origin);
	const helperImportPairs = [
		['rendererRegion', regionHelper],
		...runtimeImports.map(({ imported, local }) => [imported, local]),
		...Object.entries(generatedRuntimeAliases),
	];
	const descriptor = generatedCall(
		regionHelper,
		[
			b.literal(ownerRenderer.id ?? ownerRenderer),
			b.literal(renderer.id),
			b.id(componentName),
			b.object([
				b.prop(
					'init',
					b.id('captures'),
					b.array(entryCaptures.map((capture) => generatedIdentifier(capture.source, origin))),
				),
			]),
		],
		origin,
	);
	return Object.freeze({
		metadata: Object.freeze({
			componentHelper: state.helpers.component,
			componentValueHelper: state.helpers.nestedComponent,
			propsHelper: state.helpers.props,
			regionHelpers: Object.freeze({
				children: state.helpers.children,
				if: state.helpers.if,
				switch: state.helpers.switch,
				for: state.helpers.for,
				try: state.helpers.try,
				context: state.helpers.context,
				activity: state.helpers.activity,
			}),
			components: Object.freeze(state.components),
			bindings: Object.freeze([...specializationBindings]),
			generatedRuntimeAliases,
			renderer,
			runtimeAliases: Object.freeze(runtimeImports.map(({ local }) => local)),
			runtimeImports: Object.freeze(runtimeImports),
			...(universalRuntime === undefined ? null : { universalRuntime }),
		}),
		statements: Object.freeze([
			...universalHelperImportAsts(state, helperImportPairs, origin),
			...threeHostIntrinsics.imports,
			...(profileImport === null ? [] : [profileImport]),
			...hmrBlocks.prelude,
			...threeHostIntrinsics.registrations,
			...universalPlanDeclarationsAst(state, origin),
			...(state.threadFunctionRegistrationsAst ?? []),
			...emittedComponents,
			componentDeclaration,
			...hmrBlocks.tail,
		]),
		expression: descriptor,
		validationImportReferences: Object.freeze(state.validationImportReferences),
	});
}

/**
 * @param {string} source
 * @param {string} filename
 * @param {{ id: string, module: string, target: 'universal', text?: 'host'|'ignore'|'reject', capabilities?: readonly string[], firstScreenEvents?: readonly string[] }} renderer
 * @param {(ast: import('@tsrx/core/types').AST.Program, metadata: any) => { code: string, map: any }} compileClient
 * @param {Record<string, any>} [options]
 * @param {import('@tsrx/core/types').AST.Program | null} [parsedAst]
 */
export function compileUniversal(
	source,
	filename,
	renderer,
	compileClient,
	options = {},
	parsedAst = null,
) {
	if (
		!renderer ||
		typeof renderer.id !== 'string' ||
		typeof renderer.module !== 'string' ||
		(renderer.target !== 'universal' && renderer.target !== 'lynx')
	) {
		throw new TypeError('Octane universal compiler requires a resolved universal renderer.');
	}
	const universalRuntime = normalizeUniversalRuntime(options.universalRuntime);
	const ast = parsedAst ?? parseModule(source, filename);
	const hmrDialect = options.hmr === true ? 'vite' : options.hmr || false;
	const state = {
		source,
		filename,
		renderer,
		universalRuntime,
		names: new Set(),
		plans: [],
		components: [],
		hmr: hmrDialect !== false,
		hmrDialect,
		hmrComponents: [],
		profile: options.profile === true,
		profileFilename: options.profileFilename,
		helpers: {},
		componentNames: collectComponentNames(ast),
		runtimeImports: new Map(),
		// The `lynx` target keeps the universal front-end and descriptor ABI but
		// lowers eligible host-only plans into straight-line create functions
		// (docs/lynx-specialized-target-l0.md §3.2); ineligible plans fall back
		// to the interpreted plan encoding unchanged.
		lynxTemplates: renderer.target === 'lynx',
		// The renderer's own main-thread backend, supplied by whoever configured
		// the build rather than imported here — see lynxMainThreadProgramObjectAst.
		// Absent, every plan lowers exactly as it did before it existed, which is
		// what makes #163's byte-identity claim checkable rather than asserted.
		mainThreadProgramBackend: options.mainThreadProgramBackend,
		// The module's cross-realm name, supplied by whoever configured the build.
		// Absent, no plan gets an address and every mount keeps its descriptor —
		// which is what an isolated single-layer graph gets, because a
		// configuration that cannot cross-check its two compiles at build time
		// does not get a fast path whose safety is the cross-check (#246 §6.3).
		programModuleId: options.programModuleId,
	};
	state.explicitThreeHostIntrinsics = collectExplicitThreeHostIntrinsics(ast, renderer);
	state.ownerFreeThreeHostComponents = collectOwnerFreeThreeHostComponents(
		ast,
		state,
		options.dev === true,
	);
	state.helpers.component = allocName(state, '__octaneDefineUniversalComponent');
	state.helpers.plan = allocName(state, '__octaneUniversalPlan');
	state.helpers.value = allocName(state, '__octaneUniversalValue');
	state.helpers.nestedComponent = allocName(state, '__octaneUniversalComponent');
	state.helpers.props = allocName(state, '__octaneUniversalProps');
	state.helpers.if = allocName(state, '__octaneUniversalIf');
	state.helpers.switch = allocName(state, '__octaneUniversalSwitch');
	state.helpers.for = allocName(state, '__octaneUniversalFor');
	state.helpers.try = allocName(state, '__octaneUniversalTry');
	state.helpers.children = allocName(state, '__octaneUniversalChildren');
	state.helpers.context = allocName(state, '__octaneUniversalContext');
	state.helpers.activity = allocName(state, '__octaneUniversalActivity');
	if (state.hmr) {
		state.helpers.hmr = allocName(state, '__octaneUniversalHmr');
		state.helpers.hmrSymbol = allocName(state, '__octaneUniversalHmrSymbol');
	}
	if (state.profile) state.helpers.profile = allocName(state, '__octaneProfileComponent');
	validateRuntimeImports(ast, state);
	prepareThreadFunctionAstReplacements(ast, state);
	if (renderer.validation !== undefined) {
		if (options.__universalValidationAst && options.__universalValidationRanges) {
			validateRendererSourceRanges(
				options.__universalValidationAst,
				state,
				options.__universalValidationRanges,
				options.__universalValidationExclusions,
			);
		} else if (options.__universalValidationAst) {
			validateRendererSource(options.__universalValidationAst, state);
		} else {
			validateRendererSource(ast, state);
		}
	}
	prepareMainThreadRenderOnlyAstReplacements(ast, state);

	const emitted = [];
	for (const node of ast.body ?? []) {
		emitted.push(...(state.astNodePrefixes?.get(node) ?? []));
		const shape = componentShape(node, state);
		if (shape !== null) {
			const component = emitComponentAst(shape, state);
			if (component !== null) {
				emitted.push(...component);
				continue;
			}
		}
		assertNoResidualTemplate(node, state, 'an unsupported module declaration');
		const rewritten = rewriteSourceAst(node, state);
		if (rewritten !== null) emitted.push(rewritten);
	}

	const moduleOrigin = ast.body?.[0] ?? ast;
	const hmrBlocks = buildUniversalHmrBlocksAst(state, moduleOrigin);
	const metadata = {
		componentHelper: state.helpers.component,
		componentValueHelper: state.helpers.nestedComponent,
		propsHelper: state.helpers.props,
		regionHelpers: {
			children: state.helpers.children,
			if: state.helpers.if,
			switch: state.helpers.switch,
			for: state.helpers.for,
			try: state.helpers.try,
			context: state.helpers.context,
			activity: state.helpers.activity,
		},
		components: state.components,
	};
	const profileImport = universalProfileImportAst(state, moduleOrigin);
	const threeHostIntrinsics = threeHostIntrinsicStatementsAst(state, moduleOrigin);
	const program = {
		...ast,
		body: [
			...universalHelperImportAsts(state, [], moduleOrigin),
			...threeHostIntrinsics.imports,
			...(profileImport === null ? [] : [profileImport]),
			...hmrBlocks.prelude,
			...threeHostIntrinsics.registrations,
			...universalPlanDeclarationsAst(state, moduleOrigin),
			...(state.threadFunctionRegistrationsAst ?? []),
			...emitted,
			...hmrBlocks.tail,
		],
	};
	const result = compileClient(program, metadata);
	return {
		...result,
		...(universalRuntime === undefined ? null : { universalRuntime }),
	};
}
