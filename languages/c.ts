import {
  addConstruct,
  type AnyNode,
  braces,
  builder,
  type Check,
  children,
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
  isLvalue,
  type KindsOf,
  lessConstruct,
  type Lvalue,
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

declare const CType: unique symbol

export type Char = string & { readonly [CType]: "char" }

export type Bits = 8 | 16 | 32 | 64

export type I8 = number & { readonly [CType]: "i8" }
export type I16 = number & { readonly [CType]: "i16" }
export type I32 = number & { readonly [CType]: "i32" }
export type I64 = bigint & { readonly [CType]: "i64" }
export type U8 = number & { readonly [CType]: "u8" }
export type U16 = number & { readonly [CType]: "u16" }
export type U32 = number & { readonly [CType]: "u32" }
export type U64 = bigint & { readonly [CType]: "u64" }
export type F64 = number & { readonly [CType]: "f64" }
export type Ptr<T> = { readonly [CType]: "pointer"; readonly to: T }
export type Tuple<T, N extends number, A extends readonly T[] = readonly []> =
    number extends N ? never
  : N extends N ?
      `${N}` extends "0" | `-${string}` ? never
    : `${N}` extends `${bigint}` ?
        A["length"] extends N ? A
      : Tuple<T, N, readonly [...A, T]>
    : never
  : never

export type Void = { readonly [CType]: "void" }

export interface CAssign extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer A, infer B] ? Equal<A, B> : false
}

export interface CTruthy extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer T] ? ([T] extends [boolean] ? true : false) : false
}

export interface CSum extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer A, infer B]
    ? [A, B] extends [Ptr<unknown>, I8 | I16 | I32 | I64 | U8 | U16 | U32 | U64] ? A
    : [A, B] extends [I8 | I16 | I32 | I64 | U8 | U16 | U32 | U64, Ptr<unknown>] ? B
    : [A] extends [I8 | I16 | I32 | I64 | U8 | U16 | U32 | U64 | F64] ? Equal<A, B> extends true ? A : never
    : never
    : never
}

export interface CCompare extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer A, infer B]
    ? [A] extends [I8 | I16 | I32 | I64 | U8 | U16 | U32 | U64 | F64] ? Equal<A, B> extends true ? boolean : never : never
    : never
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
export interface ArrayTypeNode {
  readonly kind: "array-type"
  readonly element: TypeNode<C, unknown>
  readonly length: number
}
export interface LiteralNode {
  readonly kind: "literal"
  readonly value: number | bigint | boolean | string | ReadonlyArray<Expr<C, unknown>>
  readonly type: TypeNode<C, unknown>
}
export interface UnaryNode {
  readonly kind: "address" | "deref"
  readonly operand: Expr<C, unknown>
  readonly lvalue?: true
}
export interface CastNode {
  readonly kind: "cast"
  readonly operand: Expr<C, unknown>
  readonly type: TypeNode<C, unknown>
}
export interface TernaryNode {
  readonly kind: "ternary"
  readonly condition: Expr<C, boolean>
  readonly then: Expr<C, unknown>
  readonly otherwise: Expr<C, unknown>
}

const intTypeClass = typeClass<IntTypeNode>()
const doubleTypeClass = typeClass()
const boolTypeClass = typeClass()
const charTypeClass = typeClass()
const voidTypeClass = typeClass()
const pointerTypeClass = typeClass<PointerTypeNode>({ children: (node) => [node.to] })
const arrayTypeClass = typeClass<ArrayTypeNode>({ children: (node) => [node.element] })
const literalClass = exprClass<LiteralNode>({ children: (node) => Array.isArray(node.value) ? node.value : [] })
const unaryClass = exprClass<UnaryNode>({ children: (node) => [node.operand] })
const castClass = exprClass<CastNode>({ children: (node) => [node.operand] })
const ternaryClass = exprClass<TernaryNode>({ children: (node) => [node.condition, node.then, node.otherwise] })

type IntFacts = { readonly kind: "int-type" }

const intName = (node: IntTypeNode): string => `${node.signed ? "" : "u"}int${node.bits}_t`

const fieldsOf = <N>(node: AnyNode): N => node as unknown as N

const isArithmeticConstant = (node: AnyNode): boolean =>
  node.kind === "literal"
  || (node.kind === "cast" && isArithmeticConstant(fieldsOf<CastNode>(node).operand))
  || ((node.kind === "add" || node.kind === "less") && isArithmeticConstant(fieldsOf<BinaryNode>(node).left)
    && isArithmeticConstant(fieldsOf<BinaryNode>(node).right))
  || (node.kind === "ternary" && [fieldsOf<TernaryNode>(node).condition, fieldsOf<TernaryNode>(node).then, fieldsOf<TernaryNode>(node).otherwise]
    .every(isArithmeticConstant))

