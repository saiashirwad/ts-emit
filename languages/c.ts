import {
  addConstruct,
  type AnyNode,
  braces,
  builder,
  defineTarget,
  emit,
  type Equal,
  type Expr,
  expr,
  exprClass,
  type Facts,
  frag,
  type Fragment,
  functionConstruct,
  type Handler,
  type KindsOf,
  lessConstruct,
  type Program,
  type RuntimeType,
  type Stmt,
  structured,
  typeClass,
  type TypeLambda,
  type TypeNode,
  typeNode,
  walk,
} from "../src/index.ts"
import type { AssignNode, BinaryNode, CallNode, ExpressionNode, FunctionNode, IfNode, LetNode, RefNode, ReturnNode, WhileNode } from "../src/index.ts"

export type Bits = 8 | 16 | 32 | 64

export interface Int<B extends Bits = Bits, Signed extends boolean = boolean> {
  readonly c: "int"
  readonly bits: B
  readonly signed: Signed
}
export interface Double {
  readonly c: "double"
}
export interface Ptr<T> {
  readonly c: "pointer"
  readonly to: T
}
export interface Void {
  readonly c: "void"
}

export type Arith = Int | Double
export type Scalar = Arith | Ptr<unknown>

type Wider<A extends Bits, B extends Bits> =
    A extends 64 ? 64
  : B extends 64 ? 64
  : A extends 32 ? 32
  : B extends 32 ? 32
  : A extends 16 ? 16
  : B extends 16 ? 16
  : 8

type Promoted<T> = T extends Int<8 | 16, boolean> ? Int<32, true> : T

type IntConverted<X extends Bits, SA extends boolean, Y extends Bits, SB extends boolean> =
    [X] extends [Y] ? Int<X, [SA, SB] extends [true, true] ? true : false>
  : [Wider<X, Y>] extends [X] ? Int<X, SA>
  : Int<Y, SB>

export type Converted<A, B> =
    [A, B] extends [Double, Arith] | [Arith, Double] ? Double
  : [Promoted<A>, Promoted<B>] extends [Int<infer X, infer SA>, Int<infer Y, infer SB>] ? IntConverted<X, SA, Y, SB>
  : never

export interface CAssign extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer A, infer B]
    ? [A, B] extends [Arith, Arith] ? true : [A, B] extends [Ptr<infer X>, Ptr<infer Y>] ? Equal<X, Y> : false
    : false
}

export interface CTruthy extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer T] ? ([T] extends [Scalar] ? true : false) : false
}

export interface CSum extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer A, infer B]
    ? [A, B] extends [Ptr<unknown>, Int] ? A : [A, B] extends [Int, Ptr<unknown>] ? B : Converted<A, B>
    : never
}

export interface CCompare extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer A, infer B] ? [Converted<A, B>] extends [never] ? never : Int<32, true> : never
}

export interface C {
  readonly name: "c"
  readonly Assign: CAssign
  readonly Truthy: CTruthy
  readonly Sum: CSum
  readonly Compare: CCompare
}

export interface IntTypeNode {
  readonly kind: "int-type"
  readonly bits: Bits
  readonly signed: boolean
}
export interface PointerTypeNode {
  readonly kind: "pointer-type"
  readonly to: TypeNode<C, unknown>
}
export interface LiteralNode {
  readonly kind: "literal"
  readonly value: number
  readonly type: TypeNode<C, unknown>
}
export interface UnaryNode {
  readonly kind: "address" | "deref"
  readonly operand: Expr<C, unknown>
}

const intTypeClass = typeClass<IntTypeNode>()
const doubleTypeClass = typeClass()
const voidTypeClass = typeClass()
const pointerTypeClass = typeClass<PointerTypeNode>({ children: (node) => [node.to] })
const literalClass = exprClass<LiteralNode>()
const unaryClass = exprClass<UnaryNode>({ children: (node) => [node.operand] })

type IntFacts = { readonly kind: "int-type" }

const intName = (node: IntTypeNode): string => `${node.signed ? "" : "u"}int${node.bits}_t`

const fieldsOf = <N>(node: AnyNode): N => node as unknown as N

const isArithmeticConstant = (node: AnyNode): boolean =>
  node.kind === "literal"
  || ((node.kind === "add" || node.kind === "less") && isArithmeticConstant(fieldsOf<BinaryNode>(node).left)
    && isArithmeticConstant(fieldsOf<BinaryNode>(node).right))

const isAddressConstant = (node: AnyNode): boolean => {
  if (node.kind === "address") return fieldsOf<UnaryNode>(node).operand.kind === "ref"
  if (node.kind !== "add") return false
  const { left, right } = fieldsOf<BinaryNode>(node)
  return (isAddressConstant(left) && isArithmeticConstant(right)) || (isArithmeticConstant(left) && isAddressConstant(right))
}

