require("@rushstack/eslint-patch/modern-module-resolution");

module.exports = {
  extends: ["@saberhq"],
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: "tsconfig.json",
  },
};
