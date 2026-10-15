import type { AnyNode, Binding, BindingId, Block } from "./node.ts"
import { at, frag, type Fragment } from "./print.ts"
import { type Program, visitScopes } from "./program.ts"
import type { Check } from "./rule.ts"

export interface Naming {
  readonly valid: (name: string) => boolean
  readonly reserved: ReadonlySet<string>
  readonly spell?: (nameHint: string) => string
}

export interface Emitter {
  readonly node: (node: AnyNode) => Fragment
  readonly at: (node: AnyNode, min: number) => string
  readonly block: (block: Block) => string[]
  readonly name: (binding: Binding) => string
}

export type Handler<N = any> = (node: N, emit: Emitter) => Fragment | string

export interface Handlers {
  readonly [kind: string]: Handler
}

export interface Target<H extends Handlers = Handlers> {
  readonly naming: Naming
  readonly handlers: H
}

export const defineTarget = <const H extends Handlers>(naming: Naming, handlers: H): Target<H> => ({ naming, handlers })

export const bindingNames = (root: Block, naming: Naming): ReadonlyMap<BindingId, string> => {
  const names = new Map<BindingId, string>()
  visitScopes(root, naming.reserved, {
    enter: (bindings, parent) => {
      const used = new Set(parent)
      for (const binding of bindings) {
        const hint = naming.spell?.(binding.nameHint) ?? binding.nameHint
        if (!naming.valid(hint)) throw new Error(`cannot emit invalid identifier "${hint}" for binding "${binding.nameHint}"`)
        let name = hint
        for (let suffix = 2; used.has(name); suffix++) name = `${hint}_${suffix}`
        used.add(name)
        names.set(binding.id, name)
      }
      return used
    },
    reference: () => {},
  })
  return names
}

type Missing<Kinds extends string, H> = Exclude<Kinds, keyof H>

export const emit = <L, Kinds extends string, const H extends Handlers>(
  program: Program<L, Kinds, any>,
  target: Target<H> & Check<[Missing<Kinds, H>] extends [never] ? true : false, `target has no handler for "${Missing<Kinds, H>}"`>,
): string => {
  const names = bindingNames(program.root, target.naming)
  const emitter: Emitter = {
    node: (node) => {
      const handler = target.handlers[node.kind]
      if (handler === undefined) throw new Error(`target has no handler for "${node.kind}"`)
      const result = handler(node, emitter)
      return typeof result === "string" ? frag(Infinity, result) : result
    },
    at: (node, min) => at(emitter.node(node), min),
    block: (block) => block.statements.map((statement) => emitter.node(statement).text).filter((line) => line !== ""),
    name: (binding) => {
      const name = names.get(binding.id)
      if (name === undefined) throw new Error(`binding "${binding.nameHint}" is not declared in the program`)
      return name
    },
  }
  return emitter.block(program.root).join("\n")
}
