export type Term =
  | { readonly kind: "atom"; readonly name: string }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "variable"; readonly name: string; readonly scope: symbol }
  | { readonly kind: "anonymous" }
  | { readonly kind: "compound"; readonly name: string; readonly args: readonly Term[] }
  | { readonly kind: "list"; readonly items: readonly Term[]; readonly tail: Term | undefined }

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
  readonly scope: symbol
}

export interface Variables {
  variable(name: string): Extract<Term, { kind: "variable" }>
}

function validate(clause: Clause): void {
  const variables = new Map<string, Term>()
  function term(value: Term): void {
    switch (value.kind) {
      case "variable": {
        if (value.scope !== clause.scope) throw new Error(`Variable ${value.name} belongs to another clause`)
        const previous = variables.get(value.name)
        if (previous && previous !== value) throw new Error(`Distinct variables share the name ${value.name}`)
        variables.set(value.name, value)
        break
      }
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

function scoped(build: (variables: Variables) => { head: Call; body?: Goal }): Clause {
  const scope = Symbol()
  const variables = new Map<string, Extract<Term, { kind: "variable" }>>()
  const result = build({
    variable(name) {
      if (!/^[A-Z_][A-Za-z0-9_]*$/.test(name) || name === "_") {
        throw new Error(`Invalid variable name ${JSON.stringify(name)}; use anonymous() for _`)
      }
      let variable = variables.get(name)
      if (!variable) {
        variable = { kind: "variable", name, scope }
        variables.set(name, variable)
      }
      return variable
    },
  })
  const clause: Clause = { head: result.head, body: result.body, scope }
  validate(clause)
  return clause
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
  call(name: string, ...args: Term[]): Call {
    return { kind: "call", name, args }
  },
  unify(left: Term, right: Term): Goal {
    return { kind: "unify", left, right }
  },
  and(...goals: [Goal, Goal, ...Goal[]]): Goal {
    return { kind: "and", goals }
  },
  or(...goals: [Goal, Goal, ...Goal[]]): Goal {
    return { kind: "or", goals }
  },
  fact(head: Call): Clause {
    return scoped(() => ({ head }))
  },
  clause: scoped,
  rule(build: (variables: Variables) => { head: Call; body: Goal }): Clause {
    return scoped(build)
  },
  program(...clauses: Clause[]): readonly Clause[] {
    return clauses
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
