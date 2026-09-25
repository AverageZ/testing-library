import * as React from 'react';
import type { ComponentType, ElementType, ReactNode } from 'react';
import { createShallowRoot } from './adapters/reconciler.js';
import type { HostNode } from './adapters/reconciler.js';
import type {
  DriverOptions,
  InspectionNode,
  PropRecord,
  RenderDriver,
} from './internal.js';
import { wrap } from './internal.js';

const outputType = 'contract-renderer-output';
const wrappedTypes = new WeakMap<object, ElementType>();
const noChildren: readonly InspectionNode[] = Object.freeze([]);

type FunctionComponent = (props: PropRecord) => ReactNode;
type ClassComponent = new (
  props: PropRecord,
  context?: unknown,
) => React.Component<PropRecord>;
interface ExoticType {
  readonly $$typeof?: symbol;
  readonly type?: ElementType;
  readonly render?: (
    props: PropRecord,
    ref: React.ForwardedRef<unknown>,
  ) => ReactNode;
  readonly compare?: (previous: PropRecord, next: PropRecord) => boolean;
  readonly _init?: (payload: unknown) => ElementType;
  readonly _payload?: unknown;
}

function capture(value: ReactNode, props: PropRecord): React.ReactElement {
  return React.createElement(outputType, { value, input: props });
}

/** Only this boundary invokes the target; React still owns the wrapper's hook and class lifecycle. */
function instrument(type: ElementType): ElementType {
  if (typeof type === 'string') {
    return (props: PropRecord) =>
      capture(props['children'] as ReactNode, props);
  }
  const existing = wrappedTypes.get(type);
  if (existing) return existing;
  let result: ComponentType<PropRecord>;
  if (typeof type === 'function') {
    if (type.prototype && 'isReactComponent' in type.prototype) {
      // React component constructors cannot be expressed as a single invariant ElementType generic.
      const Base = type as ClassComponent;
      result = class ContractTarget extends Base {
        override render(): ReactNode {
          return capture(super.render(), this.props);
        }
      };
    } else {
      const render = type as FunctionComponent;
      result = (props: PropRecord) => capture(render(props), props);
      if ('defaultProps' in type)
        Object.assign(result, { defaultProps: type.defaultProps });
    }
  } else {
    // These symbols and lazy/forwardRef fields are the version-tested private integration boundary.
    const exotic = type as ExoticType;
    switch (exotic.$$typeof) {
      case Symbol.for('react.memo'): {
        if (!exotic.type) throw new TypeError('Invalid memo component');
        const child = instrument(exotic.type) as ComponentType<PropRecord>;
        result = React.memo(child, exotic.compare);
        break;
      }
      case Symbol.for('react.forward_ref'): {
        const { render } = exotic;
        if (!render) throw new TypeError('Invalid forwardRef component');
        result = React.forwardRef<unknown, PropRecord>((props, ref) =>
          capture(render(props, ref), props),
        );
        break;
      }
      case Symbol.for('react.lazy'): {
        const initialize = exotic._init;
        if (!initialize) throw new TypeError('Invalid lazy component');
        result = (props: PropRecord) =>
          React.createElement(instrument(initialize(exotic._payload)), props);
        break;
      }
      default:
        throw new TypeError(
          'Shallow rendering requires a component function, class, memo, forwardRef, lazy component, or host tag',
        );
    }
  }
  wrappedTypes.set(type, result);
  return result;
}

function outputNode(node: HostNode): HostNode | undefined {
  if (node.hidden) return undefined;
  if (node.type === outputType) return node;
  for (const child of node.children) {
    const found = outputNode(child);
    if (found) return found;
  }
  return undefined;
}

function inspectChildren(value: ReactNode): {
  children: readonly InspectionNode[];
  text: string;
} {
  const children: InspectionNode[] = [];
  let text = '';
  React.Children.forEach(value, (child) => {
    if (
      typeof child === 'string' ||
      typeof child === 'number' ||
      typeof child === 'bigint'
    ) {
      text += String(child);
    } else if (React.isValidElement<PropRecord>(child)) {
      const { type } = child;
      if (type === React.Fragment) {
        const inner = inspectChildren(child.props['children'] as ReactNode);
        children.push(...inner.children);
        text += inner.text;
      } else {
        const inner =
          typeof type === 'string'
            ? inspectChildren(child.props['children'] as ReactNode)
            : { children: noChildren, text: '' };
        children.push({
          type: type as ElementType,
          props: child.props,
          children: inner.children,
          text: inner.text,
          dom: null,
        });
        text += inner.text;
      }
    }
  });
  return { children, text };
}

export function createShallowDriver(options: DriverOptions): RenderDriver {
  const root = createShallowRoot();
  const Target = instrument(options.component);
  let disposed = false;
  let currentProps = options.props;
  let currentWrappers = options.wrappers;
  const driver: RenderDriver = {
    mode: 'shallow',
    inspect() {
      if (disposed) return null;
      const node = outputNode(root.container);
      if (!node) return null;
      const children = inspectChildren(node.props['value'] as ReactNode);
      return {
        type: options.component,
        props: node.props['input'] as PropRecord,
        children: children.children,
        text: children.text,
        dom: null,
      };
    },
    render(props, wrappers) {
      if (disposed) throw new Error('Cannot render an unmounted subject');
      currentProps = props;
      currentWrappers = wrappers;
      const target = React.createElement(Target, props);
      root.render(wrap(target, wrappers, React.createElement));
    },
    flush() {
      if (disposed) throw new Error('Cannot flush an unmounted subject');
      driver.render(currentProps, currentWrappers);
    },
    async act(callback) {
      if (disposed) throw new Error('Cannot update an unmounted subject');
      await root.act(callback);
    },
    unmount() {
      if (disposed) return;
      disposed = true;
      root.render(null);
    },
  };
  try {
    driver.render(options.props, options.wrappers);
  } catch (error) {
    driver.unmount();
    throw error;
  }
  return driver;
}
