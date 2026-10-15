export type LuaType = "number" | "string" | "boolean" | "nil" | "function"
export type Value = number | string | boolean | null

export interface Expr<T extends LuaType = LuaType> {
  readonly type: T
  readonly node: ExprNode
}

export interface Binding<T extends LuaType = LuaType> extends Expr<T> {
  readonly node: { readonly kind: "ref"; readonly id: symbol; readonly name: string }
}

export interface FunctionRef<R extends LuaType = LuaType> extends Binding<"function"> {
  readonly result: R
  readonly parameters: readonly LuaType[]
  readonly builtin?: "print"
}

type ExprNode =
  | { readonly kind: "literal"; readonly value: Value }
  | Binding["node"]
  | { readonly kind: "add" | "less"; readonly left: Expr; readonly right: Expr }
  | { readonly kind: "call"; readonly fn: FunctionRef; readonly args: readonly Expr[] }

export type Stmt =
  | { readonly kind: "let"; readonly binding: Binding; readonly value: Expr }
  | { readonly kind: "assign"; readonly binding: Binding; readonly value: Expr }
  | { readonly kind: "run"; readonly value: Expr }
  | { readonly kind: "return"; readonly value: Expr }
  | { readonly kind: "while"; readonly condition: Expr; readonly body: readonly Stmt[] }
  | { readonly kind: "if"; readonly condition: Expr; readonly body: readonly Stmt[]; readonly otherwise: readonly Stmt[] }
  | { readonly kind: "function"; readonly binding: FunctionRef; readonly params: readonly Binding[]; readonly body: readonly Stmt[] }

export interface Program {
  readonly body: readonly Stmt[]
}

type Body = () => Generator<Stmt, unknown, unknown>
type Params<P extends readonly Binding[]> = { [K in keyof P]: P[K] }

const collect = (body: Body): Stmt[] => [...body()]
const binding = <T extends LuaType>(name: string, type: T): Binding<T> => ({ type, node: { kind: "ref", id: Symbol(name), name } })
const statement = function*(node: Stmt): Generator<Stmt, void, unknown> {
  yield node
}

function literal(value: number): Expr<"number">
function literal(value: string): Expr<"string">
function literal(value: boolean): Expr<"boolean">
function literal(value: null): Expr<"nil">
function literal(value: Value): Expr {
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Lua literals require finite numbers")
  return { type: value === null ? "nil" : typeof value as "number" | "string" | "boolean", node: { kind: "literal", value } }
}

const checkAssignment = (local: Binding, value: Expr): void => {
  if (local.type === "function") throw new Error("Lua function assignments are not supported")
  if (local.type !== value.type) throw new Error("Lua assignment type mismatch")
}

const guaranteesReturn = (body: readonly Stmt[]): boolean =>
  body.some((stmt) => stmt.kind === "return" || (stmt.kind === "if" && guaranteesReturn(stmt.body) && guaranteesReturn(stmt.otherwise)))

const print: FunctionRef<"nil"> = { ...binding("print", "function"), result: "nil", parameters: [], builtin: "print" }

export const lua = {
  number: "number" as const,
  string: "string" as const,
  boolean: "boolean" as const,
  nil: "nil" as const,
  print,
  literal,
  param: binding,
  program: (body: Body): Program => ({ body: collect(body) }),
  *fn<P extends readonly Binding[], R extends LuaType>(
    name: string,
    params: P,
    result: R,
    body: (...params: Params<P>) => Generator<Stmt, unknown, unknown>,
  ): Generator<Stmt, FunctionRef<R>, unknown> {
    const fn: FunctionRef<R> = { ...binding(name, "function"), result, parameters: params.map((param) => param.type) }
    yield { kind: "function", binding: fn, params, body: collect(() => body(...params)) }
    return fn
  },
  *let<T extends LuaType>(name: string, value: Expr<T>, type: T = value.type): Generator<Stmt, Binding<T>, unknown> {
    if (type !== value.type) throw new Error("Lua local type mismatch")
    const local = binding(name, type)
    yield { kind: "let", binding: local, value }
    return local
  },
  assign: <T extends Exclude<LuaType, "function">>(local: Binding<T>, value: Expr<T>): Generator<Stmt, void, unknown> => {
    checkAssignment(local, value)
    return statement({ kind: "assign", binding: local, value })
  },
  return: (value: Expr = literal(null)): Generator<Stmt, void, unknown> => statement({ kind: "return", value }),
  run: (value: Expr): Generator<Stmt, void, unknown> => {
    if (value.node.kind !== "call") throw new Error("Lua expression statements must be calls")
    return statement({ kind: "run", value })
  },
  while: (condition: Expr<"boolean">, body: Body): Generator<Stmt, void, unknown> => statement({ kind: "while", condition, body: collect(body) }),
  if: (condition: Expr<"boolean">, body: Body, otherwise: Body = function*() {}): Generator<Stmt, void, unknown> =>
    statement({ kind: "if", condition, body: collect(body), otherwise: collect(otherwise) }),
  call: <R extends LuaType>(fn: FunctionRef<R>, ...args: Expr[]): Expr<R> => {
    if (!fn.builtin && (args.length !== fn.parameters.length || args.some((arg, index) => arg.type !== fn.parameters[index]))) {
      throw new Error("Lua call arguments do not match parameters")
    }
    return { type: fn.result, node: { kind: "call", fn, args } }
  },
  add: (left: Expr<"number">, right: Expr<"number">): Expr<"number"> => ({ type: "number", node: { kind: "add", left, right } }),
  less: (left: Expr<"number">, right: Expr<"number">): Expr<"boolean"> => ({ type: "boolean", node: { kind: "less", left, right } }),
}

