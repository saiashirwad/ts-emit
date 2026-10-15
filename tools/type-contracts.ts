import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const directory = mkdtempSync(resolve(".type-contracts-"))
const file = join(directory, "contract.ts")
const prefix = `import { c, type C, type Char, type I32, type Ptr, type Void } from "../languages/c.ts"
import type { Expr, Ref } from "../src/index.ts"
declare const n: Ref<C, I32>
const p = c.address(n)
`
const cases = [
  ...["c.literal(c.f64, 0)", "c.literal(c.char, \"a\")", "c.true", "p"].map((at) => ({
    name: `index rejects ${at}`,
    valid: "c.index(c.literal(c.array(c.i32, 1), [1]), n)",
    invalid: `c.index(c.literal(c.array(c.i32, 1), [1]), ${at})`,
  })),
  { name: "index array input", valid: "c.index(c.literal(c.array(c.i32, 1), [1]), n)", invalid: "c.index(p, n)" },
  {
    name: "index element assignment",
    valid: "c.assign(c.index(c.literal(c.array(c.i32, 1), [1]), n), n)",
    invalid: "c.assign(c.index(c.literal(c.array(c.i32, 1), [1]), n), c.literal(c.f64, 1))",
  },
  {
    name: "index char assignment",
    valid: "c.assign(c.index(c.literal(c.array(c.char, 1), [\"a\"]), n), c.literal(c.char, \"b\"))",
    invalid: "c.assign(c.index(c.literal(c.array(c.char, 1), [\"a\"]), n), n)",
  },
  {
    name: "index element address",
    valid: "c.let(\"p\", c.address(c.index(c.literal(c.array(c.i32, 1), [1]), n)), c.ptr(c.i32))",
    invalid: "c.let(\"p\", c.address(c.index(c.literal(c.array(c.i32, 1), [1]), n)), c.ptr(c.f64))",
  },
  {
    name: "index element pointer argument",
    valid:
      "c.program(function*() { const f = yield* c.fn(\"f\", [c.param(\"x\", c.ptr(c.i32))], c.void, function*() {}); c.call(f, c.address(c.index(c.literal(c.array(c.i32, 1), [1]), n))) })",
    invalid:
      "c.program(function*() { const f = yield* c.fn(\"f\", [c.param(\"x\", c.ptr(c.i32))], c.void, function*() {}); c.call(f, c.address(c.index(c.literal(c.array(c.f64, 1), [1]), n))) })",
  },
  {
    name: "array binding length",
    valid: "c.let(\"a\", c.literal(c.array(c.i32, 1), [1]), c.array(c.i32, 1))",
    invalid: "c.let(\"a\", c.literal(c.array(c.i32, 1), [1]), c.array(c.i32, 2))",
  },
  {
    name: "array binding element",
    valid: "c.let(\"a\", c.literal(c.array(c.i32, 1), [1]), c.array(c.i32, 1))",
    invalid: "c.let(\"a\", c.literal(c.array(c.i32, 1), [1]), c.array(c.f64, 1))",
  },
  { name: "array count", valid: "c.literal(c.array(c.i32, 2), [1, 2])", invalid: "c.literal(c.array(c.i32, 2), [1])" },
  { name: "array excess count", valid: "c.literal(c.array(c.i32, 1), [1])", invalid: "c.literal(c.array(c.i32, 1), [1, 2])" },
  { name: "array number input", valid: "c.literal(c.array(c.i32, 1), [1])", invalid: "c.literal(c.array(c.i32, 1), [1n])" },
  { name: "array bigint input", valid: "c.literal(c.array(c.i64, 1), [1n])", invalid: "c.literal(c.array(c.i64, 1), [1])" },
  { name: "array char input", valid: "c.literal(c.array(c.char, 1), [\"a\"])", invalid: "c.literal(c.array(c.char, 1), [1])" },
  ...["bool", "void", "ptr(c.i32)", "array(c.i32, 1)"].map((element) => ({
    name: `array element ${element}`,
    valid: "c.array(c.i32, 1)",
    invalid: `c.array(c.${element}, 1)`,
  })),
  { name: "pointer to array", valid: "c.ptr(c.i32)", invalid: "c.ptr(c.array(c.i32, 1))" },
  { name: "array literal length", valid: "c.array(c.i32, 2)", invalid: "declare const length: number; c.array(c.i32, length)" },
  { name: "arithmetic assignment", valid: "c.let(\"n\", n, c.i32)", invalid: "c.let(\"n\", n, c.f64)" },
  { name: "mixed integer addition", valid: "c.add(n, n)", invalid: "c.add(n, c.literal(c.i64, 1n))" },
  { name: "mixed integer comparison", valid: "c.less(n, n)", invalid: "c.less(n, c.literal(c.i64, 1n))" },
  { name: "mixed signedness addition", valid: "c.add(n, n)", invalid: "c.add(n, c.literal(c.u32, 1))" },
  { name: "mixed float comparison", valid: "c.less(n, n)", invalid: "c.less(n, c.literal(c.f64, 1))" },
  { name: "narrowing initializer", valid: "c.let(\"n\", c.cast(c.i8, n), c.i8)", invalid: "c.let(\"n\", n, c.i8)" },
  { name: "numeric assignment", valid: "c.assign(n, n)", invalid: "c.assign(n, c.literal(c.i64, 1n))" },
  { name: "narrowing float assignment", valid: "c.assign(n, c.cast(c.i32, c.literal(c.f64, 1)))", invalid: "c.assign(n, c.literal(c.f64, 1))" },
  {
    name: "narrowing numeric return",
    valid: "c.fn(\"f\", [], c.i8, function*() { yield* c.return(c.cast(c.i8, n)) })[Symbol.iterator]()",
    invalid: "c.fn(\"f\", [], c.i8, function*() { yield* c.return(n) })[Symbol.iterator]()",
  },
  {
    name: "narrowing numeric argument",
    valid:
      "c.program(function*() { const f = yield* c.fn(\"f\", [c.param(\"x\", c.i8)], c.i8, function*(x) { yield* c.return(x) }); c.call(f, c.cast(c.i8, n)) })",
    invalid:
      "c.program(function*() { const f = yield* c.fn(\"f\", [c.param(\"x\", c.i8)], c.i8, function*(x) { yield* c.return(x) }); c.call(f, n) })",
  },
  { name: "pointer assignment", valid: "c.let(\"p\", p, c.ptr(c.i32))", invalid: "c.let(\"p\", p, c.ptr(c.f64))" },
  { name: "pointer arithmetic", valid: "c.add(n, n)", invalid: "c.add(p, n)" },
  { name: "pointer dereference", valid: "c.deref(p)", invalid: "c.deref(n)" },
  { name: "nullable of a pointer", valid: "c.nullable(c.ptr(c.i32))", invalid: "c.nullable(c.i32)" },
  { name: "pointer into nullable", valid: "c.let(\"m\", p, c.nullable(c.ptr(c.i32)))", invalid: "c.let(\"m\", p, c.nullable(c.ptr(c.f64)))" },
  {
    name: "nullable into pointer",
    valid: "c.let(\"m\", p, c.ptr(c.i32))",
    invalid: "c.let(\"m\", c.null(c.nullable(c.ptr(c.i32))), c.ptr(c.i32))",
  },
  { name: "nullable dereference", valid: "c.deref(p)", invalid: "c.deref(c.null(c.nullable(c.ptr(c.i32))))" },
  {
    name: "bind a nullable pointer",
    valid: "declare const m: Expr<C, Ptr<I32> | null>; c.bind(\"q\", m)",
    invalid: "declare const m: Expr<C, Ptr<I32>>; c.bind(\"q\", m)",
  },
  { name: "maybe needs a generator body", valid: "c.maybe(function*() {})", invalid: "c.maybe(function() {})" },
  { name: "defer needs a generator body", valid: "c.defer(function*() {})", invalid: "c.defer(function() {})" },
  { name: "void pointer dereference", valid: "c.deref(p)", invalid: "declare const v: Expr<C, Ptr<Void>>; c.deref(v)" },
  { name: "address of an lvalue", valid: "c.address(c.deref(p))", invalid: "c.address(c.literal(c.i32, 1))" },
  { name: "assignment through a pointer", valid: "c.assign(c.deref(p), n)", invalid: "c.assign(p, n)" },
  { name: "bool assignment", valid: "c.let(\"b\", c.less(n, n), c.bool)", invalid: "c.let(\"b\", c.less(n, n), c.i32)" },
  { name: "char assignment", valid: "c.let(\"ch\", c.literal(c.char, \"a\"), c.char)", invalid: "c.let(\"ch\", n, c.char)" },
  { name: "char brand", valid: "declare const ch: Char; const value: string = ch", invalid: "const ch: Char = \"a\"" },
  {
    name: "char expression",
    valid: "const ch: Expr<C, Char> = c.literal(c.char, \"a\")",
    invalid: "declare const ch: Ref<C, string>; c.let(\"ch\", ch, c.char)",
  },
  { name: "i64 literal input", valid: "c.literal(c.i64, 9007199254740993n)", invalid: "c.literal(c.i64, 1)" },
  { name: "u64 literal input", valid: "c.literal(c.u64, 18446744073709551615n)", invalid: "c.literal(c.u64, 1)" },
  { name: "i32 literal input", valid: "c.literal(c.i32, 1)", invalid: "c.literal(c.i32, 1n)" },
  { name: "f64 literal input", valid: "c.literal(c.f64, 1)", invalid: "c.literal(c.f64, 1n)" },
  {
    name: "numeric cast pairs",
    valid: ["i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64", "f64"].map((target) =>
      ["i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64", "f64"].map((source) =>
        `c.cast(c.${target}, c.literal(c.${source}, ${source === "i64" || source === "u64" ? "1n" : "1"}));`
      ).join("\n")
    ).join("\n"),
    invalid: "c.cast(c.i32, c.literal(c.char, \"a\"))",
  },
  { name: "cast char source", valid: "c.cast(c.i32, n)", invalid: "c.cast(c.i32, c.literal(c.char, \"a\"))" },
  { name: "cast bool source", valid: "c.cast(c.i32, n)", invalid: "c.cast(c.i32, c.true)" },
  { name: "cast pointer source", valid: "c.cast(c.i32, n)", invalid: "c.cast(c.i32, p)" },
  { name: "cast char target", valid: "c.cast(c.i32, n)", invalid: "c.cast(c.char, n)" },
  { name: "cast bool target", valid: "c.cast(c.i32, n)", invalid: "c.cast(c.bool, n)" },
  { name: "cast pointer target", valid: "c.cast(c.i32, n)", invalid: "c.cast(c.ptr(c.i32), n)" },
  { name: "cast void target", valid: "c.cast(c.i32, n)", invalid: "c.cast(c.void, n)" },
  { name: "cast void source", valid: "c.cast(c.i32, n)", invalid: "declare const value: Expr<C, Void>; c.cast(c.i32, value)" },
  { name: "bool condition", valid: "c.if(c.true, function*() {})", invalid: "c.if(n, function*() {})" },
  { name: "ternary branches", valid: "c.ternary(c.true, n, n)", invalid: "c.ternary(c.true, n, p)" },
  { name: "declared binding type", valid: "c.let(\"n\", n, c.i32)", invalid: "c.let(\"n\", n)" },
  {
    name: "function result",
    valid: "c.fn(\"f\", [], c.i32, function*() { yield* c.return(n) })[Symbol.iterator]()",
    invalid: "c.fn(\"f\", [], c.i32, function*() { yield* c.return(p) })[Symbol.iterator]()",
  },
  {
    name: "call arguments",
    valid:
      "c.program(function*() { const f = yield* c.fn(\"f\", [c.param(\"x\", c.i32)], c.i32, function*(x) { yield* c.return(x) }); c.call(f, n) })",
    invalid:
      "c.program(function*() { const f = yield* c.fn(\"f\", [c.param(\"x\", c.i32)], c.i32, function*(x) { yield* c.return(x) }); c.call(f, p) })",
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
