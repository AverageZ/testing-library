import { createElement } from "react";
import type { ComponentProps, ElementType, ReactElement } from "react";
import type { InspectionNode, PropRecord } from "./internal.js";

function validateType(type: unknown): void {
  if (typeof type === "string") {
    if (!/^[a-zA-Z][a-zA-Z0-9:_-]*$/.test(type)) {
      throw new TypeError(
        "Subject queries accept an intrinsic tag name, not a CSS selector.",
      );
    }
    return;
  }

  if (typeof type === "function") return;

  const marker: unknown =
    typeof type === "object" && type !== null && "$$typeof" in type
      ? type.$$typeof
      : type;
  if (typeof marker === "symbol") {
    const name = Symbol.keyFor(marker);
    if (
      name === "react.memo" ||
      name === "react.forward_ref" ||
      name === "react.lazy" ||
      name === "react.context" ||
      name === "react.provider" ||
      name === "react.consumer" ||
      name === "react.fragment" ||
      name === "react.strict_mode" ||
      name === "react.profiler" ||
      name === "react.suspense" ||
      name === "react.suspense_list" ||
      name === "react.activity"
    )
      return;
  }

  throw new TypeError(
    "Subject queries require a React component identity or an intrinsic tag name.",
  );
}

function collectMatches(
  node: InspectionNode,
  type: ElementType,
  matches: InspectionNode[],
): void {
  if (node.type === type) matches.push(node);
  for (const child of node.children) collectMatches(child, type, matches);
}

/** A live selection: every inspection resolves against the latest committed render. */
export class Subject<P = PropRecord> {
  constructor(
    private readonly source: () => readonly InspectionNode[],
    private readonly mode: "shallow" | "mount",
  ) {}

  /** Match a component identity or host tag, including this node; inspection rejects multiple matches. */
  find<C extends ElementType>(type: C): Subject<ComponentProps<C>> {
    validateType(type);
    this.resolve();
    return new Subject<ComponentProps<C>>(() => this.search(type), this.mode);
  }

  /** Return live selections by match index. Re-query after insertion/reordering to obtain a new list. */
  findAll<C extends ElementType>(
    type: C,
  ): readonly Subject<ComponentProps<C>>[] {
    validateType(type);
    return this.search(type).map(
      (_, index) =>
        new Subject<ComponentProps<C>>(() => {
          const node = this.search(type)[index];
          return node === undefined ? [] : [node];
        }, this.mode),
    );
  }

  exists(): boolean {
    return this.resolve() !== undefined;
  }

  props(): P {
    return this.requireNode().props as P;
  }

  prop<K extends keyof P>(key: K): P[K] {
    return this.props()[key];
  }

  className(): string | undefined {
    const value = this.requireNode().props["className"];
    if (value === undefined) return undefined;
    if (typeof value !== "string") {
      throw new TypeError(
        "The selected node has a className prop that is not a string.",
      );
    }
    return value;
  }

  type(): ElementType {
    return this.requireNode().type;
  }

  element(): ReactElement<P> {
    const node = this.requireNode();
    return createElement(node.type, node.props) as unknown as ReactElement<P>;
  }

  text(): string {
    return this.requireNode().text;
  }

  /** Mount only: return the first host Element represented by the selected contract. */
  getDOMNode(): Element {
    const node = this.requireNode();
    if (this.mode === "shallow") {
      throw new Error(
        "getDOMNode() is unavailable for shallow rendering; use mount() instead.",
      );
    }
    if (node.dom === null) {
      throw new Error("The selected node has no associated host DOM element.");
    }
    return node.dom;
  }

  private resolve(): InspectionNode | undefined {
    const nodes = this.source();
    if (nodes.length > 1) {
      throw new Error(
        `Subject selection is ambiguous: found ${nodes.length} nodes. Use findAll() to select multiple nodes.`,
      );
    }
    return nodes[0];
  }

  private requireNode(): InspectionNode {
    const node = this.resolve();
    if (node === undefined) {
      throw new Error(
        "Subject selection is empty: no matching node exists in the current render.",
      );
    }
    return node;
  }

  private search(type: ElementType): readonly InspectionNode[] {
    const node = this.resolve();
    if (node === undefined) return [];
    const matches: InspectionNode[] = [];
    collectMatches(node, type, matches);
    return matches;
  }
}
