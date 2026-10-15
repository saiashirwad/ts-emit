import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { type C, c, type Converted, cTarget, type Double, emitC, type Int, type Ptr } from "../languages/c.ts"
import * as lang from "../src/index.ts"
import { assertType, type Equal } from "./typing.ts"

const i8 = (value: number) => c.literal(c.int(8), value)
const i32 = (value: number) => c.literal(c.int(32), value)
const u32 = (value: number) => c.literal(c.uint(32), value)
const f64 = (value: number) => c.literal(c.double, value)

export const conversionContracts = () => {
  const sum = c.add(i8(1), i8(2))
  assertType<Equal<lang.Denotes<typeof sum>, Int<32, true>>>()
  const mixed = c.add(u32(1), i32(2))
  assertType<Equal<lang.Denotes<typeof mixed>, Int<32, false>>>()
  const wide = c.add(c.literal(c.int(64), 1), i8(2))
  assertType<Equal<lang.Denotes<typeof wide>, Int<64, true>>>()
  const real = c.add(i32(1), f64(2))
  assertType<Equal<lang.Denotes<typeof real>, Double>>()
  const compared = c.less(i8(1), f64(2))
  assertType<Equal<lang.Denotes<typeof compared>, Int<32, true>>>()
  assertType<Equal<Converted<Int<8, false>, Int<8, false>>, Int<32, true>>>()
  assertType<Equal<Converted<Int<16, false>, Int<32, true>>, Int<32, true>>>()
  assertType<Equal<Converted<Int<16, false>, Int<32, false>>, Int<32, false>>>()
  assertType<Equal<Converted<Int<32, false>, Int<64, true>>, Int<64, true>>>()
  assertType<Equal<Converted<Int<64, false>, Int<32, true>>, Int<64, false>>>()
  assertType<Equal<Converted<Int<64, true>, Int<64, false>>, Int<64, false>>>()

  c.program(function*() {
    yield* c.fn("main", [], c.void, function*() {
      const n = yield* c.let("n", i8(1), c.int(32))
      yield* c.let("wide", n, c.int(64))
      // @ts-expect-error a C binding needs a declared type
      yield* c.let("untyped", n)
      yield* c.let("real", n, c.double)
      yield* c.let("narrow", f64(2), c.int(8))
      const p = yield* c.let("p", c.address(n), c.ptr(c.int(32)))
      const q = c.add(p, i32(1))
      assertType<Equal<lang.Denotes<typeof q>, Ptr<Int<32, true>>>>()
      const flipped = c.add(i32(1), p)
      assertType<Equal<lang.Denotes<typeof flipped>, Ptr<Int<32, true>>>>()
      yield* c.let("q", q, c.ptr(c.int(32)))
      yield* c.let("m", c.deref(p), c.int(32))
      // @ts-expect-error int* to double* needs a cast in C
      yield* c.let("r", p, c.ptr(c.double))
      // @ts-expect-error int32_t* to uint32_t* needs a cast in C
      yield* c.let("u", p, c.ptr(c.uint(32)))
      // @ts-expect-error an int is not a pointer
      yield* c.let("s", n, c.ptr(c.int(32)))
      // @ts-expect-error a pointer is not arithmetic
      yield* c.let("t", p, c.int(32))
      // @ts-expect-error only a pointer can be dereferenced
      c.deref(n)
      // @ts-expect-error two pointers cannot be added
      c.add(p, p)
      // @ts-expect-error a double cannot be added to a pointer
      c.add(p, f64(1))
      // @ts-expect-error a pointer cannot be compared with an int
      c.less(p, n)
      yield* c.if(p, function*() {})
      yield* c.while(c.less(n, i32(10)), function*() {
        yield* c.assign(n, c.add(n, i32(1)))
      })
      // @ts-expect-error a value is not assignable to a pointer binding
      yield* c.assign(p, n)
    })
  })
}

export const functionContracts = () => {
  c.program(function*() {
    const square = yield* c.fn("square", [c.param("x", c.int(32))], c.int(64), function*(x) {
      yield* c.if(c.less(x, i32(0)), function*() {
        yield* c.return(i32(0))
      })
      yield* c.return(c.add(x, x))
    })
    yield* c.fn("main", [], c.void, function*() {
      yield* c.let("nine", c.call(square, i32(3)), c.int(64))
    })
    c.call(square, f64(3))
    // @ts-expect-error a pointer argument does not convert to an int parameter
    c.call(square, c.address(c.call(square, i32(1))))
    // @ts-expect-error too many arguments
    c.call(square, i32(1), i32(2))
    // @ts-expect-error too few arguments
    c.call(square)
    // @ts-expect-error a pointer is returned from a function declared to return an int, even from a nested branch
    yield* c.fn(
      "leak",
      [c.param("p", c.ptr(c.int(32)))],
      c.int(32),
      function*(p) {
        yield* c.if(p, function*() {
          yield* c.return(p)
        })
        yield* c.return(i32(0))
      },
    )
  })
}

