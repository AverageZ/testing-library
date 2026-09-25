import type { ComponentProps } from "react";
import { getComponentRenderer } from "react-contract-renderer";

function Child(_props: { count: number; onChange: (value: number) => void }) {
  return null;
}
function App(_props: { name: string; enabled?: boolean }) {
  return null;
}

export function publicTypeContract(): void {
  const renderer = getComponentRenderer(App, { name: "value" });
  const { subject } = renderer.shallow({ name: "other" });
  const props: ComponentProps<typeof App> = subject.props();
  const name: string = props.name;
  const count: number = subject.find(Child).prop("count");
  subject.find(Child).prop("onChange")(count);
  renderer.mount({ enabled: true });
  void name;
  // @ts-expect-error Defaults must supply required props.
  getComponentRenderer(App, {});
  // @ts-expect-error Defaults cannot weaken the component's prop type.
  getComponentRenderer(App, { name: 42 });
  // @ts-expect-error Unknown default props are rejected.
  getComponentRenderer(App, { name: "value", unknown: true });
  // @ts-expect-error Overrides remain strictly typed.
  renderer.shallow({ name: 42 });
  // @ts-expect-error Unknown overrides are rejected.
  renderer.mount({ missing: "value" });
  // @ts-expect-error Found component props retain their value types.
  const invalid: string = subject.find(Child).prop("count");
  // @ts-expect-error Found callback arguments remain typed.
  subject.find(Child).prop("onChange")("wrong");
  // @ts-expect-error Unknown prop names are rejected.
  subject.find(Child).prop("missing");
  // @ts-expect-error Providers must not require unsupplied props.
  renderer.mount().with(App);
  void invalid;
}
