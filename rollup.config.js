import ts from "rollup-plugin-ts";

/** @type {import("rollup").RollupOptions} */
const config = {
  input: "./lib/index.ts",

  plugins: [
    ts({
      transpiler: "swc",
      browserslist: "maintained node versions",
      swcConfig: { minify: true },
    }),
  ],

  output: {
    file: "./lib/index.js",
    format: "commonjs",
    exports: "default",
  },
};

export default config;
