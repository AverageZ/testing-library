import { createElement } from 'react';
import type {
  ComponentProps,
  ElementType,
  ReactElement,
  ReactNode,
} from 'react';
import type { InspectionNode } from './internal.js';
import { inspectReactChildren } from './internal.js';

type QueryMode = 'shallow' | 'mount' | 'tree';
type NodeMatcher = (node: InspectionNode) => boolean;
// React 17 includes {} in ReactNode. Keep legacy slot declarations usable
// without treating explicitly typed callbacks, objects, or unknown as nodes.
type ConcreteNode<T> = T extends unknown ? ({} extends T ? never : T) : never;
type InvalidNode<T> =
  T extends ConcreteNode<ReactNode>
    ? never
    : [T] extends [object]
      ? {} extends ReactNode
        ? string extends T
          ? never
          : T
        : T
      : T;
type ReactNodeKey<P> = {
  [K in keyof P]-?: [InvalidNode<P[K]>] extends [never] ? K : never;
}[keyof P];

interface Selection {
  readonly boundary: string;
  readonly multiple: string;
  readonly expectedType: ElementType | undefined;
}

function validateType(type: unknown): void {
  if (typeof type === 'string') {
    if (!/^[a-zA-Z][a-zA-Z0-9:_-]*$/.test(type)) {
      throw new TypeError(
        'Subject queries accept an intrinsic tag name, not a CSS selector.',
      );
    }
    return;
  }

  if (typeof type === 'function') return;

  const marker: unknown =
    typeof type === 'object' && type !== null && '$$typeof' in type
      ? type.$$typeof
      : type;
  if (typeof marker === 'symbol') {
    const name = Symbol.keyFor(marker);
    if (
      name === 'react.memo' ||
      name === 'react.forward_ref' ||
      name === 'react.lazy' ||
      name === 'react.context' ||
      name === 'react.provider' ||
      name === 'react.consumer' ||
      name === 'react.fragment' ||
      name === 'react.strict_mode' ||
      name === 'react.profiler' ||
      name === 'react.suspense' ||
      name === 'react.suspense_list' ||
      name === 'react.activity'
    )
      return;
  }

  throw new TypeError(
    'Subject queries require a React component identity or an intrinsic tag name.',
  );
}

function describeType(type: ElementType): string {
  if (typeof type === 'string') return JSON.stringify(type);
  if (typeof type === 'symbol') return String(type);
  if ('displayName' in type && typeof type.displayName === 'string')
    return type.displayName;
  if (typeof type === 'function' && type.name) return type.name;
  return 'anonymous React component';
}

function collectMatches(
  node: InspectionNode,
  matchesNode: NodeMatcher,
  matches: InspectionNode[],
): void {
  if (matchesNode(node)) matches.push(node);
  for (const child of node.children)
    collectMatches(child, matchesNode, matches);
}

function resolveSelection(
  nodes: readonly InspectionNode[],
  selection?: Selection,
): InspectionNode | undefined {
  const boundary =
    selection === undefined ? '' : ` Query: ${selection.boundary}.`;
  if (nodes.length > 1) {
    throw new Error(
      `Subject selection is ambiguous: found ${nodes.length} nodes.${boundary} Use ${selection?.multiple ?? 'findAll()'} to select multiple nodes.`,
    );
  }
  const node = nodes[0];
  if (
    node !== undefined &&
    selection?.expectedType !== undefined &&
    node.type !== selection.expectedType
  ) {
    throw new TypeError(
      `Subject selection type mismatch: expected ${describeType(selection.expectedType)}, found ${describeType(node.type)}.${boundary}`,
    );
  }
  return node;
}

/** A live query boundary over existing nodes, without rendering new components. */
export class QueryTree {
  /** @internal */
  constructor(
    private readonly rootSource: () => readonly InspectionNode[],
    protected readonly mode: QueryMode,
    protected readonly boundary = 'Subject',
  ) {}

  /** Match a component identity or host tag, including each root node. */
  find<C extends ElementType>(type: C): Subject<ComponentProps<C>> {
    validateType(type);
    return this.select((node) => node.type === type, {
      boundary: `${this.boundary}.find(${describeType(type)})`,
      multiple: 'findAll()',
      expectedType: undefined,
    });
  }

  /** Return live selections by match index. Re-query after insertion/reordering to obtain a new list. */
  findAll<C extends ElementType>(
    type: C,
  ): readonly Subject<ComponentProps<C>>[] {
    validateType(type);
    return this.selectAll((node) => node.type === type, {
      boundary: `${this.boundary}.findAll(${describeType(type)})`,
      multiple: 'findAll()',
      expectedType: undefined,
    });
  }

