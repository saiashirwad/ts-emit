import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const run = (command: string, args: string[]): string => {
  const result = spawnSync(command, args, { encoding: "utf8" })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}${result.stderr}`)
  }
  return result.stdout
}

const directory = mkdtempSync(join(tmpdir(), "ts-emit-"))
try {
  const c = join(directory, "example.c")
  const executable = join(directory, "example")
  writeFileSync(c, run(process.execPath, ["examples/c.ts"]))
  run("cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", c, "-o", executable])
  run(executable, [])
  console.log("C example compiled and ran")

  const prolog = join(directory, "example.pl")
  writeFileSync(prolog, run(process.execPath, ["examples/prolog.ts"]))
  run("swipl", ["-q", "-s", prolog, "-g", "findall(Y, ancestor(alice, Y), [bob, carol]), halt", "-t", "halt(1)"])
  console.log("Prolog example returned the expected ancestors")

  const lua = join(directory, "example.lua")
  writeFileSync(lua, run(process.execPath, ["examples/lua.ts"]))
  const output = run("lua", [lua])
  const fibs = [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89]
  const expected = fibs.map((value, n) => `${n}\t${value}\t${value < 10 ? "small" : "large"}\n`).join("") + "largest\t89\n"
  if (output !== expected) throw new Error(`Lua example returned ${JSON.stringify(output)} instead of ${JSON.stringify(expected)}`)
  console.log("Lua example printed the first 12 Fibonacci numbers")
} finally {
  rmSync(directory, { recursive: true, force: true })
}
