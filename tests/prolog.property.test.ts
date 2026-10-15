import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import fc from "fast-check"

import { type Clause, emitProlog, prolog, type Term } from "../languages/prolog.ts"

const parameters: fc.Parameters<unknown> = {
  numRuns: 30,
  seed: Number(process.env.FC_SEED ?? 20261015),
}
if (process.env.FC_PATH !== undefined) parameters.path = process.env.FC_PATH
const scalar = fc.oneof(
  fc.constantFrom(0, 9, 10, 13, 31, 39, 47, 92, 127, 0x96ea, 0x1f600),
  fc.integer({ min: 0, max: 0xd7ff }),
  fc.integer({ min: 0xe000, max: 0x10ffff }),
)
const codes = fc.array(scalar, { maxLength: 8 })
const sample = fc.record({
  atom: codes,
  items: fc.array(codes, { minLength: 1, maxLength: 4 }),
  tail: codes,
  value: fc.integer({ min: -20, max: 20 }),
  includeFirst: fc.boolean(),
})
const numericList = (values: readonly number[]) => `[${values.join(",")}]`
const atom = (values: readonly number[]) => prolog.atom(String.fromCodePoint(...values))

test("generated Prolog batches preserve Unicode atoms, lists, unification, and goal precedence", () => {
  fc.assert(
    fc.property(fc.array(sample, { minLength: 1, maxLength: 5 }), (batch) => {
      const clauses: Clause[] = []
      const checks: string[] = []
      batch.forEach((data, index) => {
        const name = `case_${index}`
        clauses.push(prolog.fact(prolog.call(`${name}_atom`, atom(data.atom))))
        checks.push(`${name}_atom(A${index}), atom_codes(A${index}, ${numericList(data.atom)})`)
        clauses.push(prolog.rule(({ variable }) => {
          const head = variable("Head")
          const tail = variable("Tail")
          return {
            head: prolog.call(`${name}_list`, head, tail),
            body: prolog.unify(
              prolog.list([head], tail),
              prolog.list(data.items.map(atom)),
            ),
          }
        }))
        const [first, ...rest] = data.items
        checks.push(
          `${name}_list(H${index}, T${index}), atom_codes(H${index}, ${numericList(first!)}), maplist(atom_codes, T${index}, [${
            rest.map(numericList).join(",")
          }])`,
        )
        clauses.push(prolog.fact(prolog.call(`${name}_improper`, prolog.list(data.items.map(atom), atom(data.tail)))))
        const variables = data.items.map((_, item) => `I${index}_${item}`)
        checks.push(`${name}_improper([${variables.join(",")}|Z${index}])`)
        data.items.forEach((item, itemIndex) => checks.push(`atom_codes(${variables[itemIndex]}, ${numericList(item)})`))
        checks.push(`atom_codes(Z${index}, ${numericList(data.tail)})`)
        clauses.push(prolog.rule(({ variable }) => {
          const x = variable("X")
          return {
            head: prolog.call(`${name}_choose`, x),
            body: prolog.and(
              prolog.or(prolog.unify(x, prolog.number(data.value)), prolog.unify(x, prolog.number(data.value + 1))),
              prolog.or(
                prolog.unify(x, prolog.number(data.value + 1)),
                prolog.and(prolog.unify(x, prolog.number(data.value)), prolog.call(data.includeFirst ? "true" : "fail")),
              ),
            ),
          }
        }))
        const expected = data.includeFirst ? [data.value, data.value + 1] : [data.value + 1]
        checks.push(`findall(X, ${name}_choose(X), ${numericList(expected)})`)
      })
      const directory = mkdtempSync(join(tmpdir(), "ts-emit-prolog-property-"))
      try {
        const source = join(directory, "batch.pl")
        writeFileSync(source, emitProlog(clauses))
        const result = spawnSync("swipl", ["-q", "-s", source, "-g", `${checks.join(", ")}, write(ok)`, "-t", "halt"], {
          encoding: "utf8",
          timeout: 10_000,
          maxBuffer: 1024 * 1024,
        })
        assert.ifError(result.error)
        assert.equal(result.status, 0, result.stderr)
        assert.equal(result.stderr, "")
        assert.equal(result.stdout, "ok")
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    }),
    parameters,
  )
})

test("generated clause variables cannot escape through nested lists and compounds", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 3 }), (suffix, depth) => {
      let escaped: Term = prolog.anonymous()
      const owner = prolog.clause(({ variable }) => {
        escaped = variable(`X${suffix}`)
        assert.equal(variable(`X${suffix}`), escaped)
        return { head: prolog.call("owner", escaped) }
      })
      let nested = escaped
      for (let index = 0; index < depth; index++) nested = prolog.compound("nested", prolog.list([nested]))
      assert.throws(() => prolog.clause(() => ({ head: prolog.call("other", nested) })), /another clause/)
      const other = prolog.clause(({ variable }) => ({ head: prolog.call("other", variable(`X${suffix}`)) }))
      assert.doesNotThrow(() => emitProlog([owner, other]))
      assert.throws(() => emitProlog([{ ...other, body: prolog.unify(nested, prolog.anonymous()) }]), /another clause/)
    }),
    parameters,
  )
})
