import {
  addConstruct,
  type AnyNode,
  type Binding,
  binding,
  type BindingId,
  type Block,
  type Body,
  braces,
  builder,
  type Check,
  children,
  defineTarget,
  drain,
  emit,
  type Equal,
  type Expr,
  expr,
  exprClass,
  type Facts,
  type FactsOf,
  frag,
  type Fragment,
  functionConstruct,
  type Handler,
  isLvalue,
  type KindsOf,
  lessConstruct,
  type Lvalue,
  type Program,
  type Ref,
  ref,
  scope,
  type Signature,
  type Stmt,
  stmt,
  stmtClass,
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
type Int = I8 | I16 | I32 | I64 | U8 | U16 | U32 | U64
type Numeric = Int | F64
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
export type Allocator = { readonly [CType]: "allocator" }

interface CAssign extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer A, infer B]
    ? Equal<A, B> extends true ? true : [B] extends [Ptr<unknown> | null] ? Equal<A | null, B> : false
    : false
}

interface CTruthy extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer T] ? ([T] extends [boolean] ? true : false) : false
}

interface CSum extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer A, infer B] ? [A] extends [Numeric] ? Equal<A, B> extends true ? A : never : never : never
}

interface CCompare extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer A, infer B] ? [A] extends [Numeric] ? Equal<A, B> extends true ? boolean : never : never : never
}

export interface C {
  readonly name: "c"
  readonly Assign: CAssign
  readonly Truthy: CTruthy
  readonly Sum: CSum
  readonly Compare: CCompare
}

