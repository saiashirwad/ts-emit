import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const directory = mkdtempSync(resolve(".type-contracts-"))
const file = join(directory, "contract.ts")
const prefix = `import { c } from "../languages/c.ts"
const n = c.literal(c.int(32), 1)
const p = c.address(n)
`
const cases = [
  { name: "arithmetic assignment", valid: "c.let(\"n\", n, c.double)", invalid: "c.let(\"n\", p, c.double)" },
  { name: "pointer assignment", valid: "c.let(\"p\", p, c.ptr(c.int(32)))", invalid: "c.let(\"p\", p, c.ptr(c.double))" },
  { name: "pointer arithmetic", valid: "c.add(p, n)", invalid: "c.add(p, p)" },
  { name: "pointer dereference", valid: "c.deref(p)", invalid: "c.deref(n)" },
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
