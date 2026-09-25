import type { ElementType, ReactElement, ReactNode } from 'react';

export type PropRecord = Readonly<Record<string, unknown>>;

/** A query-time view. Rendering does not allocate an inspection tree. */
export interface InspectionNode {
  readonly type: ElementType;
  readonly props: PropRecord;
  readonly children: readonly InspectionNode[];
  readonly text: string;
  readonly dom: Element | null;
}

export interface RenderDriver {
  readonly mode: 'shallow' | 'mount';
  inspect(): InspectionNode | null;
  render(props: PropRecord, wrappers: readonly ElementType[]): void;
  flush(): void;
  act(callback: () => void | Promise<void>): Promise<void>;
  unmount(): void;
}

export interface DriverOptions {
  readonly component: ElementType;
  readonly props: PropRecord;
  readonly wrappers: readonly ElementType[];
  readonly initialElement?: ReactElement | undefined;
}

export type DriverFactory = (options: DriverOptions) => RenderDriver;

let actScopes = 0;
let previousActEnvironment: PropertyDescriptor | undefined;

export function enterActEnvironment(): void {
  if (actScopes === 0) {
    previousActEnvironment = Object.getOwnPropertyDescriptor(
      globalThis,
      'IS_REACT_ACT_ENVIRONMENT',
    );
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: true,
    });
  }
  actScopes += 1;
}

export function leaveActEnvironment(): void {
  actScopes -= 1;
  if (actScopes !== 0) return;
  if (previousActEnvironment === undefined) {
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  } else {
    Object.defineProperty(
      globalThis,
      'IS_REACT_ACT_ENVIRONMENT',
      previousActEnvironment,
    );
  }
  previousActEnvironment = undefined;
}

export function wrap(
  element: ReactNode,
  wrappers: readonly ElementType[],
  create: (type: ElementType, props: { children: ReactNode }) => ReactNode,
): ReactNode {
  let result = element;
  for (let index = wrappers.length - 1; index >= 0; index -= 1) {
    const wrapper = wrappers[index];
    if (wrapper !== undefined) result = create(wrapper, { children: result });
  }
  return result;
}
