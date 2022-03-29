import ts from "rollup-plugin-ts"

/** @type {import("rollup").RollupOptions} */
const config = {
	input: "./source/index.ts",

	plugins: [
		ts({
			transpiler: "swc",
			browserslist: "maintained node versions",
			swcConfig: { minify: true },
		}),
	],

	output: {
		file: "./source/index.js",
		format: "commonjs",
		exports: "default",
	},
}

export default config
