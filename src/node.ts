declare const LanguageOf: unique symbol
declare const DenotationOf: unique symbol
declare const FactsOfNode: unique symbol
declare const ResultOf: unique symbol
declare const BindingIdType: unique symbol

export interface Facts {
  readonly kind: string
}

export interface Node<L, F extends Facts = Facts> {
  readonly kind: string
  readonly [LanguageOf]: (language: L) => L
  readonly [FactsOfNode]: F
}

export interface Expr<L, D, F extends Facts = Facts> extends Node<L, F> {
  readonly role: "expr"
  readonly type: RuntimeType
  readonly [DenotationOf]: D
}

export type RuntimeType =
  | { readonly role: "type"; readonly kind: string }
  | { readonly role: "callable"; readonly kind: "callable"; readonly params: ReadonlyArray<RuntimeType>; readonly returns: RuntimeType }

export interface TypeNode<L, D, F extends Facts = Facts> extends Node<L, F> {
  readonly role: "type"
  readonly [DenotationOf]: D
}

export interface Stmt<L, F extends Facts = Facts, R = void> extends Node<L, F> {
  readonly role: "stmt"
  readonly [ResultOf]: R
  [Symbol.iterator](): Generator<Stmt<L, F, R>, R, unknown>
}

export type Denotes<N> = N extends { readonly [DenotationOf]: infer D } ? D : never
export type FactsOf<N> = N extends { readonly [FactsOfNode]: infer F } ? F : never
export type KindsOf<N> = FactsOf<N> extends infer F ? (F extends Facts ? F["kind"] : never) : never

export type Body<L, Y extends Stmt<L, Facts, any> = Stmt<L, Facts, any>, R = void> = () => Generator<Y, R, unknown>

export type BindingId = string & { readonly [BindingIdType]: true }

export interface Binding {
  readonly id: BindingId
  readonly nameHint: string
}

export const binding = (nameHint: string): Binding => ({ id: crypto.randomUUID() as BindingId, nameHint })

export interface Structure<N> {
  readonly children?: (node: N) => ReadonlyArray<AnyNode>
  readonly declares?: (node: N) => ReadonlyArray<Binding>
  readonly references?: (node: N) => ReadonlyArray<Binding>
}

const StructureKey = Symbol.for("ts-emit.lang.structure")
const ResultKey = Symbol.for("ts-emit.lang.result")

export interface AnyNode {
  readonly kind: string
  readonly role: "expr" | "type" | "stmt" | "block"
}

export interface NodeClass<N> {
  readonly role: AnyNode["role"]
  readonly prototype: Structure<N>
}

const classOf = <N>(role: AnyNode["role"], structure: Structure<N>): NodeClass<N> => {
  const prototype = Object.create(null)
  Object.defineProperty(prototype, StructureKey, { value: structure })
  if (role === "stmt") {
    Object.defineProperty(prototype, Symbol.iterator, {
      *value(this: { readonly [ResultKey]: unknown }) {
        yield this
        return this[ResultKey]
      },
    })
  }
  return { role, prototype }
}

export const exprClass = <N>(structure: Structure<N> = {}): NodeClass<N> => classOf("expr", structure)
export const typeClass = <N>(structure: Structure<N> = {}): NodeClass<N> => classOf("type", structure)
export const stmtClass = <N>(structure: Structure<N> = {}): NodeClass<N> => classOf("stmt", structure)

const make = <N extends { readonly kind: string }>(nodeClass: NodeClass<N>, fields: N, result?: unknown): N & AnyNode => {
  const node = Object.assign(Object.create(nodeClass.prototype), fields, { role: nodeClass.role })
  if (nodeClass.role === "stmt") Object.defineProperty(node, ResultKey, { value: result })
  return Object.freeze(node)
}

export interface Fields {
  readonly kind: string
  readonly [field: string]: unknown
}

export const expr = <L, D, F extends Facts>(nodeClass: NodeClass<any>, fields: Fields, type: RuntimeType): Expr<L, D, F> =>
  make(nodeClass, { ...fields, type }) as unknown as Expr<L, D, F>

export const typeNode = <L, D, F extends Facts>(nodeClass: NodeClass<any>, fields: Fields): TypeNode<L, D, F> =>
  make(nodeClass, fields) as unknown as TypeNode<L, D, F>

export const stmt = <L, F extends Facts, R = void>(nodeClass: NodeClass<any>, fields: Fields, result?: R): Stmt<L, F, R> =>
  make(nodeClass, fields, result) as unknown as Stmt<L, F, R>

export const structureOf = (node: AnyNode): Structure<AnyNode> =>
  (node as unknown as { readonly [StructureKey]?: Structure<AnyNode> })[StructureKey] ?? {}

export const children = (node: AnyNode): ReadonlyArray<AnyNode> => structureOf(node).children?.(node) ?? []

export interface Block {
  readonly kind: "block"
  readonly role: "block"
  readonly binds: ReadonlyArray<Binding>
  readonly statements: ReadonlyArray<AnyNode>
}

const blockClass = classOf<Block>("block", { children: (node) => node.statements })

export const scope = (binds: ReadonlyArray<Binding>, statements: ReadonlyArray<AnyNode>): Block =>
  make(blockClass, { kind: "block", binds, statements } as unknown as Block) as Block

export interface Drained<R> {
  readonly block: Block
  readonly result: R
}

export const drain = <R>(body: () => Generator<unknown, R, unknown>, binds: ReadonlyArray<Binding> = []): Drained<R> => {
  const statements: AnyNode[] = []
  const iterator = body()
  while (true) {
    const step = iterator.next()
    if (step.done) return { block: scope(binds, statements), result: step.value }
    statements.push(step.value as AnyNode)
  }
}

export const isBlock = (node: AnyNode): node is Block => node.role === "block"

export const walk = (root: AnyNode, visit: (node: AnyNode) => void): void => {
  visit(root)
  children(root).forEach((child) => walk(child, visit))
}
