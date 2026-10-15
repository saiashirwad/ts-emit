import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const directory = mkdtempSync(resolve(".type-contracts-"))
const file = join(directory, "contract.ts")
const prefix = `import { c, type C, type Char, type Int } from "../languages/c.ts"
import type { Expr, Ref } from "../src/index.ts"
declare const n: Ref<C, Int<32, true>>
const p = c.address(n)
`
const cases = [
  { name: "arithmetic assignment", valid: "c.let(\"n\", n, c.double)", invalid: "c.let(\"n\", p, c.double)" },
  { name: "pointer assignment", valid: "c.let(\"p\", p, c.ptr(c.int(32)))", invalid: "c.let(\"p\", p, c.ptr(c.double))" },
  { name: "pointer arithmetic", valid: "c.add(p, n)", invalid: "c.add(p, p)" },
  { name: "pointer dereference", valid: "c.deref(p)", invalid: "c.deref(n)" },
  { name: "address of an lvalue", valid: "c.address(c.deref(p))", invalid: "c.address(c.literal(c.int(32), 1))" },
  { name: "assignment through a pointer", valid: "c.assign(c.deref(p), n)", invalid: "c.assign(p, n)" },
  { name: "bool assignment", valid: "c.let(\"b\", c.less(n, n), c.bool)", invalid: "c.let(\"b\", c.less(n, n), c.int(32))" },
  { name: "char assignment", valid: "c.let(\"ch\", c.literal(c.char, \"a\"), c.char)", invalid: "c.let(\"ch\", n, c.char)" },
  { name: "char brand", valid: "declare const ch: Char; const value: string = ch", invalid: "const ch: Char = \"a\"" },
  {
    name: "char expression",
    valid: "const ch: Expr<C, Char> = c.literal(c.char, \"a\")",
    invalid: "declare const ch: Ref<C, string>; c.let(\"ch\", ch, c.char)",
  },
  { name: "bool condition", valid: "c.if(c.true, function*() {})", invalid: "c.if(n, function*() {})" },
  { name: "ternary branches", valid: "c.ternary(c.true, n, n)", invalid: "c.ternary(c.true, n, p)" },
  { name: "declared binding type", valid: "c.let(\"n\", n, c.int(32))", invalid: "c.let(\"n\", n)" },
  {
    name: "function result",
    valid: "c.fn(\"f\", [], c.int(32), function*() { yield* c.return(n) })[Symbol.iterator]()",
    invalid: "c.fn(\"f\", [], c.int(32), function*() { yield* c.return(p) })[Symbol.iterator]()",
  },
  {
    name: "call arguments",
    valid:
      "c.program(function*() { const f = yield* c.fn(\"f\", [c.param(\"x\", c.int(32))], c.int(32), function*(x) { yield* c.return(x) }); c.call(f, n) })",
    invalid:
      "c.program(function*() { const f = yield* c.fn(\"f\", [c.param(\"x\", c.int(32))], c.int(32), function*(x) { yield* c.return(x) }); c.call(f, p) })",
  },
]

try {
  for (const contract of cases) {
    for (const [source, accepted] of [[contract.valid, true], [contract.invalid, false]] as const) {
      writeFileSync(file, prefix + source)
      const result = spawnSync(resolve("node_modules/.bin/tsc"), [
        "--ignoreConfig",
        "--strict",
        "--noEmit",
        "--skipLibCheck",
        "--allowImportingTsExtensions",
        "--target",
        "esnext",
        "--module",
        "esnext",
        "--moduleResolution",
        "bundler",
        "--types",
        "node",
        file,
      ], { encoding: "utf8" })
      assert.ifError(result.error)
      const output = result.stdout + result.stderr
      if (accepted) {
        assert.equal(result.status, 0, output)
      } else {
        assert.notEqual(result.status, 0, `${contract.name} must reject its invalid control`)
        assert.match(output, /contract\.ts\(\d+,\d+\): error TS/)
      }
    }
    console.log(`PASS ${contract.name}`)
  }
} finally {
  rmSync(directory, { recursive: true, force: true })
}