const isAddressConstant = (node: AnyNode): boolean => {
  if (node.kind === "address") return fieldsOf<UnaryNode>(node).operand.kind === "ref"
  if (node.kind !== "add") return false
  const { left, right } = fieldsOf<BinaryNode>(node)
  return (isAddressConstant(left) && isArithmeticConstant(right)) || (isArithmeticConstant(left) && isAddressConstant(right))
}

export const c = {
  ...structured<C>(),
  ...functionConstruct<C>(),
  ...addConstruct<C>((left, right) => left.kind === "pointer-type" ? left : right.kind === "pointer-type" ? right : left),
  ...lessConstruct<C>((): RuntimeType => c.bool),

  i8: typeNode<C, I8, IntFacts>(intTypeClass, { kind: "int-type", bits: 8, signed: true }),
  i16: typeNode<C, I16, IntFacts>(intTypeClass, { kind: "int-type", bits: 16, signed: true }),
  i32: typeNode<C, I32, IntFacts>(intTypeClass, { kind: "int-type", bits: 32, signed: true }),
  i64: typeNode<C, I64, IntFacts>(intTypeClass, { kind: "int-type", bits: 64, signed: true }),
  u8: typeNode<C, U8, IntFacts>(intTypeClass, { kind: "int-type", bits: 8, signed: false }),
  u16: typeNode<C, U16, IntFacts>(intTypeClass, { kind: "int-type", bits: 16, signed: false }),
  u32: typeNode<C, U32, IntFacts>(intTypeClass, { kind: "int-type", bits: 32, signed: false }),
  u64: typeNode<C, U64, IntFacts>(intTypeClass, { kind: "int-type", bits: 64, signed: false }),
  f64: typeNode<C, F64, { readonly kind: "double-type" }>(doubleTypeClass, { kind: "double-type" }),
  char: typeNode<C, Char, { readonly kind: "char-type" }>(charTypeClass, { kind: "char-type" }),
  bool: typeNode<C, boolean, { readonly kind: "bool-type" }>(boolTypeClass, { kind: "bool-type" }),
  void: typeNode<C, Void, { readonly kind: "void-type" }>(voidTypeClass, { kind: "void-type" }),
  array: <T extends I8 | I16 | I32 | I64 | U8 | U16 | U32 | U64 | F64 | Char, F extends Facts, const N extends number>(
    element: TypeNode<C, T, F>,
    length: N & (number extends N ? never : unknown),
  ): TypeNode<C, Tuple<T, N>, { readonly kind: "array-type" } | F> => {
    if (!["int-type", "double-type", "char-type"].includes(element.kind)) throw new Error("array elements must be numeric or char")
    if (!Number.isSafeInteger(length) || length <= 0) throw new Error("array length must be a positive safe integer")
    return typeNode(arrayTypeClass, { kind: "array-type", element, length })
  },
  ptr: <T, F extends Facts>(
    to: TypeNode<C, T, F> & (T extends readonly unknown[] ? never : unknown),
  ): TypeNode<C, Ptr<T>, { readonly kind: "pointer-type" } | F> => {
    if (to.kind === "array-type") throw new Error("pointer to array is not supported")
    return typeNode(pointerTypeClass, { kind: "pointer-type", to })
  },

  literal: <
    D extends I8 | I16 | I32 | I64 | U8 | U16 | U32 | U64 | F64 | Char | readonly (I8 | I16 | I32 | I64 | U8 | U16 | U32 | U64 | F64 | Char)[],
    F extends Facts,
  >(
    type: TypeNode<C, D, F>,
    value: D extends readonly unknown[]
      ? { readonly [K in keyof D]: D[K] extends infer T ? T extends Char ? string : T extends I64 | U64 ? bigint : number : never }
      : D extends Char ? string
      : D extends I64 | U64 ? bigint
      : number,
  ): Expr<C, D, { readonly kind: "literal" } | F> => {
    if (type.kind === "array-type") {
      const node = fieldsOf<ArrayTypeNode>(type)
      if (!Array.isArray(value) || value.length !== node.length) throw new Error("array literal needs exactly the declared length")
      const values = Array.from(value, (item) => c.literal(node.element as TypeNode<C, I32>, item as number))
      return expr(literalClass, { kind: "literal", value: Object.freeze(values) }, type)
    }
    if (type.kind === "char-type" && (typeof value !== "string" || value.length !== 1 || value.charCodeAt(0) > 127)) {
      throw new Error(`char cannot hold the literal ${JSON.stringify(value)}`)
    }
    if (type.kind === "double-type" && typeof value !== "number") {
      throw new Error(`double cannot hold the literal ${value}`)
    }
    if (type.kind === "int-type") {
      const node = fieldsOf<IntTypeNode>(type)
      if (node.bits === 64) {
        const min = node.signed ? -(1n << 63n) : 0n
        const max = node.signed ? (1n << 63n) - 1n : (1n << 64n) - 1n
        if (typeof value !== "bigint" || value < min || value > max) {
          throw new Error(`${intName(node)} cannot hold the literal ${value} exactly`)
        }
      } else {
        const min = node.signed ? -(2 ** (node.bits - 1)) : 0
        const max = 2 ** (node.bits - (node.signed ? 1 : 0)) - 1
        if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
          throw new Error(`${intName(node)} cannot hold the literal ${value} exactly`)
        }
      }
    }
    return expr(literalClass, { kind: "literal", value }, type)
  },
  true: expr<C, boolean, { readonly kind: "literal" | "bool-type" }>(
    literalClass,
    { kind: "literal", value: true },
    typeNode(boolTypeClass, { kind: "bool-type" }),
  ),
  false: expr<C, boolean, { readonly kind: "literal" | "bool-type" }>(
    literalClass,
    { kind: "literal", value: false },
    typeNode(boolTypeClass, { kind: "bool-type" }),
  ),
  ternary: <FC extends Facts, A, FA extends Facts, B, FB extends Facts>(
    condition: Expr<C, boolean, FC>,
    then: Expr<C, A, FA>,
    otherwise: Expr<C, B, FB> & Check<Equal<A, B>, "branches have different types", { then: A; otherwise: B }>,
  ): Expr<C, A, { readonly kind: "ternary" } | FC | FA | FB> => expr(ternaryClass, { kind: "ternary", condition, then, otherwise }, then.type),
  cast: <
    D extends I8 | I16 | I32 | I64 | U8 | U16 | U32 | U64 | F64,
    FT extends Facts,
    A extends I8 | I16 | I32 | I64 | U8 | U16 | U32 | U64 | F64,
    FA extends Facts,
  >(
    type: TypeNode<C, D, FT>,
    operand: Expr<C, A, FA>,
  ): Expr<C, D, { readonly kind: "cast" } | FT | FA> => expr(castClass, { kind: "cast", operand }, type),
  address: <D, F extends Facts>(operand: Lvalue<C, D, F>): Expr<C, Ptr<D>, { readonly kind: "address" } | F> => {
    if (!isLvalue(operand)) throw new Error("only an lvalue has an address")
    return expr(unaryClass, { kind: "address", operand }, typeNode(pointerTypeClass, { kind: "pointer-type", to: operand.type }))
  },
  deref: <D, F extends Facts>(operand: Expr<C, Ptr<D>, F>): Lvalue<C, D, { readonly kind: "deref" } | F> =>
    expr<C, D, { readonly kind: "deref" } | F>(
      unaryClass,
      { kind: "deref", operand, lvalue: true },
      operand.type.kind === "pointer-type"
        ? (operand.type as unknown as PointerTypeNode).to
        : (() => {
          throw new Error("dereference needs a pointer type")
        })(),
    ) as Lvalue<C, D, { readonly kind: "deref" } | F>,

  program: <Y extends Stmt<C, any, any>>(body: () => Generator<Y, void, unknown>): Program<C, KindsOf<Y>> => {
    const program = builder<C>()(body)
    walk(program.root, (parent) => {
      if (parent.kind === "function") {
        const node = fieldsOf<FunctionNode>(parent)
        if (node.returns.kind === "array-type" || node.params.some((param) => param.type.kind === "array-type")) {
          throw new Error("array function parameters and results are not supported")
        }
      }
      if (parent.kind === "let") {
        const node = fieldsOf<LetNode>(parent)
        if (node.type.kind === "array-type" && (node.init.kind !== "literal" || fieldsOf<Expr<C, unknown>>(node.init).type.kind !== "array-type")) {
          throw new Error("array binding needs a direct array literal initializer")
        }
      }
      children(parent).forEach((child) => {
        if (child.role !== "expr" || fieldsOf<Expr<C, unknown>>(child).type.kind !== "array-type") return
        if (parent.kind === "let" && fieldsOf<LetNode>(parent).init === child && child.kind === "literal") return
        throw new Error("whole array use is not supported")
      })
    })
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
  + "short signed sizeof static struct switch typedef union unsigned void volatile while _Bool _Complex _Imaginary "
  + "bool true false _Alignas _Alignof _Atomic _Generic _Noreturn _Static_assert _Thread_local"
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
const CONDITIONAL = 3

const CHAR_ESCAPES = new Map([["'", "\\'"], ["\\", "\\\\"], ["\n", "\\n"], ["\t", "\\t"], ["\r", "\\r"]])

const charSpelling = (value: string): string => {
  const code = value.charCodeAt(0)
  return CHAR_ESCAPES.get(value) ?? (code < 32 || code === 127 ? `\\${code.toString(8).padStart(3, "0")}` : value)
}

const declaration = (type: TypeNode<C, unknown>, name: string, emit: Parameters<Handler>[1]): string => {
  if (type.kind === "array-type") {
    const node = fieldsOf<ArrayTypeNode>(type)
    return `${emit.node(node.element).text} ${name}[${node.length}]`
  }
  return `${emit.node(type).text} ${name}`
}

export const cTarget = defineTarget(
  {
    valid: (name) => /^[A-Za-z_]/.test(name) && !/[^A-Za-z0-9_]/.test(name),
    reserved: new Set([...KEYWORDS, ...STDINT]),
    spell: (name) => name.startsWith("_") ? `binding${name}` : name,
  },
  {
    "int-type": (node: IntTypeNode) => intName(node),
    "double-type": () => "double",
    "bool-type": () => "bool",
    "char-type": () => "char",
    "void-type": () => "void",
    "array-type": (node: ArrayTypeNode, emit) => emit.node(node.element).text,
    "pointer-type": (node: PointerTypeNode, emit) => `${emit.node(node.to).text}*`,
    literal: (node: LiteralNode, emit): Fragment => {
      const { value } = node
      if (Array.isArray(value)) return frag(POSTFIX, `{${value.map((item) => emit.node(item).text).join(", ")}}`)
      if (typeof value === "boolean") return frag(POSTFIX, String(value))
      if (typeof value === "string") return frag(POSTFIX, `'${charSpelling(value)}'`)
      if (typeof value !== "number" && typeof value !== "bigint") throw new Error("numeric literal needs a number")
      if (node.type.kind === "int-type") {
        const type = node.type as unknown as IntTypeNode
        if (typeof value === "bigint") {
          if (value === -(1n << 63n)) return frag(POSTFIX, "INT64_MIN")
          const magnitude = `${type.signed ? "" : "U"}INT64_C(${value < 0n ? -value : value})`
          return value < 0n ? frag(UNARY, `-${magnitude}`) : frag(POSTFIX, magnitude)
        }
        if (type.bits === 32 && type.signed && value === -(2 ** 31)) return frag(POSTFIX, "INT32_MIN")
        const magnitude = type.bits < 32 || (type.bits === 32 && type.signed)
          ? String(Math.abs(value))
          : `${type.signed ? "" : "U"}INT${type.bits}_C(${Math.abs(value)})`
        return value < 0 ? frag(UNARY, `-${magnitude}`) : frag(POSTFIX, magnitude)
      }
      if (typeof value !== "number") throw new Error("numeric literal needs a number")
      if (Number.isNaN(value)) return frag(MULTIPLY, "0.0 / 0.0")
      if (value === Infinity) return frag(MULTIPLY, "1.0 / 0.0")
      if (value === -Infinity) return frag(MULTIPLY, "-1.0 / 0.0")
      const digits = String(Math.abs(value))
      const magnitude = /[.e]/.test(digits) ? digits : `${digits}.0`
      return value < 0 || Object.is(value, -0) ? frag(UNARY, `-${magnitude}`) : frag(POSTFIX, magnitude)
    },
    ref: (node: RefNode, emit) => emit.name(node.binding),
    cast: (node: CastNode, emit) => ({ prec: UNARY, text: `(${emit.node(node.type).text})${emit.at(node.operand, UNARY)}` }),
    address: (node: UnaryNode, emit) => ({ prec: UNARY, text: `&${emit.at(node.operand, UNARY)}` }),
    deref: (node: UnaryNode, emit) => ({ prec: UNARY, text: `*${emit.at(node.operand, UNARY)}` }),
    add: (node: BinaryNode, emit) => {
      const left = fieldsOf<Expr<C, unknown>>(node.left).type
      const right = fieldsOf<Expr<C, unknown>>(node.right).type
      const text = `${emit.at(node.left, ADD)} + ${emit.at(node.right, ADD + 1)}`
      if (left.kind === "int-type" && right.kind === "int-type") {
        const type = fieldsOf<IntTypeNode>(left)
        if (type.bits < 32) return frag(UNARY, `(${intName(type)})(${text})`)
      }
      return frag(ADD, text)
    },
    less: (node: BinaryNode, emit) => ({ prec: RELATIONAL, text: `${emit.at(node.left, RELATIONAL)} < ${emit.at(node.right, RELATIONAL + 1)}` }),
    ternary: (node: TernaryNode, emit) => ({
      prec: CONDITIONAL,
      text: `${emit.at(node.condition, CONDITIONAL + 1)} ? ${emit.node(node.then).text} : ${emit.at(node.otherwise, CONDITIONAL)}`,
    }),
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
  `#include <stdbool.h>\n#include <stdint.h>\n\n${emit(program as Program<C, keyof typeof cTarget.handlers>, cTarget)}\n`
