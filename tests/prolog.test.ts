import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { family } from "../examples/prolog.ts"
import { emitProlog, prolog, type Term } from "../languages/prolog.ts"

const a = prolog.atom
const call = prolog.call

test("facts emit atoms, compounds, numbers, and proper and improper lists", () => {
  const clauses = prolog.program(function*() {
    yield* prolog.facts("values", [[a("alice"), a("Alice Smith"), a(""), a("don't\\\n\u0000")]])
    yield* prolog.facts("data", [[prolog.compound("+", prolog.number(-2), prolog.number(1.5)), prolog.list([a("a"), a("b")])]])
    yield* prolog.rule("cons", ["List"], function*(list) {
      const head = yield* prolog.variable("Head")
      const tail = yield* prolog.variable("Tail")
      yield* prolog.unify(list, prolog.list([head], tail))
    })
    yield* prolog.facts("empty", [[prolog.list([]), prolog.compound("zero")]])
    yield* prolog.facts("ready", [[]])
  })
  assert.equal(
    emitProlog(clauses),
    [
      "values(alice, 'Alice Smith', '', 'don\\'t\\\\\\xa\\\\x0\\').",
      "data('+'(-2, 1.5), [a, b]).",
      "cons(List) :- List = [Head | Tail].",
      "empty([], zero).",
      "ready.",
    ].join("\n"),
  )
  assert.equal(emitProlog([]), "")
})

test("Prolog rejects lone surrogates in atom, compound, and predicate names", () => {
  for (const name of ["\ud800", "\udfff", "a\ud800b", "a\udfffb"]) {
    for (
      const clauses of [
        () =>
          prolog.program(function*() {
            yield* prolog.facts("value", [[a(name)]])
          }),
        () =>
          prolog.program(function*() {
            yield* prolog.facts("value", [[prolog.compound(name, a("x"))]])
          }),
        () =>
          prolog.program(function*() {
            yield* prolog.facts(name, [[]])
          }),
        () =>
          prolog.program(function*() {
            yield* prolog.rule("value", [], function*() {
              yield* call(name)
            })
          }),
      ]
    ) {
      assert.throws(() => emitProlog(clauses()), /lone surrogate/)
    }
  }
})

test("goal precedence preserves conjunctions containing disjunctions", () => {
  const clauses = prolog.program(function*() {
    yield* prolog.rule("choose", ["X"], function*(x) {
      yield* prolog.or(function*() {
        yield* prolog.unify(x, a("a"))
      }, function*() {
        yield* prolog.unify(x, a("b"))
      })
      yield* prolog.or(function*() {
        yield* call("left", x)
      }, function*() {
        yield* call("middle", x)
        yield* call("right", x)
      })
    })
  })
  assert.equal(emitProlog(clauses), "choose(X) :- (X = a; X = b), (left(X); middle(X), right(X)).")
})

test("rules add clauses through handles, and bodies run after the program so they can call later predicates", () => {
  const clauses = prolog.program(function*() {
    const even = yield* prolog.rule("even", ["N"], function*(n) {
      yield* prolog.unify(n, a("zero"))
    })
    yield* prolog.rule(even, ["N"], function*(n) {
      const m = yield* prolog.variable("M")
      yield* prolog.unify(n, prolog.compound("s", m))
      yield* odd(m)
    })
    const odd = yield* prolog.rule("odd", ["N"], function*(n) {
      const m = yield* prolog.variable("M")
      yield* prolog.unify(n, prolog.compound("s", m))
      yield* even(m)
    })
  })
  assert.equal(
    emitProlog(clauses),
    [
      "even(N) :- N = zero.",
      "even(N) :- N = s(M), odd(M).",
      "odd(N) :- N = s(M), even(M).",
    ].join("\n"),
  )
})

test("predicate handles check arity", () => {
  assert.throws(() =>
    prolog.program(function*() {
      const parent = yield* prolog.facts("parent", [[a("alice"), a("bob")]])
      yield* prolog.rule("lonely", ["X"], function*(x) {
        // @ts-expect-error parent takes two arguments
        yield* parent(x)
      })
    }), /parent\/2 has 1 arguments/)
  assert.throws(() =>
    prolog.program(function*() {
      const parent = yield* prolog.facts("parent", [[a("alice"), a("bob")]])
      // @ts-expect-error parent takes two parameters
      yield* prolog.rule(parent, ["X"], function*() {})
    }), /parent\/2 has 1 parameters/)
  assert.throws(() =>
    prolog.program(function*() {
      yield* prolog.facts("parent", [[a("alice"), a("bob")], [a("bob")]])
    }), /parent\/2 have a row with 1 arguments/)
})