const counter = () =>
  c.program(function*() {
    yield* c.fn("count", [c.param("limit", c.int(32))], c.int(32), function*(limit) {
      const i = yield* c.let("i", i32(0), c.int(32))
      yield* c.while(c.less(i, limit), function*() {
        yield* c.assign(i, c.add(i, i32(1)))
      })
      yield* c.return(i)
    })
  })

test("emit requires a handler for every kind a program uses, nested kinds included", () => {
  const program = counter()
  assertType<
    Equal<
      typeof program,
      lang.Program<C, "function" | "int-type" | "let" | "literal" | "while" | "less" | "ref" | "assign" | "add" | "return">
    >
  >()
  const { less: _less, ...withoutLess } = cTarget.handlers
  lang.emit(program, lang.defineTarget(cTarget.naming, { ...withoutLess, less: cTarget.handlers.less, extra: () => "" }))
  // @ts-expect-error target has no handler for "less", which is only used in a nested while condition
  assert.throws(() => lang.emit(program, lang.defineTarget(cTarget.naming, withoutLess)), /target has no handler for "less"/)
})

test("the C target emits C source", () => {
  assert.equal(
    emitC(counter()),
    `#include <stdint.h>

int32_t count(int32_t limit) {
  int32_t i = 0;
  while (i < limit) {
    i = i + 1;
  }
  return i;
}
`,
  )
  const pointers = c.program(function*() {
    yield* c.fn("main", [], c.int(32), function*() {
      const x = yield* c.let("int", f64(2), c.double)
      const p = yield* c.let("p", c.address(x), c.ptr(c.double))
      yield* c.let("byte", c.literal(c.uint(8), 255), c.uint(8))
      yield* c.return(c.add(c.deref(p), i32(1)))
    })
  })
  assert.equal(
    emitC(pointers),
    `#include <stdint.h>

int32_t main(void) {
  double int_2 = 2.0;
  double* p = &int_2;
  uint8_t byte = 255;
  return *p + 1;
}
`,
  )
})

test("C spells leading underscores safely and preserves collisions and references", () => {
  const program = c.program(function*() {
    const first = yield* c.let("_value", i32(1), c.int(32))
    const second = yield* c.let("binding_value", i32(2), c.int(32))
    yield* c.let("_", i32(3), c.int(32))
    yield* c.let("first", c.address(first), c.ptr(c.int(32)))
    yield* c.let("second", c.address(second), c.ptr(c.int(32)))
  })
  assert.equal(
    emitC(program),
    "#include <stdint.h>\n\nint32_t binding_value = 1;\nint32_t binding_value_2 = 2;\nint32_t binding_ = 3;\nint32_t* first = &binding_value;\nint32_t* second = &binding_value_2;\n",
  )
  for (const hint of ["_bad-name", "_\n", "_\r", "_\u2028", "_\u2029", "bad-name", "1value", ""]) {
    assert.throws(() =>
      emitC(c.program(function*() {
        yield* c.let(hint, i32(1), c.int(32))
      })), /invalid identifier/)
  }
})

