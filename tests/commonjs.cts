import api = require("react-contract-renderer");

function Component(_props: { name: string }) {
  return null;
}
const renderer = api.getComponentRenderer(Component, { name: "typed" });
const name: string = renderer.shallow().subject.prop("name");
// @ts-expect-error CommonJS must not lose the public prop contract.
renderer.mount({ name: 42 });
void name;
