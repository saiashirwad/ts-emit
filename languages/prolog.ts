export type Term =
  | { readonly kind: "atom"; readonly name: string }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "variable"; readonly name: string }
  | { readonly kind: "anonymous" }
  | { readonly kind: "compound"; readonly name: string; readonly args: readonly Term[] }
  | { readonly kind: "list"; readonly items: readonly Term[]; readonly tail: Term | undefined }

export type Variable = Extract<Term, { kind: "variable" }>

export interface Call {
  readonly kind: "call"
  readonly name: string
  readonly args: readonly Term[]
}

export type Goal =
  | Call
  | { readonly kind: "unify"; readonly left: Term; readonly right: Term }
  | { readonly kind: "and" | "or"; readonly goals: readonly [Goal, Goal, ...Goal[]] }

export interface Clause {
  readonly head: Call
  readonly body: Goal | undefined
  readonly variables: readonly Variable[]
}

export type Body = Generator<Goal | Variable, void, unknown>

export interface Predicate<P extends readonly Term[] = readonly Term[]> {
  (...args: P): Generator<Goal, void, unknown>
  readonly name: string
  readonly arity: number
}

type Args<N extends readonly unknown[]> = { -readonly [K in keyof N]: Term }
type Params<N extends readonly unknown[]> = { -readonly [K in keyof N]: Variable }

function validate(clause: Clause): void {
  const names = new Set<string>()
  for (const variable of clause.variables) {
    if (names.has(variable.name)) throw new Error(`Distinct variables share the name ${variable.name}`)
    names.add(variable.name)
  }
  function term(value: Term): void {
    switch (value.kind) {
      case "variable":
        if (!clause.variables.includes(value)) throw new Error(`Variable ${value.name} belongs to another clause`)
        break
      case "compound":
        value.args.forEach(term)
        break
      case "list":
        value.items.forEach(term)
        if (value.tail) term(value.tail)
        break
    }
  }
  function goal(value: Goal): void {
    switch (value.kind) {
      case "call":
        value.args.forEach(term)
        break
      case "unify":
        term(value.left)
        term(value.right)
        break
      case "and":
      case "or":
        value.goals.forEach(goal)
        break
    }
  }
  goal(clause.head)
  if (clause.body) goal(clause.body)
}

function variable(name: string): Variable {
  if (!/^[A-Z_][A-Za-z0-9_]*$/.test(name) || name === "_") {
    throw new Error(`Invalid variable name ${JSON.stringify(name)}; use anonymous() for _`)
  }
  return { kind: "variable", name }
}

const step = function*(node: Goal): Generator<Goal, void, unknown> {
  yield node
}

const conjunction = function*(body: Body): Generator<Variable, Goal | undefined, unknown> {
  const goals: Goal[] = []
  for (const step of body) {
    if (step.kind === "variable") yield step
    else goals.push(step)
  }
  return goals.length > 1 ? { kind: "and", goals: goals as [Goal, Goal, ...Goal[]] } : goals[0]
}

function predicate<P extends readonly Term[]>(name: string, arity: number): Predicate<P> {
  const call = function*(...args: P): Generator<Goal, void, unknown> {
    if (args.length !== arity) throw new Error(`Prolog call to ${name}/${arity} has ${args.length} arguments`)
    yield { kind: "call", name, args }
  }
  return Object.defineProperties(call, { name: { value: name }, arity: { value: arity } }) as unknown as Predicate<P>
}

function clause(head: Call, variables: Variable[], body?: Body): Clause {
  let result: Goal | undefined
  if (body) {
    const steps = conjunction(body)
    let step = steps.next()
    while (!step.done) {
      variables.push(step.value)
      step = steps.next()
    }
    result = step.value
  }
  const built: Clause = { head, body: result, variables }
  validate(built)
  return built
}

// TODO: allow terms in heads. append([], Ys, Ys) currently has to be written as Xs = [], Ys = Zs in the body,
// which breaks first-argument indexing.
function rule<const N extends readonly string[]>(
  name: string,
  names: N,
  body: (...params: Params<N>) => Body,
): Generator<() => Clause, Predicate<Args<N>>, unknown>
function rule<P extends readonly Term[]>(
  predicate: Predicate<P>,
  names: { readonly [K in keyof P]: string },
  body: (...params: Params<P>) => Body,
): Generator<() => Clause, Predicate<P>, unknown>
function* rule(
  target: string | Predicate,
  names: readonly string[],
  body: (...params: Variable[]) => Body,
): Generator<() => Clause, Predicate, unknown> {
  const handle = typeof target === "string" ? predicate(target, names.length) : target
  if (names.length !== handle.arity) throw new Error(`Prolog clause for ${handle.name}/${handle.arity} has ${names.length} parameters`)
  yield () => {
    const params = names.map(variable)
    return clause({ kind: "call", name: handle.name, args: params }, [...params], body(...params))
  }
  return handle
}

