import {
  type AnyNode,
  type Binding,
  binding,
  type Block,
  type Denotes,
  drain,
  type Expr,
  expr,
  exprClass,
  type Facts,
  type FactsOf,
  type KindsOf,
  type Stmt,
  stmt,
  stmtClass,
  type TypeNode,
} from "../node.ts"
import type { Accepts, Check, Kind, Rejected, TypeLambda } from "../rule.ts"
import { type Ref, ref } from "./structured.ts"

export interface Signature<Params extends readonly unknown[], Returns> {
  readonly params: Params
  readonly returns: Returns
}

export interface Param<L, D, F extends Facts = Facts> {
  readonly binding: Binding
  readonly type: TypeNode<L, D, F>
}

type ParamDenotations<P extends readonly Param<any, any, any>[]> = { readonly [K in keyof P]: Denotes<P[K]["type"]> }
export type ParamRefs<L, P extends readonly Param<any, any, any>[]> = {
  readonly [K in keyof P]: Ref<L, Denotes<P[K]["type"]>>
}
type ParamFacts<P extends readonly Param<any, any, any>[]> = FactsOf<P[number]["type"]>

export type Returned<Y> = Y extends Stmt<any, infer F, any> ? (F extends { readonly kind: "return"; readonly returns: infer D } ? D : never) : never

type ReturnsAccepted<L extends { readonly Assign: TypeLambda }, Returned, Declared> = [Returned] extends [never] ? true
  : Kind<L["Assign"], [Returned, Declared]>

export interface FunctionNode {
  readonly kind: "function"
  readonly binding: Binding
  readonly params: ReadonlyArray<{ readonly binding: Binding; readonly type: AnyNode }>
  readonly returns: AnyNode
  readonly body: Block
}

const functionClass = stmtClass<FunctionNode>({
  children: (node) => [...node.params.map((param) => param.type), node.returns, node.body],
  declares: (node) => [node.binding],
})

export interface ReturnNode {
  readonly kind: "return"
  readonly value: AnyNode
}

const returnClass = stmtClass<ReturnNode>({ children: (node) => [node.value] })

export interface CallNode {
  readonly kind: "call"
  readonly callee: AnyNode
  readonly args: ReadonlyArray<AnyNode>
}

const callClass = exprClass<CallNode>({ children: (node) => [node.callee, ...node.args] })

export type ArgumentsAccepted<L extends { readonly Assign: TypeLambda }, Args extends readonly unknown[], Params extends readonly unknown[]> =
    Args["length"] extends Params["length"] ?
      { [K in keyof Args]: Accepts<Kind<L["Assign"], [Denotes<Args[K]>, Params[K extends keyof Params ? K : number]]>> }[number] extends true ? true
    : false
  : false

export type FunctionResult<L extends { readonly Assign: TypeLambda }, P extends readonly Param<L, any, any>[], R, FR extends Facts, Y> =
    [Y] extends [Stmt<L, any, any>] ?
      Accepts<ReturnsAccepted<L, Returned<Y>, R>> extends true ? Stmt<
        L,
        { readonly kind: "function" | KindsOf<Y> } | ParamFacts<P> | FR,
        Ref<L, Signature<ParamDenotations<P>, R>>
      >
    : Rejected<"a return value is not assignable to the declared result", { returns: Returned<Y>; declared: R }>
  : Rejected<"the body yields something that is not a statement of this language", { yields: Y }>

export const functionConstruct = <L extends { readonly Assign: TypeLambda }>() => ({
  param: <D, F extends Facts>(nameHint: string, type: TypeNode<L, D, F>): Param<L, D, F> => ({ binding: binding(nameHint), type }),

  fn: <const P extends readonly Param<L, any, any>[], R, FR extends Facts, Y>(
    name: string,
    params: P,
    returns: TypeNode<L, R, FR>,
    body: (...refs: ParamRefs<L, P>) => Generator<Y, void, unknown>,
  ): FunctionResult<L, P, R, FR, Y> => {
    const declared = binding(name)
    const refs = params.map((param) => ref(param.binding, param.type)) as unknown as ParamRefs<L, P>
    const block = drain(() => body(...refs), params.map((param) => param.binding)).block
    const fields = { kind: "function", binding: declared, params, returns, body: block }
    return stmt(
      functionClass,
      fields,
      ref(declared, { role: "callable", kind: "callable", params: params.map((param) => param.type), returns }),
    ) as FunctionResult<L, P, R, FR, Y>
  },

  return: <D, F extends Facts>(value: Expr<L, D, F>): Stmt<L, { readonly kind: "return"; readonly returns: D } | F> =>
    stmt(returnClass, { kind: "return", value }),

  call: <Params extends readonly unknown[], R, FC extends Facts, const Args extends readonly Expr<L, any, any>[]>(
    callee:
      & Expr<L, Signature<Params, R>, FC>
      & Check<
        ArgumentsAccepted<L, Args, Params>,
        "arguments do not match the parameters",
        { params: Params; args: { [K in keyof Args]: Denotes<Args[K]> } }
      >,
    ...args: Args
  ): Expr<L, R, { readonly kind: "call" } | FC | FactsOf<Args[number]>> =>
    expr(
      callClass,
      { kind: "call", callee, args },
      callee.type.role === "callable"
        ? callee.type.returns
        : (() => {
          throw new Error("callee has no function signature")
        })(),
    ),
})