const reserved = new Set("and break do else elseif end false for function goto if in local nil not or repeat return then true until while".split(" "))

const quote = (value: string): string => {
  let text = "\""
  for (const char of value) {
    const code = char.codePointAt(0)!
    if (code >= 0xd800 && code <= 0xdfff) throw new Error("Lua string contains an unpaired surrogate")
    if (char === "\"" || char === "\\") text += `\\${char}`
    else if (code < 32 || code === 127) text += `\\${code.toString().padStart(3, "0")}`
    else text += char
  }
  return `${text}"`
}

export function emitLua(program: Program): string {
  const used = new Set(["print"])
  type Scope = Map<symbol, string>
  const declare = (local: Binding, scope: Scope): string => {
    if (scope.has(local.node.id)) throw new Error(`Lua binding already declared: ${local.node.name}`)
    let base = local.node.name.replace(/[^a-zA-Z0-9_]/g, "_") || "_"
    if (/^[0-9]/.test(base) || reserved.has(base)) base = `_${base}`
    let name = base
    for (let suffix = 2; used.has(name); suffix++) name = `${base}_${suffix}`
    used.add(name)
    scope.set(local.node.id, name)
    return name
  }
  const reference = (local: Binding, scope: Scope): string => {
    const name = scope.get(local.node.id)
    if (name === undefined) throw new Error(`Lua binding is outside its lexical scope: ${local.node.name}`)
    return name
  }
  const expression = (expr: Expr, scope: Scope, parent = 0): string => {
    const node = expr.node
    switch (node.kind) {
      case "literal":
        if (typeof node.value === "string") return quote(node.value)
        if (node.value === null) return "nil"
        if (typeof node.value === "number") {
          if (!Number.isFinite(node.value)) throw new Error("Lua literals require finite numbers")
          return Object.is(node.value, -0) ? "-0.0" : String(node.value)
        }
        return String(node.value)
      case "ref":
        return reference({ type: expr.type, node }, scope)
      case "call": {
        const name = node.fn === print ? "print" : reference(node.fn, scope)
        return `${name}(${node.args.map((arg) => expression(arg, scope)).join(", ")})`
      }
      case "add":
      case "less": {
        const precedence = node.kind === "add" ? 2 : 1
        const text = `${expression(node.left, scope, precedence)} ${node.kind === "add" ? "+" : "<"} ${expression(node.right, scope, precedence + 1)}`
        return precedence < parent ? `(${text})` : text
      }
    }
  }
  const block = (body: readonly Stmt[], scope: Scope, depth: number, result?: LuaType): string[] => {
    const lines: string[] = []
    const line = (text: string) => lines.push(`${"  ".repeat(depth)}${text}`)
    for (const [index, stmt] of body.entries()) {
      switch (stmt.kind) {
        case "let": {
          const value = expression(stmt.value, scope)
          line(`local ${declare(stmt.binding, scope)} = ${value}`)
          break
        }
        case "assign":
          checkAssignment(stmt.binding, stmt.value)
          line(`${reference(stmt.binding, scope)} = ${expression(stmt.value, scope)}`)
          break
        case "run":
          line(expression(stmt.value, scope))
          break
        case "return": {
          if (result === undefined) throw new Error("Lua return must be inside a function")
          if (stmt.value.type !== result) throw new Error("Lua return type mismatch")
          const text = `return ${expression(stmt.value, scope)}`
          line(index === body.length - 1 ? text : `do ${text} end`)
          break
        }
        case "function": {
          if (stmt.binding.result !== "nil" && !guaranteesReturn(stmt.body)) throw new Error("Lua non-nil function may fall through")
          const name = declare(stmt.binding, scope)
          const inner = new Map(scope)
          const params = stmt.params.map((param) => declare(param, inner))
          line(`local function ${name}(${params.join(", ")})`)
          lines.push(...block(stmt.body, inner, depth + 1, stmt.binding.result))
          line("end")
          break
        }
        case "while":
        case "if":
          line(`${stmt.kind} ${expression(stmt.condition, scope)} ${stmt.kind === "while" ? "do" : "then"}`)
          lines.push(...block(stmt.body, new Map(scope), depth + 1, result))
          if (stmt.kind === "if" && stmt.otherwise.length) {
            line("else")
            lines.push(...block(stmt.otherwise, new Map(scope), depth + 1, result))
          }
          line("end")
          break
      }
    }
    return lines
  }
  return block(program.body, new Map(), 0).join("\n")
}