const intType = (bits: Bits, signed: boolean): RuntimeType => typeNode(intTypeClass, { kind: "int-type", bits, signed })

const converted = (left: RuntimeType, right: RuntimeType): RuntimeType => {
  if (left.kind === "pointer-type") return left
  if (right.kind === "pointer-type") return right
  if (left.kind === "double-type" || right.kind === "double-type") return c.double
  if (left.kind !== "int-type" || right.kind !== "int-type") throw new Error("arithmetic needs concrete C types")
  const promote = (type: RuntimeType): IntTypeNode => {
    const node = type as unknown as IntTypeNode
    return node.bits < 32 ? { kind: "int-type", bits: 32, signed: true } : node
  }
  const a = promote(left)
  const b = promote(right)
  return a.bits === b.bits ? intType(a.bits, a.signed && b.signed) : a.bits > b.bits ? intType(a.bits, a.signed) : intType(b.bits, b.signed)
}

export const c = {
  ...structured<C>(),
  ...functionConstruct<C>(),
  ...addConstruct<C>(converted),
  ...lessConstruct<C>(() => intType(32, true)),

  int: <B extends Bits>(bits: B): TypeNode<C, Int<B, true>, IntFacts> => typeNode(intTypeClass, { kind: "int-type", bits, signed: true }),
  uint: <B extends Bits>(bits: B): TypeNode<C, Int<B, false>, IntFacts> => typeNode(intTypeClass, { kind: "int-type", bits, signed: false }),
  double: typeNode<C, Double, { readonly kind: "double-type" }>(doubleTypeClass, { kind: "double-type" }),
  void: typeNode<C, Void, { readonly kind: "void-type" }>(voidTypeClass, { kind: "void-type" }),
  ptr: <T, F extends Facts>(to: TypeNode<C, T, F>): TypeNode<C, Ptr<T>, { readonly kind: "pointer-type" } | F> =>
    typeNode(pointerTypeClass, { kind: "pointer-type", to }),

  literal: <D extends Arith, F extends Facts>(type: TypeNode<C, D, F>, value: number): Expr<C, D, { readonly kind: "literal" } | F> => {
    if (type.kind === "int-type") {
      const node = fieldsOf<IntTypeNode>(type)
      const min = node.signed ? -(2 ** (node.bits - 1)) : 0
      const max = node.signed ? 2 ** (node.bits - 1) - 1 : 2 ** node.bits - 1
      if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new Error(`${intName(node)} cannot hold the literal ${value} exactly`)
      }
    }
    return expr(literalClass, { kind: "literal", value }, type)
  },
  address: <D, F extends Facts>(operand: Expr<C, D, F>): Expr<C, Ptr<D>, { readonly kind: "address" } | F> =>
    expr(unaryClass, { kind: "address", operand }, typeNode(pointerTypeClass, { kind: "pointer-type", to: operand.type })),
  deref: <D, F extends Facts>(operand: Expr<C, Ptr<D>, F>): Expr<C, D, { readonly kind: "deref" } | F> =>
    expr(
      unaryClass,
      { kind: "deref", operand },
      operand.type.kind === "pointer-type"
        ? (operand.type as unknown as PointerTypeNode).to
        : (() => {
          throw new Error("dereference needs a pointer type")
        })(),
    ),

  program: <Y extends Stmt<C, any, any>>(body: () => Generator<Y, void, unknown>): Program<C, KindsOf<Y>> => {
    const program = builder<C>()(body)
    program.root.statements.forEach((statement) => {
      if (statement.kind === "let") {
        const node = fieldsOf<LetNode>(statement)
        if (!isArithmeticConstant(node.init) && !isAddressConstant(node.init)) {
          throw new Error(`the top-level "let" of "${node.binding.nameHint}" needs a constant initializer in C`)
        }
      } else if (statement.kind === "function") {
        walk(fieldsOf<FunctionNode>(statement).body, (node) => {
          if (node.kind === "function") {
            throw new Error(`function "${fieldsOf<FunctionNode>(node).binding.nameHint}" cannot be nested in another function in C`)
          }
        })
      } else {
        throw new Error(`"${statement.kind}" cannot appear at the top level of a C program`)
      }
    })
    return program
  },
}

const KEYWORDS = (
  "auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return "
  + "short signed sizeof static struct switch typedef union unsigned void volatile while _Bool _Complex _Imaginary"
).split(" ")

