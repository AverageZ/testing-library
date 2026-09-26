import * as React from 'react';
import type { ComponentProps, ReactElement } from 'react';
import { getComponentRenderer } from '@avgz/react-contract-renderer';

function Child(_props: { count: number; onChange: (value: number) => void }) {
  return null;
}
function App(_props: { name: string; enabled?: boolean }) {
  return null;
}
class ClassRoot extends React.Component<{ count: number }> {
  override render() {
    return null;
  }
}
const ForwardRoot = React.forwardRef<unknown, { label: string }>(
  (_props, _ref) => null,
);
const MemoRoot = React.memo(ForwardRoot);
const LazyRoot = React.lazy(async () => ({ default: App }));
function Provider({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}
function RequiredProvider(_props: {
  theme: string;
  children?: React.ReactNode;
}) {
  return null;
}

export function publicTypeContract(): void {
  const renderer = getComponentRenderer(App, { name: 'value' });
  const session = renderer.shallow({ name: 'other' }).with(Provider);
  const { subject } = session;
  const props: ComponentProps<typeof App> = subject.props();
  const name: string = props.name;
  const count: number = subject.find(Child).prop('count');
  const children = subject.findAll(Child);
  const childElement: ReactElement<ComponentProps<typeof Child>> =
    children[0]!.element();
  subject.find(Child).prop('onChange')(count);
  session.rerender({ enabled: true });
  const actResult: Promise<void> = session.act(async () => {
    await Promise.resolve();
  });
  renderer.mount({ enabled: true });

  const classRenderer = getComponentRenderer(ClassRoot, { count: 1 });
  classRenderer.shallow({ count: 2 });
  const forwardRenderer = getComponentRenderer(ForwardRoot, { label: 'value' });
  forwardRenderer.mount({ label: 'other' });
  getComponentRenderer(MemoRoot, { label: 'memo' }).shallow();
  getComponentRenderer(LazyRoot, { name: 'lazy' }).shallow();

  const button = getComponentRenderer('button', {
    type: 'button',
    children: 'Save',
  }).mount().subject;
  const buttonType: ComponentProps<'button'>['type'] = button.prop('type');

  // @ts-expect-error Defaults must supply required props.
  getComponentRenderer(App, {});
  // @ts-expect-error Defaults cannot weaken the component's prop type.
  getComponentRenderer(App, { name: 42 });
  // @ts-expect-error Unknown default props are rejected.
  getComponentRenderer(App, { name: 'value', unknown: true });
  // @ts-expect-error Overrides remain strictly typed.
  renderer.shallow({ name: 42 });
  // @ts-expect-error Unknown overrides are rejected.
  renderer.mount({ missing: 'value' });
  // @ts-expect-error Rerender values remain strictly typed.
  session.rerender({ enabled: 'yes' });
  // @ts-expect-error Rerender rejects unknown props.
  session.rerender({ missing: true });
  // @ts-expect-error Found component props retain their value types.
  const invalid: string = subject.find(Child).prop('count');
  // @ts-expect-error Found callback arguments remain typed.
  subject.find(Child).prop('onChange')('wrong');
  // @ts-expect-error Unknown prop names are rejected.
  subject.find(Child).prop('missing');
  // @ts-expect-error Providers must not require unsupplied props.
  renderer.mount().with(RequiredProvider);
  // @ts-expect-error Intrinsic props retain their element-specific contract.
  getComponentRenderer('button', { type: 'not-a-button-type' });
  // @ts-expect-error Class component defaults retain their prop type.
  classRenderer.mount({ count: 'many' });
  // @ts-expect-error ForwardRef component defaults retain their prop type.
  forwardRenderer.shallow({ label: 1 });

  void name;
  void childElement;
  void actResult;
  void buttonType;
  void invalid;
}