test("variables are clause-scoped, names are unique per clause, and anonymous occurrences stay fresh", () => {
  let escaped: Term = prolog.anonymous()
  const clauses = prolog.program(function*() {
    yield* prolog.rule("same", ["X", "Y"], function*(x, y) {
      escaped = x
      yield* prolog.unify(x, y)
    })
    yield* prolog.facts("fresh", [[prolog.anonymous(), prolog.anonymous()]])
  })
  assert.equal(emitProlog(clauses), "same(X, Y) :- X = Y.\nfresh(_, _).")
  assert.throws(() =>
    prolog.program(function*() {
      yield* prolog.facts("bad", [[escaped]])
    }), /another clause/)
  assert.throws(
    () =>
      prolog.program(function*() {
        yield* prolog.rule("bad", [], function*() {
          yield* call("nested", prolog.list([prolog.compound("f", escaped)]))
        })
      }),
    /another clause/,
  )
  assert.doesNotThrow(() =>
    prolog.program(function*() {
      yield* prolog.rule("other", ["X"], function*() {})
    })
  )
  assert.throws(() =>
    prolog.program(function*() {
      yield* prolog.rule("bad", ["X", "X"], function*() {})
    }), /share the name X/)
  assert.throws(
    () =>
      prolog.program(function*() {
        yield* prolog.rule("bad", ["X"], function*() {
          yield* prolog.variable("X")
        })
      }),
    /share the name X/,
  )
  for (const name of ["x", "_", "X Y", "X). injected(", ""]) {
    assert.throws(() =>
      prolog.program(function*() {
        yield* prolog.rule("bad", [name], function*() {})
      }), /Invalid variable name/)
    assert.throws(
      () =>
        prolog.program(function*() {
          yield* prolog.rule("bad", [], function*() {
            yield* prolog.variable(name)
          })
        }),
      /Invalid variable name/,
    )
  }
})

test("unsupported numeric values and empty list tails fail explicitly", () => {
  for (const value of [NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => prolog.number(value), /finite.*safe integers/)
  }
  assert.throws(() => prolog.list([], a("tail")), /at least one item/)
})

const runtime = spawnSync("swipl", ["--version"], { encoding: "utf8" })

test("SWI-Prolog executes recursion, unification, lists, escaping, and goal precedence", {
  skip: runtime.error && (runtime.error as NodeJS.ErrnoException).code === "ENOENT" ? "SWI-Prolog is not installed" : false,
}, () => {
  assert.equal(runtime.status, 0, runtime.stderr)
  const directory = mkdtempSync(join(tmpdir(), "ts-emit-prolog-"))
  try {
    const source = join(directory, "family.pl")
    const clauses = [
      ...family,
      ...prolog.program(function*() {
        yield* prolog.rule("same", ["X", "Y"], function*(x, y) {
          yield* prolog.unify(x, y)
        })
        yield* prolog.facts("fresh", [[prolog.anonymous(), prolog.anonymous()]])
        yield* prolog.rule("first", ["List", "Head"], function*(list, head) {
          const tail = yield* prolog.variable("Tail")
          yield* prolog.unify(list, prolog.list([head], tail))
        })
        yield* prolog.facts("escaped", [[a("don't\\\n\u0000")]])
        yield* prolog.facts("data", [[prolog.compound("+", prolog.number(-2), prolog.number(1.5)), prolog.number(1e-7)]])
        yield* prolog.facts("quoted", [[a("a). injected. %"), a("雪"), a("")]])
        yield* prolog.facts("😀", [[a("😀"), prolog.compound("😀", a("x"))]])
        yield* prolog.rule("choose", ["X"], function*(x) {
          yield* prolog.or(function*() {
            yield* prolog.unify(x, a("a"))
          }, function*() {
            yield* prolog.unify(x, a("b"))
          })
          yield* prolog.unify(x, a("b"))
        })
        const even = yield* prolog.rule("even", ["N"], function*(n) {
          yield* prolog.unify(n, a("zero"))
        })
        yield* prolog.rule(even, ["N"], function*(n) {
          const m = yield* prolog.variable("M")
          yield* prolog.unify(n, prolog.compound("s", m))
          yield* odd(m)
        })
        const odd = yield* prolog.rule("odd", ["N"], function*(n) {
          const m = yield* prolog.variable("M")
          yield* prolog.unify(n, prolog.compound("s", m))
          yield* even(m)
        })
      }),
    ]
    writeFileSync(source, emitProlog(clauses))
    const query = [
      "findall(Y, ancestor(alice, Y), [bob, carol])",
      "same(a, a)",
      "\\+ same(a, b)",
      "fresh(a, b)",
      "first([a, b], a)",
      "findall(X, choose(X), [b])",
      "even(s(s(zero)))",
      "\\+ odd(s(s(zero)))",
      "escaped(E), atom_codes(E, [100,111,110,39,116,92,10,0])",
      "data('+'(-2, 1.5), 1e-7)",
      "quoted('a). injected. %', '雪', '')",
      "'😀'(A, '😀'(x)), atom_codes(A, [128512])",
      "write(ok)",
    ].join(", ")
    const result = spawnSync("swipl", ["-q", "-s", source, "-g", query, "-t", "halt"], { encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, "ok")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
