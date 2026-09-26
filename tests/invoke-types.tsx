import * as React from 'react';
import { getComponentRenderer } from '@avgz/react-contract-renderer';

function Controls(_props: {
  count: number;
  onSelect: (id: string, quantity: number) => void;
  onOptional?: (id: string) => void;
  onNullable: ((enabled: boolean) => void) | null;
  onLoad: (id: string) => Promise<number>;
  onReset: () => number;
  onOptions: (id: string, enabled?: boolean) => void;
  onRest: (id: string, ...counts: number[]) => void;
  onEither:
    | (() => void)
    | ((event: React.MouseEvent<HTMLButtonElement>) => void);
  onShared: ((id: 'archer' | 'scout') => void) | ((id: 'archer') => void);
  mixed: string | (() => void);
  absent?: undefined;
}) {
  return null;
}

function App() {
  return null;
}

export function invokeTypeContract(
  event: React.MouseEvent<HTMLButtonElement>,
  callbackKey: 'onReset' | 'onSelect',
): void {
  const session = getComponentRenderer(App, {}).shallow();
  const controls = session.subject.find(Controls);
  const button = session.subject.find('button');

  const domainResult: Promise<void> = session.invoke(
    controls,
    'onSelect',
    'archer',
    3,
  );
  const asyncResult: Promise<void> = session.invoke(
    controls,
    'onLoad',
    'archer',
  );
  const valueResult: Promise<void> = session.invoke(controls, 'onReset');
  session.invoke(controls, 'onOptional', 'scout');
  session.invoke(controls, 'onNullable', true);
  session.invoke(controls, 'onOptions', 'archer');
  session.invoke(controls, 'onOptions', 'archer', false);
  session.invoke(controls, 'onRest', 'archer');
  session.invoke(controls, 'onRest', 'archer', 1, 2, 3);
  session.invoke(button, 'onClick', event);
  session.invoke(controls, 'onShared', 'archer');

  // @ts-expect-error Required mouse events are not synthesized or omitted.
  session.invoke(button, 'onClick');
  // @ts-expect-error Native events do not satisfy a React callback's event contract.
  session.invoke(button, 'onClick', new MouseEvent('click'));
  // @ts-expect-error Event callbacks retain their element-specific event type.
  session.invoke(button, 'onClick', {} as React.MouseEvent<HTMLDivElement>);
  // @ts-expect-error Callback arguments cannot widen the selected subject's props.
  session.invoke(controls, 'onSelect', 42, 3);
  // @ts-expect-error Every required tuple element must be supplied.
  session.invoke(controls, 'onSelect', 'archer');
  // @ts-expect-error Optional callbacks retain their required arguments.
  session.invoke(controls, 'onOptional');
  // @ts-expect-error Required arguments cannot become optional through inference.
  session.invoke(controls, 'onSelect', 'archer', undefined);
  // @ts-expect-error Callback argument order remains exact.
  session.invoke(controls, 'onSelect', 3, 'archer');
  // @ts-expect-error Zero-argument callbacks reject extra arguments.
  session.invoke(controls, 'onReset', 'extra');
  // @ts-expect-error Callbacks reject surplus arguments outside their tuple.
  session.invoke(controls, 'onSelect', 'archer', 3, true);
  // @ts-expect-error Optional tuple elements retain their value type.
  session.invoke(controls, 'onOptions', 'archer', 1);
  // @ts-expect-error Rest elements retain their value type.
  session.invoke(controls, 'onRest', 'archer', 1, 'two');
  // @ts-expect-error Non-callback keys are not invocable.
  session.invoke(controls, 'count');
  // @ts-expect-error Non-callback keys cannot widen the subject's prop contract.
  session.invoke(controls, 'count', 1);
  // @ts-expect-error Intrinsic non-callback props are also rejected.
  session.invoke(button, 'disabled');
  // @ts-expect-error Unknown callback keys cannot widen the subject's props.
  session.invoke(controls, 'onMissing');
  // @ts-expect-error A union with a non-function value is not a callback contract.
  session.invoke(controls, 'mixed');
  // @ts-expect-error Undefined-only props are not optional callbacks.
  session.invoke(controls, 'absent');
  // @ts-expect-error Union callback values cannot omit another member's required event.
  session.invoke(controls, 'onEither');
  // @ts-expect-error Union arguments must satisfy every possible callback.
  session.invoke(controls, 'onShared', 'scout');
  // @ts-expect-error A union key cannot select a callback with unsupplied required arguments.
  session.invoke(controls, callbackKey);
  // Both possible callbacks can receive the required selection arguments.
  session.invoke(controls, callbackKey, 'archer', 3);

  void domainResult;
  void asyncResult;
  void valueResult;
}