  /** Match an exact data-testid value; an optional type asserts the match's identity. */
  findByTestId(id: string, type?: undefined): Subject;
  findByTestId<C extends ElementType>(
    id: string,
    type: C,
  ): Subject<ComponentProps<C>>;
  findByTestId(id: string, type?: ElementType): Subject<unknown> {
    if (type !== undefined) validateType(type);
    return this.select((node) => node.props['data-testid'] === id, {
      boundary: `${this.boundary}.findByTestId(${JSON.stringify(id)})`,
      multiple: 'findAllByTestId()',
      expectedType: type,
    });
  }

  /** Return live matches by index, validating rather than filtering an optional type. */
  findAllByTestId(id: string, type?: undefined): readonly Subject[];
  findAllByTestId<C extends ElementType>(
    id: string,
    type: C,
  ): readonly Subject<ComponentProps<C>>[];
  findAllByTestId(id: string, type?: ElementType): readonly Subject<unknown>[] {
    if (type !== undefined) validateType(type);
    return this.selectAll((node) => node.props['data-testid'] === id, {
      boundary: `${this.boundary}.findAllByTestId(${JSON.stringify(id)})`,
      multiple: 'findAllByTestId()',
      expectedType: type,
    });
  }

  private select<P>(
    matchesNode: NodeMatcher,
    selection: Selection,
  ): Subject<P> {
    this.rootSource();
    return new Subject<P>(() => this.search(matchesNode), this.mode, selection);
  }

  private selectAll<P>(
    matchesNode: NodeMatcher,
    selection: Selection,
  ): readonly Subject<P>[] {
    return this.search(matchesNode).map(
      (_, index) =>
        new Subject<P>(
          () => {
            const node = this.search(matchesNode)[index];
            return node === undefined ? [] : [node];
          },
          this.mode,
          selection,
        ),
    );
  }

  private search(matchesNode: NodeMatcher): readonly InspectionNode[] {
    const matches: InspectionNode[] = [];
    for (const node of this.rootSource())
      collectMatches(node, matchesNode, matches);
    return matches;
  }
}

/** A live selection: every inspection resolves against the latest committed render. */
export class Subject<P = Readonly<Record<string, unknown>>> extends QueryTree {
  /** @internal */
  constructor(
    private readonly source: () => readonly InspectionNode[],
    mode: QueryMode,
    private readonly selection?: Selection,
  ) {
    super(
      () => {
        const node = resolveSelection(source(), selection);
        return node === undefined ? [] : [node];
      },
      mode,
      selection?.boundary,
    );
  }

  /** Inspect a React-node-valued prop explicitly; custom components stay opaque. */
  tree<K extends ReactNodeKey<P>>(key: K): QueryTree {
    this.resolve();
    return new QueryTree(
      () => {
        const node = this.resolve();
        return inspectReactChildren(node?.props[key as string] as ReactNode)
          .children;
      },
      'tree',
      `${this.boundary}.tree(${JSON.stringify(String(key))})`,
    );
  }

  /** Report whether exactly one matching node exists in the current render. */
  exists(): boolean {
    return this.resolve() !== undefined;
  }

  /** Return every prop from the selected component or host node. */
  props(): P {
    return this.requireNode().props as P;
  }

  /** Return one typed prop from the selected component or host node. */
  prop<K extends keyof P>(key: K): P[K] {
    return this.props()[key];
  }

  /** Return the selected node's string className, if it has one. */
  className(): string | undefined {
    const value = this.requireNode().props['className'];
    if (value === undefined) return undefined;
    if (typeof value !== 'string') {
      throw new TypeError(
        'The selected node has a className prop that is not a string.',
      );
    }
    return value;
  }

  /** Return the selected component identity or intrinsic host tag. */
  type(): ElementType {
    return this.requireNode().type;
  }

  /** Recreate the selected node as a React element with its current props. */
  element(): ReactElement<P> {
    const node = this.requireNode();
    return createElement(node.type, node.props) as unknown as ReactElement<P>;
  }

  /** Return all text content beneath the selected node. */
  text(): string {
    return this.requireNode().text;
  }

  /**
   * Mount only: return the first host element represented by the selected
   * contract. Prop-tree selections never have associated DOM.
   */
  getDOMNode(): Element {
    const node = this.requireNode();
    if (this.mode === 'shallow') {
      throw new Error(
        'getDOMNode() is unavailable for shallow rendering; use mount() instead.',
      );
    }
    if (this.mode === 'tree') {
      throw new Error(
        'The selected prop-tree node has no associated host DOM element.',
      );
    }
    if (node.dom === null) {
      throw new Error('The selected node has no associated host DOM element.');
    }
    return node.dom;
  }

  private resolve(): InspectionNode | undefined {
    return resolveSelection(this.source(), this.selection);
  }

  private requireNode(): InspectionNode {
    const node = this.resolve();
    if (node === undefined) {
      const boundary =
        this.selection === undefined
          ? ''
          : ` Query: ${this.selection.boundary}.`;
      throw new Error(
        `Subject selection is empty: no matching node exists in the current render.${boundary}`,
      );
    }
    return node;
  }
}
