import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import * as esm from "react-contract-renderer";

const require = createRequire(import.meta.url);
const cjs = require("react-contract-renderer");
assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort());
assert.equal(esm.getComponentRenderer, cjs.getComponentRenderer);
assert.equal(typeof document, "undefined");
function Child() {
  throw new Error("Child executed during package shallow smoke");
}
function App({ value }) {
  const [current, setCurrent] = React.useState("pending");
  React.useEffect(() => {
    setCurrent(value);
  }, [value]);
  return React.createElement(Child, { value: current });
}
for (const api of [esm, cjs]) {
  const session = api
    .getComponentRenderer(App, { value: "verified" })
    .shallow();
  assert.equal(session.subject.find(Child).prop("value"), "verified");
  session.unmount();
}
console.log(
  `ESM and CommonJS consumer smoke passed on React ${React.version}, without a DOM.`,
);
