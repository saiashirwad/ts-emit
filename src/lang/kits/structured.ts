import {
  type AnyNode,
  type Binding,
  binding,
  type Block,
  type Body,
  type Denotes,
  drain,
  type Expr,
  expr,
  exprClass,
  type Facts,
  type FactsOf,
  type RuntimeType,
  type Stmt,
  stmt,
  stmtClass,
  type TypeNode,
} from "../node.ts"
import type { Check, Kind, TypeLambda } from "../rule.ts"

export interface Ref<L, D, F extends Facts = { readonly kind: "ref" }> extends Expr<L, D, F> {
  readonly binding: Binding
}

export interface RefNode {
  readonly kind: "ref"
  readonly binding: Binding
  readonly type: RuntimeType
}

const refClass = exprClass<RefNode>({ references: (node) => [node.binding] })

export const ref = <L, D>(target: Binding, type: RuntimeType): Ref<L, D> => expr(refClass, { kind: "ref", binding: target }, type) as Ref<L, D>

export interface LetNode {
  readonly kind: "let"
  readonly binding: Binding
  readonly type: AnyNode
  readonly init: AnyNode
}

const letClass = stmtClass<LetNode>({ children: (node) => [node.type, node.init], declares: (node) => [node.binding] })

export interface AssignNode {
  readonly kind: "assign"
  readonly target: AnyNode
  readonly value: AnyNode
}

const assignClass = stmtClass<AssignNode>({ children: (node) => [node.target, node.value] })

export interface IfNode {
  readonly kind: "if"
  readonly condition: AnyNode
  readonly then: Block
  readonly else: Block | undefined
}

const ifClass = stmtClass<IfNode>({ children: (node) => [node.condition, node.then, ...(node.else === undefined ? [] : [node.else])] })

export interface WhileNode {
  readonly kind: "while"
  readonly condition: AnyNode
  readonly body: Block
}

const whileClass = stmtClass<WhileNode>({ children: (node) => [node.condition, node.body] })

export interface ExpressionNode {
  readonly kind: "expression"
  readonly expr: AnyNode
}

const expressionClass = stmtClass<ExpressionNode>({ children: (node) => [node.expr] })

export const structured = <L extends { readonly Assign: TypeLambda; readonly Truthy: TypeLambda }>() => ({
  let: <D, FT extends Facts, I, FI extends Facts>(
    nameHint: string,
    init: Expr<L, I, FI> & Check<Kind<L["Assign"], [I, D]>, "initializer is not assignable to the declared type", { from: I; to: D }>,
    type: TypeNode<L, D, FT>,
  ): Stmt<L, { readonly kind: "let" } | FT | FI, Ref<L, D>> => {
    const declared = binding(nameHint)
    return stmt(letClass, { kind: "let", binding: declared, type, init }, ref<L, D>(declared, type))
  },

  assign: <D, I, FI extends Facts>(
    target: Ref<L, D>,
    value: Expr<L, I, FI> & Check<Kind<L["Assign"], [I, D]>, "value is not assignable to the binding", { from: I; to: D }>,
  ): Stmt<L, { readonly kind: "assign" | "ref" } | FI> => stmt(assignClass, { kind: "assign", target, value }),

  if: <E extends Expr<L, any, any>, Y extends Stmt<L, any, any>, Z extends Stmt<L, any, any> = never>(
    condition: E & Check<Kind<L["Truthy"], [Denotes<E>]>, "condition has the wrong type">,
    then: Body<L, Y>,
    otherwise?: Body<L, Z>,
  ): Stmt<L, { readonly kind: "if" } | FactsOf<E> | FactsOf<Y> | FactsOf<Z>> =>
    stmt(ifClass, { kind: "if", condition, then: drain(then).block, else: otherwise === undefined ? undefined : drain(otherwise).block }),

  while: <D, F extends Facts, Y extends Stmt<L, any, any>>(
    condition: Expr<L, D, F> & Check<Kind<L["Truthy"], [D]>, "condition has the wrong type">,
    body: Body<L, Y>,
  ): Stmt<L, { readonly kind: "while" } | F | FactsOf<Y>> => stmt(whileClass, { kind: "while", condition, body: drain(body).block }),

  run: <D, F extends Facts>(value: Expr<L, D, F>): Stmt<L, { readonly kind: "expression" } | F> =>
    stmt(expressionClass, { kind: "expression", expr: value }),
})