interface IntTypeNode {
  readonly kind: "int-type"
  readonly bits: Bits
  readonly signed: boolean
}
interface PointerTypeNode {
  readonly kind: "pointer-type"
  readonly to: TypeNode<C, unknown>
}
interface NullableTypeNode {
  readonly kind: "nullable-type"
  readonly to: TypeNode<C, unknown>
}
interface ArrayTypeNode {
  readonly kind: "array-type"
  readonly element: TypeNode<C, unknown>
  readonly length: number
}
interface LiteralNode {
  readonly kind: "literal"
  readonly value: number | bigint | boolean | string | null | ReadonlyArray<Expr<C, unknown>>
  readonly type: TypeNode<C, unknown>
}
interface UnaryNode {
  readonly kind: "address" | "deref"
  readonly operand: Expr<C, unknown>
  readonly lvalue?: true
}
interface IndexNode {
  readonly kind: "index"
  readonly array: Expr<C, unknown>
  readonly at: Expr<C, unknown>
  readonly lvalue: true
}
interface CastNode {
  readonly kind: "cast"
  readonly operand: Expr<C, unknown>
  readonly type: TypeNode<C, unknown>
}
interface BindNode {
  readonly kind: "bind"
  readonly value: Expr<C, unknown>
  readonly binding: Binding
  readonly type: TypeNode<C, unknown>
  readonly body: Block | undefined
}
interface MaybeNode {
  readonly kind: "maybe"
  readonly body: Block
}
interface ArenaNode {
  readonly kind: "arena"
  readonly binding: Binding
  readonly backing: Binding
  readonly size: number
  readonly body: Block
}
interface ArenaFreeNode {
  readonly kind: "arena-free"
  readonly allocator: Binding
}
interface NewNode {
  readonly kind: "new"
  readonly allocator: Expr<C, Allocator>
  readonly value: Expr<C, unknown>
}
interface DeferNode {
  readonly kind: "defer"
  readonly body: Block
  readonly result: Binding
}
interface TernaryNode {
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
const allocatorTypeClass = typeClass()
const pointerTypeClass = typeClass<PointerTypeNode>({ children: (node) => [node.to] })
const nullableTypeClass = typeClass<NullableTypeNode>({ children: (node) => [node.to] })
const arrayTypeClass = typeClass<ArrayTypeNode>({ children: (node) => [node.element] })
const literalClass = exprClass<LiteralNode>({ children: (node) => Array.isArray(node.value) ? node.value : [] })
const unaryClass = exprClass<UnaryNode>({ children: (node) => [node.operand] })
const indexClass = exprClass<IndexNode>({ children: (node) => [node.array, node.at] })
const castClass = exprClass<CastNode>({ children: (node) => [node.operand] })
const bindClass = stmtClass<BindNode>({
  children: (node) => [node.value, node.type, ...(node.body === undefined ? [] : [node.body])],
  declares: (node) => node.body === undefined ? [node.binding] : [],
})
const maybeClass = stmtClass<MaybeNode>({ children: (node) => [node.body] })
const deferClass = stmtClass<DeferNode>({ children: (node) => [node.body], declares: (node) => [node.result] })
const arenaClass = stmtClass<ArenaNode>({ children: (node) => [node.body] })
const arenaFreeClass = stmtClass<ArenaFreeNode>({ references: (node) => [node.allocator] })
const newClass = exprClass<NewNode>({ children: (node) => [node.allocator, node.value] })
const ternaryClass = exprClass<TernaryNode>({ children: (node) => [node.condition, node.then, node.otherwise] })

const intName = (node: IntTypeNode): string => `${node.signed ? "" : "u"}int${node.bits}_t`

const fieldsOf = <N>(node: AnyNode): N => node as unknown as N

const intType = <D>(bits: Bits, signed: boolean): TypeNode<C, D, { readonly kind: "int-type" }> =>
  typeNode(intTypeClass, { kind: "int-type", bits, signed })

const boolType = typeNode<C, boolean, { readonly kind: "bool-type" }>(boolTypeClass, { kind: "bool-type" })

const nested = (statements: ReadonlyArray<AnyNode>, binds: ReadonlyArray<Binding>): Block => {
  const at = statements.findIndex((statement) => statement.kind === "bind")
  const found = statements[at]
  if (found === undefined) return scope(binds, statements)
  const node = fieldsOf<BindNode>(found)
  const inner = stmt(bindClass, {
    kind: "bind",
    value: node.value,
    binding: node.binding,
    type: node.type,
    body: nested(statements.slice(at + 1), [node.binding]),
  })
  return scope(binds, [...statements.slice(0, at), inner])
}

const isArithmeticConstant = (node: AnyNode): boolean =>
  node.kind === "literal"
  || (node.kind === "cast" && isArithmeticConstant(fieldsOf<CastNode>(node).operand))
  || ((node.kind === "add" || node.kind === "less") && isArithmeticConstant(fieldsOf<BinaryNode>(node).left)
    && isArithmeticConstant(fieldsOf<BinaryNode>(node).right))
  || (node.kind === "ternary" && [fieldsOf<TernaryNode>(node).condition, fieldsOf<TernaryNode>(node).then, fieldsOf<TernaryNode>(node).otherwise]
    .every(isArithmeticConstant))

const isAddressConstant = (node: AnyNode): boolean => node.kind === "address" && fieldsOf<UnaryNode>(node).operand.kind === "ref"

interface Source {
  readonly binding: Binding
  readonly arena: boolean
}

// Origins are the arenas and allocator parameters a pointer may come from.
// They are tracked per function, flow-insensitively, and only through pointer and allocator expressions.
const checkEscapes = (fn: FunctionNode): void => {
  const sources = new Map<BindingId, Source>()
  const inside = new Map<BindingId, ReadonlySet<BindingId>>()
  const flows: Array<readonly [Binding, AnyNode]> = []
  const stores: AnyNode[] = []
  const returns: AnyNode[] = []
  fn.params.forEach((param) => {
    inside.set(param.binding.id, new Set())
    if (param.type.kind === "allocator-type") sources.set(param.binding.id, { binding: param.binding, arena: false })
  })
  const visit = (node: AnyNode, arenas: ReadonlySet<BindingId>): void => {
    if (node.kind === "arena") {
      const arena = fieldsOf<ArenaNode>(node)
      sources.set(arena.binding.id, { binding: arena.binding, arena: true })
      return visit(arena.body, new Set([...arenas, arena.binding.id]))
    }
    if (node.kind === "let" || node.kind === "bind") {
      const declared = node.kind === "let"
        ? fieldsOf<LetNode>(node)
        : { binding: fieldsOf<BindNode>(node).binding, init: fieldsOf<BindNode>(node).value }
      inside.set(declared.binding.id, arenas)
      flows.push([declared.binding, declared.init])
    }
    if (node.kind === "assign") {
      const assigned = fieldsOf<AssignNode>(node)
      if (assigned.target.kind === "ref") flows.push([fieldsOf<RefNode>(assigned.target).binding, assigned.value])
      else stores.push(assigned.value)
    }
    if (node.kind === "return") returns.push(fieldsOf<ReturnNode>(node).value)
    children(node).forEach((child) => visit(child, arenas))
  }
  visit(fn.body, new Set())
  const held = new Map<BindingId, ReadonlySet<Source>>()
  const origins = (node: AnyNode): ReadonlySet<Source> => {
    if (node.role !== "expr" || !["pointer-type", "nullable-type", "allocator-type"].includes(fieldsOf<Expr<C, unknown>>(node).type.kind)) {
      return new Set()
    }
    if (node.kind === "ref") {
      const { id } = fieldsOf<RefNode>(node).binding
      const found = sources.get(id)
      return found === undefined ? held.get(id) ?? new Set() : new Set([found])
    }
    return new Set(children(node).flatMap((child) => [...origins(child)]))
  }
  for (let changed = true; changed;) {
    changed = false
    flows.forEach(([target, value]) => {
      const before = held.get(target.id) ?? new Set()
      const after = new Set([...before, ...origins(value)])
      if (after.size !== before.size) {
        held.set(target.id, after)
        changed = true
      }
    })
  }
  flows.forEach(([target, value]) =>
    origins(value).forEach(({ binding, arena }) => {
      if (arena && inside.get(target.id)?.has(binding.id) !== true) throw new Error(`a pointer from arena "${binding.nameHint}" cannot outlive it`)
      if (!arena && !inside.has(target.id)) {
        throw new Error(`a pointer from allocator "${binding.nameHint}" can only be returned or kept in a local binding`)
      }
    })
  )
  stores.forEach((value) =>
    origins(value).forEach(({ binding, arena }) => {
      throw new Error(`a pointer from ${arena ? "arena" : "allocator"} "${binding.nameHint}" cannot be stored through a pointer`)
    })
  )
  returns.forEach((value) =>
    origins(value).forEach(({ binding, arena }) => {
      if (arena) throw new Error(`a pointer from arena "${binding.nameHint}" cannot outlive it`)
    })
  )
}

export const c = {
  ...structured<C>(),
  ...functionConstruct<C>(),
  ...addConstruct<C>((left) => left),
  ...lessConstruct<C>(() => boolType),

  i8: intType<I8>(8, true),
  i16: intType<I16>(16, true),
  i32: intType<I32>(32, true),
  i64: intType<I64>(64, true),
  u8: intType<U8>(8, false),
  u16: intType<U16>(16, false),
  u32: intType<U32>(32, false),
  u64: intType<U64>(64, false),
  f64: typeNode<C, F64, { readonly kind: "double-type" }>(doubleTypeClass, { kind: "double-type" }),
  char: typeNode<C, Char, { readonly kind: "char-type" }>(charTypeClass, { kind: "char-type" }),
  bool: boolType,
  void: typeNode<C, Void, { readonly kind: "void-type" }>(voidTypeClass, { kind: "void-type" }),
  allocator: typeNode<C, Allocator, { readonly kind: "allocator-type" }>(allocatorTypeClass, { kind: "allocator-type" }),
  array: <T extends Numeric | Char, F extends Facts, const N extends number>(
    element: TypeNode<C, T, F>,
    length: N & (number extends N ? never : unknown),
  ): TypeNode<C, Tuple<T, N>, { readonly kind: "array-type" } | F> => {
    if (!["int-type", "double-type", "char-type"].includes(element.kind)) throw new Error("array elements must be numeric or char")
    if (!Number.isSafeInteger(length) || length <= 0) throw new Error("array length must be a positive safe integer")
    return typeNode(arrayTypeClass, { kind: "array-type", element, length })
  },
  ptr: <T, F extends Facts>(
    to: TypeNode<C, T, F> & (T extends readonly unknown[] ? never : [T] extends [Allocator] ? never : unknown),
  ): TypeNode<C, Ptr<T>, { readonly kind: "pointer-type" } | F> => {
    if (to.kind === "array-type") throw new Error("pointer to array is not supported")
    if (to.kind === "allocator-type") throw new Error("an allocator can only be passed as an argument")
    return typeNode(pointerTypeClass, { kind: "pointer-type", to })
  },
  nullable: <T extends Ptr<unknown>, F extends Facts>(
    to: TypeNode<C, T, F>,
  ): TypeNode<C, T | null, { readonly kind: "nullable-type" } | F> => {
    if (to.kind !== "pointer-type") throw new Error("only a pointer can be nullable")
    return typeNode(nullableTypeClass, { kind: "nullable-type", to })
  },

  literal: <
    D extends Numeric | Char | readonly (Numeric | Char)[],
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
  null: <T extends Ptr<unknown>, F extends Facts>(
    type: TypeNode<C, T | null, F>,
  ): Expr<C, T | null, { readonly kind: "literal" } | F> => expr(literalClass, { kind: "literal", value: null }, type),
  true: expr<C, boolean, { readonly kind: "literal" | "bool-type" }>(literalClass, { kind: "literal", value: true }, boolType),
  false: expr<C, boolean, { readonly kind: "literal" | "bool-type" }>(literalClass, { kind: "literal", value: false }, boolType),
  ternary: <FC extends Facts, A, FA extends Facts, B, FB extends Facts>(
    condition: Expr<C, boolean, FC>,
    then: Expr<C, A, FA>,
    otherwise: Expr<C, B, FB> & Check<Equal<A, B>, "branches have different types", { then: A; otherwise: B }>,
  ): Expr<C, A, { readonly kind: "ternary" } | FC | FA | FB> => expr(ternaryClass, { kind: "ternary", condition, then, otherwise }, then.type),
  cast: <D extends Numeric, FT extends Facts, A extends Numeric, FA extends Facts>(
    type: TypeNode<C, D, FT>,
    operand: Expr<C, A, FA>,
  ): Expr<C, D, { readonly kind: "cast" } | FT | FA> => expr(castClass, { kind: "cast", operand }, type),
  index: <D extends readonly (Numeric | Char)[], FA extends Facts, FI extends Facts>(
    array: Expr<C, D, FA>,
    at: Expr<C, Int, FI>,
  ): Lvalue<C, D[number], { readonly kind: "index" } | FA | FI> => {
    if (array.type.kind !== "array-type") throw new Error("index needs an array type")
    if (at.type.kind !== "int-type") throw new Error("index needs an integer type")
    const type = fieldsOf<ArrayTypeNode>(array.type)
    if (at.kind === "literal") {
      const value = fieldsOf<LiteralNode>(at).value
      if ((typeof value === "number" || typeof value === "bigint") && (value < 0 || value >= type.length)) {
        throw new Error("array index is out of bounds")
      }
    }
    return expr<C, D[number], { readonly kind: "index" } | FA | FI>(
      indexClass,
      { kind: "index", array, at, lvalue: true },
      type.element,
    ) as Lvalue<C, D[number], { readonly kind: "index" } | FA | FI>
  },
  address: <D, F extends Facts>(operand: Lvalue<C, D, F>): Expr<C, Ptr<D>, { readonly kind: "address" } | F> => {
    if (!isLvalue(operand)) throw new Error("only an lvalue has an address")
    return expr(unaryClass, { kind: "address", operand }, typeNode(pointerTypeClass, { kind: "pointer-type", to: operand.type }))
  },
  deref: <D, F extends Facts>(
    operand: Expr<C, Ptr<D>, F> & ([D] extends [Void] ? never : unknown),
  ): Lvalue<C, D, { readonly kind: "deref" } | F> => {
    if (operand.type.kind !== "pointer-type") throw new Error("dereference needs a pointer type")
    const to = fieldsOf<PointerTypeNode>(operand.type).to
    if (to.kind === "void-type") throw new Error("a void pointer cannot be dereferenced")
    return expr<C, D, { readonly kind: "deref" } | F>(unaryClass, { kind: "deref", operand, lvalue: true }, to) as Lvalue<
      C,
      D,
      { readonly kind: "deref" } | F
    >
  },
  bind: <D, F extends Facts>(
    nameHint: string,
    value: Expr<C, D, F> & ([D] extends [Ptr<unknown> | null] ? (null extends D ? unknown : never) : never),
  ): Stmt<C, { readonly kind: "bind" | "ref" } | F, Ref<C, NonNullable<D>>> => {
    if (value.type.kind !== "nullable-type") throw new Error("bind needs a nullable pointer")
    const declared = binding(nameHint)
    const type = fieldsOf<NullableTypeNode>(value.type).to
    return stmt(bindClass, { kind: "bind", value, binding: declared, type, body: undefined }, ref<C, NonNullable<D>>(declared, type))
  },
  maybe: <Y extends Stmt<C, any, any>>(body: Body<C, Y>): Stmt<C, { readonly kind: "maybe" } | FactsOf<Y>> =>
    stmt(maybeClass, { kind: "maybe", body: nested(drain(body).block.statements, []) }),
  defer: <Y extends Stmt<C, any, any>>(body: Body<C, Y>): Stmt<C, { readonly kind: "defer" } | FactsOf<Y>> =>
    stmt(deferClass, { kind: "defer", body: drain(body).block, result: binding("result") }),
  arena: <Y extends Stmt<C, any, any>>(
    nameHint: string,
    size: number,
    body: (allocator: Ref<C, Allocator>) => Generator<Y, void, unknown>,
  ): Stmt<C, { readonly kind: "arena" | "arena-free" | "defer" | "ref" } | FactsOf<Y>> => {
    if (!Number.isSafeInteger(size) || size <= 0) throw new Error("arena size must be a positive safe integer")
    const declared = binding(nameHint)
    const backing = binding(`${nameHint}_arena`)
    const free = scope([], [stmt(arenaFreeClass, { kind: "arena-free", allocator: declared })])
    const block = drain(() => body(ref(declared, c.allocator)), [declared, backing]).block
    const release = stmt(deferClass, { kind: "defer", body: free, result: binding("result") })
    return stmt(arenaClass, { kind: "arena", binding: declared, backing, size, body: scope(block.binds, [release, ...block.statements]) })
  },
  new: <D, FA extends Facts, FV extends Facts>(
    allocator: Expr<C, Allocator, FA>,
    value: Expr<C, D, FV> & ([D] extends [readonly unknown[] | Void | Allocator | Signature<any, any>] ? never : unknown),
  ): Expr<C, Ptr<D> | null, { readonly kind: "new" } | FA | FV> => {
    if (allocator.type.kind !== "allocator-type") throw new Error("new needs an allocator")
    if (value.type.role !== "type" || ["array-type", "void-type", "allocator-type"].includes(value.type.kind)) {
      throw new Error("new needs a scalar or pointer value")
    }
    const type = typeNode(nullableTypeClass, { kind: "nullable-type", to: typeNode(pointerTypeClass, { kind: "pointer-type", to: value.type }) })
    return expr(newClass, { kind: "new", allocator, value }, type)
  },

  program: <Y extends Stmt<C, any, any>>(body: () => Generator<Y, void, unknown>): Program<C, KindsOf<Y>> => {
    const program = builder<C>()(body)
    walk(program.root, (parent) => {
      if (parent.kind === "function") {
        const node = fieldsOf<FunctionNode>(parent)
        if (node.returns.kind === "array-type" || node.params.some((param) => param.type.kind === "array-type")) {
          throw new Error("array function parameters and results are not supported")
        }
        if (node.returns.kind === "allocator-type") throw new Error("an allocator can only be passed as an argument")
      }
      if (parent.kind === "bind" && fieldsOf<BindNode>(parent).body === undefined) {
        throw new Error("\"bind\" must be directly inside \"maybe\"")
      }
      if (parent.kind === "defer") {
        walk(fieldsOf<DeferNode>(parent).body, (node) => {
          if (node.kind === "return") throw new Error("\"return\" cannot appear inside \"defer\"")
          if (node.kind === "defer") throw new Error("\"defer\" cannot appear inside \"defer\"")
          if (node.kind === "arena") throw new Error("\"arena\" cannot appear inside \"defer\"")
        })
      }
      if (parent.kind === "let") {
        const node = fieldsOf<LetNode>(parent)
        if (node.type.kind === "array-type" && (node.init.kind !== "literal" || fieldsOf<Expr<C, unknown>>(node.init).type.kind !== "array-type")) {
          throw new Error("array binding needs a direct array literal initializer")
        }
      }
      children(parent).forEach((child) => {
        if (child.role !== "expr") return
        const type = fieldsOf<Expr<C, unknown>>(child).type
        if (type.kind === "allocator-type" && parent.kind !== "call" && !(parent.kind === "new" && fieldsOf<NewNode>(parent).allocator === child)) {
          throw new Error("an allocator can only be passed as an argument")
        }
        if (type.kind !== "array-type") return
        if (parent.kind === "let" && fieldsOf<LetNode>(parent).init === child && child.kind === "literal") return
        if (parent.kind === "index" && fieldsOf<IndexNode>(parent).array === child && child.kind === "ref") return
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
        checkEscapes(fieldsOf<FunctionNode>(statement))
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

const RUNTIME_NAMES = ["Arena", "arena_make", "arena_new", "arena_free", "malloc", "free", "memcpy"]

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

const deferredIn = (statements: ReadonlyArray<AnyNode>): DeferNode[] =>
  statements.filter((statement) => statement.kind === "defer").map((statement) => fieldsOf<DeferNode>(statement)).reverse()

const body = (block: Block, emit: Parameters<Handler>[1]): string[] => {
  const lines = emit.block(block)
  if (block.statements.at(-1)?.kind === "return") return lines
  return [...lines, ...deferredIn(block.statements).flatMap((deferred) => emit.block(deferred.body))]
}

const declaration = (type: AnyNode, name: string, emit: Parameters<Handler>[1]): string => {
  if (type.kind === "array-type") {
    const node = fieldsOf<ArrayTypeNode>(type)
    return `${emit.node(node.element).text} ${name}[${node.length}]`
  }
  return `${emit.node(type).text} ${name}`
}

export const cTarget = defineTarget(
  {
    valid: (name) => /^[A-Za-z_]/.test(name) && !/[^A-Za-z0-9_]/.test(name),
    reserved: new Set([...KEYWORDS, ...STDINT, ...RUNTIME_NAMES]),
    spell: (name) => name.startsWith("_") ? `binding${name}` : name,
  },
  {
    "int-type": (node: IntTypeNode) => intName(node),
    "double-type": () => "double",
    "bool-type": () => "bool",
    "char-type": () => "char",
    "void-type": () => "void",
    "allocator-type": () => "Arena*",
    "array-type": () => {
      throw new Error("array types are only spelled in declarations")
    },
    "pointer-type": (node: PointerTypeNode, emit) => `${emit.node(node.to).text}*`,
    "nullable-type": (node: NullableTypeNode, emit) => emit.node(node.to).text,
    literal: (node: LiteralNode, emit): Fragment => {
      const { value } = node
      if (Array.isArray(value)) return frag(POSTFIX, `{${value.map((item) => emit.node(item).text).join(", ")}}`)
      if (value === null) return frag(POSTFIX, "NULL")
      if (typeof value === "boolean") return frag(POSTFIX, String(value))
      if (typeof value === "string") return frag(POSTFIX, `'${charSpelling(value)}'`)
      if (typeof value !== "number" && typeof value !== "bigint") throw new Error("numeric literal needs a number")
      if (node.type.kind === "int-type") {
        const type = fieldsOf<IntTypeNode>(node.type)
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
    index: (node: IndexNode, emit) => frag(POSTFIX, `${emit.at(node.array, POSTFIX)}[${emit.node(node.at).text}]`),
    cast: (node: CastNode, emit) => frag(UNARY, `(${emit.node(node.type).text})${emit.at(node.operand, UNARY)}`),
    address: (node: UnaryNode, emit) => frag(UNARY, `&${emit.at(node.operand, UNARY)}`),
    deref: (node: UnaryNode, emit) => frag(UNARY, `*${emit.at(node.operand, UNARY)}`),
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
    less: (node: BinaryNode, emit) => frag(RELATIONAL, `${emit.at(node.left, RELATIONAL)} < ${emit.at(node.right, RELATIONAL + 1)}`),
    ternary: (node: TernaryNode, emit) =>
      frag(CONDITIONAL, `${emit.at(node.condition, CONDITIONAL + 1)} ? ${emit.node(node.then).text} : ${emit.at(node.otherwise, CONDITIONAL)}`),
    call: (node: CallNode, emit) => frag(POSTFIX, `${emit.at(node.callee, POSTFIX)}(${node.args.map((arg) => emit.node(arg).text).join(", ")})`),
    let: (node: LetNode, emit) => `${declaration(node.type, emit.name(node.binding), emit)} = ${emit.node(node.init).text};`,
    assign: (node: AssignNode, emit) => `${emit.node(node.target).text} = ${emit.node(node.value).text};`,
    expression: (node: ExpressionNode, emit) => `${emit.node(node.expr).text};`,
    if: (node: IfNode, emit) => {
      const then = `if (${emit.node(node.condition).text}) ${braces(body(node.then, emit))}`
      return node.else === undefined ? then : `${then} else ${braces(body(node.else, emit))}`
    },
    bind: (node: BindNode, emit) => {
      if (node.body === undefined) throw new Error("\"bind\" must be directly inside \"maybe\"")
      const name = emit.name(node.binding)
      return `${declaration(node.type, name, emit)} = ${emit.node(node.value).text};\nif (${name} != NULL) ${braces(body(node.body, emit))}`
    },
    maybe: (node: MaybeNode, emit) => braces(body(node.body, emit)),
    while: (node: WhileNode, emit) => `while (${emit.node(node.condition).text}) ${braces(body(node.body, emit))}`,
    defer: () => "",
    arena: (node: ArenaNode, emit) => {
      const name = emit.name(node.binding)
      const backing = emit.name(node.backing)
      return braces([`Arena ${backing} = arena_make(${node.size});`, `Arena* ${name} = &${backing};`, ...body(node.body, emit)])
    },
    "arena-free": (node: ArenaFreeNode, emit) => `arena_free(${emit.name(node.allocator)});`,
    new: (node: NewNode, emit) => {
      const type = emit.node(node.value.type as TypeNode<C, unknown>).text
      return frag(
        POSTFIX,
        `arena_new(${emit.node(node.allocator).text}, sizeof(${type}), _Alignof(${type}), &(${type}){${emit.node(node.value).text}})`,
      )
    },
    return: (node: ReturnNode, emit) => {
      const value = emit.node(node.value).text
      const live = [...emit.scopes].reverse().flatMap(deferredIn)
      const [innermost] = live
      if (innermost === undefined) return `return ${value};`
      const result = emit.name(innermost.result)
      const type = emit.node(fieldsOf<Expr<C, unknown>>(node.value).type as TypeNode<C, unknown>).text
      return [`${type} ${result} = ${value};`, ...live.flatMap((deferred) => emit.block(deferred.body)), `return ${result};`].join("\n")
    },
    function: (node: FunctionNode, emit) => {
      const params = node.params.map((param) => declaration(param.type, emit.name(param.binding), emit))
      return `${emit.node(node.returns).text} ${emit.name(node.binding)}(${params.length === 0 ? "void" : params.join(", ")}) ${
        braces(body(node.body, emit))
      }`
    },
  },
)

const ARENA = "typedef struct { uint8_t* data; size_t size; size_t used; } Arena;"

const ARENA_MAKE = `static Arena arena_make(size_t size) {
  uint8_t* data = malloc(size);
  return (Arena){data, data == NULL ? 0 : size, 0};
}

static void arena_free(Arena* arena) {
  free(arena->data);
}`

const ARENA_NEW = `static void* arena_new(Arena* arena, size_t size, size_t align, const void* init) {
  size_t start = (arena->used + align - 1) & ~(align - 1);
  if (start > arena->size || size > arena->size - start) return NULL;
  arena->used = start + size;
  return memcpy(arena->data + start, init, size);
}`

// TODO: come up with an elegant, unified way to do imports instead of always including every header.
export const emitC = <Kinds extends keyof typeof cTarget.handlers>(program: Program<C, Kinds>): string => {
  const kinds = new Set<string>()
  walk(program.root, (node) => kinds.add(node.kind))
  const headers = ["stdbool.h", "stddef.h", "stdint.h", ...(kinds.has("arena") ? ["stdlib.h"] : []), ...(kinds.has("new") ? ["string.h"] : [])]
  const runtime = [
    ...(["arena", "new", "allocator-type"].some((kind) => kinds.has(kind)) ? [ARENA] : []),
    ...(kinds.has("arena") ? [ARENA_MAKE] : []),
    ...(kinds.has("new") ? [ARENA_NEW] : []),
  ]
  return `${headers.map((header) => `#include <${header}>\n`).join("")}\n${runtime.map((part) => `${part}\n\n`).join("")}${
    emit(program as Program<C, keyof typeof cTarget.handlers>, cTarget)
  }\n`
}