test("C compiles C11 keywords and reserved underscore names in every binding position", () => {
  const names = ["_Alignas", "_Alignof", "_Atomic", "_Generic", "_Noreturn", "_Static_assert", "_Thread_local", "__LINE__", "__FILE__", "_value"]
  for (const name of names.slice(0, 7)) assert.equal(cTarget.naming.reserved.has(name), true)
  const program = c.program(function*() {
    for (const name of names) {
      const global = yield* c.let(name, i32(1), c.int(32))
      yield* c.fn(name, [c.param(name, c.int(32))], c.int(32), function*(parameter) {
        const local = yield* c.let(name, c.add(global, parameter), c.int(32))
        yield* c.return(local)
      })
    }
    yield* c.fn("main", [], c.int(32), function*() {
      yield* c.return(i32(0))
    })
  })
  const text = emitC(program)
  for (const name of names) {
    assert.ok(text.includes(`int32_t binding${name} = 1;`))
    assert.ok(text.includes(`int32_t binding${name}_2(int32_t binding${name}_3)`))
    assert.ok(text.includes(`int32_t binding${name}_4 = binding${name} + binding${name}_3;`))
    assert.ok(text.includes(`return binding${name}_4;`))
  }
  const directory = mkdtempSync(join(tmpdir(), "ts-emit-c-"))
  try {
    const source = join(directory, "program.c")
    const executable = join(directory, "program")
    writeFileSync(source, text)
    const compiled = spawnSync("cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", source, "-o", executable], { encoding: "utf8" })
    assert.ifError(compiled.error)
    assert.equal(compiled.status, 0, compiled.stderr)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("C literals are spelled with their declared type, and must fit it", () => {
  const program = c.program(function*() {
    yield* c.let("int32_t", c.less(u32(1), i32(-1)), c.int(32))
    yield* c.let("INT64_C", c.add(c.literal(c.int(64), -5), c.literal(c.uint(64), 9007199254740991)), c.int(64))
    yield* c.let("min", i32(-2147483648), c.int(32))
    yield* c.let("small", c.add(c.literal(c.uint(16), 65535), c.literal(c.int(8), -128)), c.int(32))
    yield* c.let("big", f64(1e21), c.double)
    yield* c.let("tiny", f64(-1.5e-7), c.double)
    yield* c.let("negativeZero", f64(-0), c.double)
    yield* c.let("notANumber", c.add(f64(NaN), f64(1)), c.double)
    yield* c.let("infinity", c.less(f64(-Infinity), f64(Infinity)), c.double)
  })
  assert.equal(
    emitC(program),
    `#include <stdint.h>

int32_t int32_t_2 = UINT32_C(1) < -1;
int64_t INT64_C_2 = -INT64_C(5) + UINT64_C(9007199254740991);
int32_t min = INT32_MIN;
int32_t small = 65535 + -128;
double big = 1e+21;
double tiny = -1.5e-7;
double negativeZero = -0.0;
double notANumber = 0.0 / 0.0 + 1.0;
double infinity = -1.0 / 0.0 < 1.0 / 0.0;
`,
  )
  assert.throws(() => c.literal(c.int(8), 300), /int8_t cannot hold the literal 300 exactly/)
  assert.throws(() => c.literal(c.int(32), 1.5), /int32_t cannot hold the literal 1.5 exactly/)
  assert.throws(() => c.literal(c.uint(8), -1), /uint8_t cannot hold the literal -1 exactly/)
  assert.throws(() => c.literal(c.int(64), 2 ** 53), /int64_t cannot hold the literal 9007199254740992 exactly/)
})

test("C rejects invalid program structure", () => {
  assert.throws(
    () =>
      c.program(function*() {
        yield* c.run(i32(1))
      }),
    /"expression" cannot appear at the top level of a C program/,
  )
  assert.throws(
    () =>
      c.program(function*() {
        yield* c.fn("outer", [], c.void, function*() {
          yield* c.if(i32(1), function*() {
            yield* c.fn("inner", [], c.void, function*() {})
          })
        })
      }),
    /function "inner" cannot be nested in another function in C/,
  )
  assert.throws(
    () =>
      c.program(function*() {
        const one = yield* c.fn("one", [], c.int(32), function*() {
          yield* c.return(i32(1))
        })
        yield* c.let("x", c.call(one), c.int(32))
      }),
    /the top-level "let" of "x" needs a constant initializer in C/,
  )
  assert.throws(
    () =>
      c.program(function*() {
        const x = yield* c.let("x", i32(1), c.int(32))
        yield* c.let("y", c.add(x, i32(1)), c.int(32))
      }),
    /the top-level "let" of "y" needs a constant initializer in C/,
  )
  const constants = c.program(function*() {
    const x = yield* c.let("x", c.add(i32(1), c.less(i8(2), f64(3))), c.int(32))
    yield* c.let("p", c.add(i32(1), c.address(x)), c.ptr(c.int(32)))
  })
  assert.equal(emitC(constants), "#include <stdint.h>\n\nint32_t x = 1 + (2 < 3.0);\nint32_t* p = 1 + &x;\n")
})

test("C executes pointer arithmetic, loops, and typed calls", () => {
  const program = c.program(function*() {
    const count = yield* c.fn("count", [c.param("value", c.ptr(c.int(32)))], c.int(32), function*(value) {
      const total = yield* c.let("total", i32(0), c.int(32))
      const i = yield* c.let("i", i32(0), c.int(32))
      yield* c.while(c.less(i, i32(3)), function*() {
        yield* c.assign(total, c.add(total, c.deref(c.add(value, i32(0)))))
        yield* c.assign(i, c.add(i, i32(1)))
      })
      yield* c.return(total)
    })
    yield* c.fn("main", [], c.int(32), function*() {
      const value = yield* c.let("value", i32(14), c.int(32))
      yield* c.return(c.call(count, c.address(value)))
    })
  })
  const directory = mkdtempSync(join(tmpdir(), "ts-emit-c-"))
  try {
    const source = join(directory, "program.c")
    const executable = join(directory, "program")
    writeFileSync(source, emitC(program))
    const compiled = spawnSync("cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", source, "-o", executable], { encoding: "utf8" })
    assert.ifError(compiled.error)
    assert.equal(compiled.status, 0, compiled.stderr)
    const executed = spawnSync(executable, [], { encoding: "utf8" })
    assert.ifError(executed.error)
    assert.equal(executed.status, 42, executed.stderr)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("C rejects escaped references and preserves distinct binding names", () => {
  let escaped: lang.Ref<C, Int<32, true>> | undefined
  c.program(function*() {
    yield* c.fn("outer", [], c.void, function*() {
      escaped = yield* c.let("inner", i32(1), c.int(32))
    })
  })
  assert.throws(() =>
    c.program(function*() {
      yield* c.fn("other", [], c.int(32), function*() {
        yield* c.return(escaped!)
      })
    }), /reference to "inner" does not resolve to an in-scope binding/)
  const program = c.program(function*() {
    const first = yield* c.let("value", i32(1), c.int(32))
    yield* c.let("value", i32(2), c.int(32))
    yield* c.let("pointer", c.address(first), c.ptr(c.int(32)))
  })
  assert.match(emitC(program), /int32_t value = 1;\nint32_t value_2 = 2;\nint32_t\* pointer = &value;/)
})
