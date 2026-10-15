import { type AnyNode, type Binding, type BindingId, type Block, children, drain, isBlock, type KindsOf, type Stmt, structureOf } from "./node.ts"

declare const ProgramLanguage: unique symbol
declare const ProgramKinds: unique symbol

export interface Program<L, Kinds extends string = string, R = void> {
  readonly [ProgramLanguage]: (language: L) => L
  readonly [ProgramKinds]: Kinds
  readonly root: Block
  readonly result: R
}

export interface ScopeVisitor<Scope> {
  enter(bindings: ReadonlyArray<Binding>, parent: Scope): Scope
  reference(reference: Binding, scope: Scope): void
}

export const visitScopes = <Scope>(root: Block, initial: Scope, visitor: ScopeVisitor<Scope>): void => {
  const visitBlock = (block: Block, parent: Scope): void => {
    const declared = block.statements.flatMap((statement) => structureOf(statement).declares?.(statement) ?? [])
    const scope = visitor.enter([...block.binds, ...declared], parent)
    block.statements.forEach((statement) => visit(statement, scope))
  }
  const visit = (node: AnyNode, scope: Scope): void => {
    if (isBlock(node)) return visitBlock(node, scope)
    for (const reference of structureOf(node).references?.(node) ?? []) visitor.reference(reference, scope)
    children(node).forEach((child) => visit(child, scope))
  }
  visitBlock(root, initial)
}

export const validateScopes = (root: Block): void => {
  const declared = new Set<BindingId>()
  visitScopes(root, new Set<BindingId>(), {
    enter: (bindings, parent) => {
      const visible = new Set(parent)
      for (const binding of bindings) {
        if (declared.has(binding.id)) {
          throw new Error(`binding "${binding.nameHint}" is declared more than once with the same identity`)
        }
        declared.add(binding.id)
        visible.add(binding.id)
      }
      return visible
    },
    reference: (reference, visible) => {
      if (!visible.has(reference.id)) {
        throw new Error(`reference to "${reference.nameHint}" does not resolve to an in-scope binding (scope extrusion is checked at build time)`)
      }
    },
  })
}

export interface Language {
  readonly name: string
}

export const builder =
  <L extends Language>() => <Y extends Stmt<L, any, any>, R = void>(body: () => Generator<Y, R, unknown>): Program<L, KindsOf<Y>, R> => {
    const { block, result } = drain(body)
    validateScopes(block)
    return { root: block, result } as unknown as Program<L, KindsOf<Y>, R>
  }
