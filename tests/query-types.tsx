import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { getComponentRenderer } from '@avgz/react-contract-renderer';
import type { QueryTree, Subject } from '@avgz/react-contract-renderer';

function Child(_props: {
  count: number;
  onChange: (value: number) => void;
  children?: ReactNode;
}) {
  return null;
}

function App(_props: {
  content?: ReactNode;
  children?: ReactNode;
  header: ReactElement;
  items: readonly ReactNode[];
  label: string;
  count: number;
  enabled: boolean;
  empty: null;
  absent?: undefined;
  callback: () => ReactNode;
  optionalCallback?: () => ReactNode;
  configuration: { label: string };
  optionalConfiguration?: { label: string };
  mixed: ReactNode | (() => ReactNode);
  uncertain: unknown;
}) {
  return null;
}

export function queryTypeContract(): void {
  const { subject } = getComponentRenderer(App, {
    header: <h1>Title</h1>,
    items: [<span key="one">One</span>],
    label: 'label',
    count: 1,
    enabled: true,
    empty: null,
    callback: () => <span />,
    configuration: { label: 'value' },
    mixed: null,
    uncertain: null,
  }).shallow();
  const tree: QueryTree = subject.tree('content');
  const child: Subject<ComponentProps<typeof Child>> = tree.find(Child);
  const count: number = child.prop('count');
  const typedById: ComponentProps<typeof Child> = tree
    .findByTestId('child', Child)
    .props();
  const treeElement: ReactElement<ComponentProps<typeof Child>> = tree
    .findAllByTestId('child', Child)[0]!
    .element();
  const subjectElement: ReactElement<ComponentProps<typeof Child>> = subject
    .findByTestId('child', Child)
    .element();
  const subjectCount: number = subject
    .findAllByTestId('child', Child)[0]!
    .prop('count');
  const untypedValue: unknown = subject.findByTestId('child').prop('count');
  const treeUntypedValue: unknown = tree
    .findAllByTestId('child')[0]!
    .prop('count');
  const buttonType: ComponentProps<'button'>['type'] = tree
    .findByTestId('save', 'button')
    .prop('type');
  const disabled: ComponentProps<'button'>['disabled'] = subject
    .findAllByTestId('save', 'button')[0]!
    .prop('disabled');
  tree.findAll(Child)[0]!.prop('onChange')(count);
  subject.findByTestId('child', Child).prop('onChange')(count);
  tree.findByTestId('child', Child).tree('children').find('span');
  subject.findByTestId('child', Child).tree('children').find('span');
  subject.tree('children');
  subject.tree('header');
  subject.tree('items');
  subject.tree('label');
  subject.tree('count');
  subject.tree('enabled');
  subject.tree('empty');
  subject.tree('absent');
  subject.findByTestId('child', undefined);
  tree.findAllByTestId('child', undefined);

  // @ts-expect-error Tree traversal cannot execute a render callback.
  subject.tree('callback');
  // @ts-expect-error Optional callbacks are not React-node-valued props.
  subject.tree('optionalCallback');
  // @ts-expect-error Plain object props are not React nodes.
  subject.tree('configuration');
  // @ts-expect-error Optional plain object props remain outside the tree API.
  subject.tree('optionalConfiguration');
  // @ts-expect-error A union containing a callback is not entirely React-node-compatible.
  subject.tree('mixed');
  // @ts-expect-error An unknown value must be typed before traversing it.
  subject.tree('uncertain');
  // @ts-expect-error Only existing prop names can be query boundaries.
  subject.tree('missing');
  // @ts-expect-error Untyped test-ID queries do not invent a component prop contract.
  const invalidUntyped: number = subject.findByTestId('child').prop('count');
  // @ts-expect-error Tree test-ID queries preserve the selected component's prop types.
  const invalidCount: string = tree.findByTestId('child', Child).prop('count');
  // @ts-expect-error Plural queries also preserve callback argument types.
  subject.findAllByTestId('child', Child)[0]!.prop('onChange')('wrong');
  // @ts-expect-error Tree find queries preserve callback argument types.
  tree.find(Child).prop('onChange')('wrong');
  // @ts-expect-error Optional host types retain intrinsic-specific props.
  tree.findByTestId('save', 'button').prop('href');
  // @ts-expect-error Found component callback props cannot become query trees.
  tree.findByTestId('child', Child).tree('onChange');
  // @ts-expect-error Test IDs are exact string values, not numeric selectors.
  subject.findByTestId(1);

  void typedById;
  void treeElement;
  void subjectElement;
  void subjectCount;
  void untypedValue;
  void treeUntypedValue;
  void buttonType;
  void disabled;
  void invalidUntyped;
  void invalidCount;
}
