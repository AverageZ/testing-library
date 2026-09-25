import type { ElementType } from 'react';
import type { InspectionNode, PropRecord } from '../internal.js';

export type DOMReactVersion = 17 | 18 | 19;

export function selectDOMReactVersion(version: string): DOMReactVersion {
  const match = /^(17|18|19)\.(\d+)\.(\d+)$/.exec(version);
  const major = Number(match?.[1]);
  const minor = Number(match?.[2]);
  const patch = Number(match?.[3]);
  if (major === 17 && minor === 0 && patch === 2) return 17;
  if (major === 18 && (minor === 2 || minor === 3)) return 18;
  if (major === 19 && minor >= 0 && minor <= 3) return 19;
  throw new Error(
    `Unsupported React version ${version}. Mount supports stable React 17.0.2, 18.2–18.3, and 19.0–19.3.`,
  );
}

// All private React DOM reads stay in this adapter. These fields and work tags
// are shared by the supported releases, except the React 17 offscreen tags.
interface Fiber {
  readonly tag: number;
  readonly type: unknown;
  readonly elementType: unknown;
  readonly memoizedProps: unknown;
  readonly memoizedState: unknown;
  readonly stateNode: unknown;
  readonly child: Fiber | null;
  readonly sibling: Fiber | null;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function currentFiber(publicRoot: unknown): Fiber {
  const root = record(publicRoot);
  if (root === null)
    throw new Error(
      'Unsupported React DOM internals: expected a mounted root.',
    );
  const internalRoot = record(root['_internalRoot']);
  if (internalRoot === null)
    throw new Error('Unsupported React DOM internals: expected a FiberRoot.');
  const current = record(internalRoot['current']);
  if (current === null || current['tag'] !== 3) {
    throw new Error(
      'Unsupported React DOM internals: expected FiberRoot.current.',
    );
  }
  return current as unknown as Fiber;
}

function skipped(fiber: Fiber, version: DOMReactVersion): boolean {
  if (fiber.tag === 4 || fiber.tag === 18) return true; // Portal, dehydrated fragment.
  const offscreen = version === 17 ? 23 : 22;
  const legacyHidden = version === 17 ? 24 : 23;
  return (
    (fiber.tag === offscreen || fiber.tag === legacyHidden) &&
    fiber.memoizedState !== null
  );
}

function isHost(fiber: Fiber, version: DOMReactVersion): boolean {
  return (
    fiber.tag === 5 ||
    (version === 19 && (fiber.tag === 26 || fiber.tag === 27))
  );
}

function exposedType(
  fiber: Fiber,
  version: DOMReactVersion,
): ElementType | null {
  if (isHost(fiber, version)) return fiber.type as ElementType;
  switch (fiber.tag) {
    case 0: // Function.
    case 1: // Class.
      return fiber.type as ElementType;
    case 11: // ForwardRef.
    case 14: // Memo.
      return fiber.type as ElementType;
    case 15: // SimpleMemo (fiber.type is the unwrapped function).
      return fiber.elementType as ElementType;
    default:
      return null;
  }
}

function hostElement(fiber: Fiber): Element | null {
  const node = record(fiber.stateNode);
  return node?.['nodeType'] === 1 ? (fiber.stateNode as Element) : null;
}

function firstDOM(fiber: Fiber, version: DOMReactVersion): Element | null {
  if (skipped(fiber, version)) return null;
  if (isHost(fiber, version)) return hostElement(fiber);
  for (let { child } = fiber; child !== null; child = child.sibling) {
    const element = firstDOM(child, version);
    if (element !== null) return element;
  }
  return null;
}

function committedText(fiber: Fiber, version: DOMReactVersion): string {
  if (skipped(fiber, version)) return '';
  if (fiber.tag === 6) {
    const node = record(fiber.stateNode);
    return typeof node?.['nodeValue'] === 'string' ? node['nodeValue'] : '';
  }
  // React omits HostText fibers for direct string children and innerHTML.
  // Reading the DOM also reflects browser-normalized text, not prop coercion.
  if (isHost(fiber, version) && fiber.child === null)
    return hostElement(fiber)?.textContent ?? '';
  let text = '';
  for (let { child } = fiber; child !== null; child = child.sibling) {
    text += committedText(child, version);
  }
  return text;
}

class CommittedNode implements InspectionNode {
  constructor(
    private readonly fiber: Fiber,
    readonly type: ElementType,
    private readonly version: DOMReactVersion,
  ) {}

  get props(): PropRecord {
    return record(this.fiber.memoizedProps) ?? {};
  }

  get children(): readonly InspectionNode[] {
    const children: InspectionNode[] = [];
    appendChildren(this.fiber.child, this.version, children);
    return children;
  }

  get text(): string {
    return committedText(this.fiber, this.version);
  }

  get dom(): Element | null {
    return firstDOM(this.fiber, this.version);
  }
}

function appendChildren(
  first: Fiber | null,
  version: DOMReactVersion,
  output: InspectionNode[],
): void {
  for (let fiber = first; fiber !== null; fiber = fiber.sibling) {
    if (skipped(fiber, version)) continue;
    const type = exposedType(fiber, version);
    if (type === null) appendChildren(fiber.child, version, output);
    else output.push(new CommittedNode(fiber, type, version));
  }
}

function findBoundary(
  first: Fiber | null,
  boundary: ElementType,
  version: DOMReactVersion,
): Fiber | null {
  for (let fiber = first; fiber !== null; fiber = fiber.sibling) {
    if (skipped(fiber, version)) continue;
    if (fiber.elementType === boundary || fiber.type === boundary) return fiber;
    const found = findBoundary(fiber.child, boundary, version);
    if (found !== null) return found;
  }
  return null;
}

export function inspectDOMRoot(
  version: DOMReactVersion,
  container: Element,
  publicRoot: unknown,
  boundary: ElementType,
): InspectionNode | null {
  const root =
    version === 17 ? record(container)?.['_reactRootContainer'] : publicRoot;
  const current = currentFiber(root);
  const targetBoundary = findBoundary(current.child, boundary, version);
  if (targetBoundary === null) return null;
  return new CommittedNode(targetBoundary, boundary, version);
}