const STDINT = [
  ..."intptr_t uintptr_t intmax_t uintmax_t INTPTR_MIN INTPTR_MAX UINTPTR_MAX INTMAX_MIN INTMAX_MAX UINTMAX_MAX INTMAX_C UINTMAX_C".split(" "),
  ..."PTRDIFF_MIN PTRDIFF_MAX SIZE_MAX SIG_ATOMIC_MIN SIG_ATOMIC_MAX WCHAR_MIN WCHAR_MAX WINT_MIN WINT_MAX".split(" "),
  ...[8, 16, 32, 64].flatMap((bits) =>
    ["", "_LEAST", "_FAST"].flatMap((width) => {
      const type = width.toLowerCase()
      return [`int${type}${bits}_t`, `uint${type}${bits}_t`, `INT${width}${bits}_MIN`, `INT${width}${bits}_MAX`, `UINT${width}${bits}_MAX`]
    }).concat([`INT${bits}_C`, `UINT${bits}_C`])
  ),
]

const UNARY = 14
const POSTFIX = 15
const MULTIPLY = 13
const ADD = 12
const RELATIONAL = 10

const declaration = (type: TypeNode<C, unknown>, name: string, emit: Parameters<Handler>[1]): string => `${emit.node(type).text} ${name}`

export const cTarget = defineTarget(
  { valid: (name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name), reserved: new Set([...KEYWORDS, ...STDINT]) },
  {
    "int-type": (node: IntTypeNode) => intName(node),
    "double-type": () => "double",
    "void-type": () => "void",
    "pointer-type": (node: PointerTypeNode, emit) => `${emit.node(node.to).text}*`,
    literal: (node: LiteralNode): Fragment => {
      const { value } = node
      if (node.type.kind === "int-type") {
        const type = node.type as unknown as IntTypeNode
        if (type.bits === 32 && type.signed && value === -(2 ** 31)) return frag(POSTFIX, "INT32_MIN")
        const magnitude = type.bits < 32 || (type.bits === 32 && type.signed)
          ? String(Math.abs(value))
          : `${type.signed ? "" : "U"}INT${type.bits}_C(${Math.abs(value)})`
        return value < 0 ? frag(UNARY, `-${magnitude}`) : frag(POSTFIX, magnitude)
      }
      if (Number.isNaN(value)) return frag(MULTIPLY, "0.0 / 0.0")
      if (value === Infinity) return frag(MULTIPLY, "1.0 / 0.0")
      if (value === -Infinity) return frag(MULTIPLY, "-1.0 / 0.0")
      const digits = String(Math.abs(value))
      const magnitude = /[.e]/.test(digits) ? digits : `${digits}.0`
      return value < 0 || Object.is(value, -0) ? frag(UNARY, `-${magnitude}`) : frag(POSTFIX, magnitude)
    },
    ref: (node: RefNode, emit) => emit.name(node.binding),
    address: (node: UnaryNode, emit) => ({ prec: UNARY, text: `&${emit.at(node.operand, UNARY)}` }),
    deref: (node: UnaryNode, emit) => ({ prec: UNARY, text: `*${emit.at(node.operand, UNARY)}` }),
    add: (node: BinaryNode, emit) => ({ prec: ADD, text: `${emit.at(node.left, ADD)} + ${emit.at(node.right, ADD + 1)}` }),
    less: (node: BinaryNode, emit) => ({ prec: RELATIONAL, text: `${emit.at(node.left, RELATIONAL)} < ${emit.at(node.right, RELATIONAL + 1)}` }),
    call: (node: CallNode, emit) => ({
      prec: POSTFIX,
      text: `${emit.at(node.callee, POSTFIX)}(${node.args.map((arg) => emit.node(arg).text).join(", ")})`,
    }),
    let: (node: LetNode, emit) => `${declaration(node.type as TypeNode<C, unknown>, emit.name(node.binding), emit)} = ${emit.node(node.init).text};`,
    assign: (node: AssignNode, emit) => `${emit.node(node.target).text} = ${emit.node(node.value).text};`,
    expression: (node: ExpressionNode, emit) => `${emit.node(node.expr).text};`,
    if: (node: IfNode, emit) => {
      const then = `if (${emit.node(node.condition).text}) ${braces(emit.block(node.then))}`
      return node.else === undefined ? then : `${then} else ${braces(emit.block(node.else))}`
    },
    while: (node: WhileNode, emit) => `while (${emit.node(node.condition).text}) ${braces(emit.block(node.body))}`,
    return: (node: ReturnNode, emit) => `return ${emit.node(node.value).text};`,
    function: (node: FunctionNode, emit) => {
      const params = node.params.map((param) => declaration(param.type as TypeNode<C, unknown>, emit.name(param.binding), emit))
      return `${emit.node(node.returns).text} ${emit.name(node.binding)}(${params.length === 0 ? "void" : params.join(", ")}) ${
        braces(emit.block(node.body))
      }`
    },
  },
)

export const emitC = <Kinds extends keyof typeof cTarget.handlers>(program: Program<C, Kinds>): string =>
  `#include <stdint.h>\n\n${emit(program as Program<C, keyof typeof cTarget.handlers>, cTarget)}\n`