export const prolog = {
  atom(name: string): Term {
    return { kind: "atom", name }
  },
  number(value: number): Term {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new Error("Prolog numbers must be finite and integer values must be safe integers")
    }
    return { kind: "number", value }
  },
  anonymous(): Term {
    return { kind: "anonymous" }
  },
  compound(name: string, ...args: Term[]): Term {
    return { kind: "compound", name, args }
  },
  list(items: readonly Term[], tail?: Term): Term {
    if (items.length === 0 && tail) throw new Error("A list with a tail needs at least one item")
    return { kind: "list", items: [...items], tail }
  },
  *variable(name: string): Generator<Variable, Variable, unknown> {
    const local = variable(name)
    yield local
    return local
  },
  call: (name: string, ...args: Term[]): Generator<Goal, void, unknown> => step({ kind: "call", name, args }),
  unify: (left: Term, right: Term): Generator<Goal, void, unknown> => step({ kind: "unify", left, right }),
  *or(...branches: [() => Body, () => Body, ...(() => Body)[]]): Generator<Goal | Variable, void, unknown> {
    const goals: Goal[] = []
    for (const branch of branches) goals.push((yield* conjunction(branch())) ?? { kind: "call", name: "true", args: [] })
    yield { kind: "or", goals: goals as [Goal, Goal, ...Goal[]] }
  },
  *facts<const R extends readonly Term[]>(name: string, rows: readonly [R, ...R[]]): Generator<() => Clause, Predicate<Args<R>>, unknown> {
    const handle = predicate<Args<R>>(name, rows[0].length)
    for (const row of rows) {
      if (row.length !== handle.arity) throw new Error(`Prolog facts for ${name}/${handle.arity} have a row with ${row.length} arguments`)
      yield () => clause({ kind: "call", name, args: row }, [])
    }
    return handle
  },
  rule,
  program(body: () => Generator<() => Clause, unknown, unknown>): readonly Clause[] {
    return [...body()].map((clause) => clause())
  },
}

function atom(name: string): string {
  if (/^[a-z][A-Za-z0-9_]*$/.test(name)) return name
  const escaped = Array.from(name, (character) => {
    if (character === "'" || character === "\\") return `\\${character}`
    const code = character.codePointAt(0)!
    if (code >= 0xd800 && code <= 0xdfff) throw new Error("Prolog atoms cannot contain a lone surrogate")
    return code < 32 || code === 127 ? `\\x${code.toString(16)}\\` : character
  }).join("")
  return `'${escaped}'`
}

function application(name: string, args: readonly Term[]): string {
  return args.length ? `${atom(name)}(${args.map(term).join(", ")})` : atom(name)
}

function term(value: Term): string {
  switch (value.kind) {
    case "atom":
      return atom(value.name)
    case "number":
      return String(value.value)
    case "variable":
      return value.name
    case "anonymous":
      return "_"
    case "compound":
      return application(value.name, value.args)
    case "list":
      return `[${value.items.map(term).join(", ")}${value.tail ? ` | ${term(value.tail)}` : ""}]`
  }
}

function goal(value: Goal, parent = 0): string {
  const precedence = value.kind === "or" ? 1 : value.kind === "and" ? 2 : 3
  let source: string
  switch (value.kind) {
    case "call":
      source = application(value.name, value.args)
      break
    case "unify":
      source = `${term(value.left)} = ${term(value.right)}`
      break
    case "and":
    case "or":
      source = value.goals.map((child) => goal(child, precedence)).join(value.kind === "and" ? ", " : "; ")
      break
  }
  return precedence < parent ? `(${source})` : source
}

export function emitProlog(clauses: readonly Clause[]): string {
  return clauses.map((clause) => {
    validate(clause)
    return `${goal(clause.head)}${clause.body ? ` :- ${goal(clause.body)}` : ""}.`
  }).join("\n")
}
