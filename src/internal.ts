import type { ElementType, ReactElement, ReactNode } from "react";

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
  readonly mode: "shallow" | "mount";
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
