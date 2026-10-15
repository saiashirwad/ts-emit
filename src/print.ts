export interface Fragment {
  readonly prec: number
  readonly text: string
}

export const frag = (prec: number, text: string): Fragment => ({ prec, text })

export const at = (fragment: Fragment, min: number): string => (fragment.prec >= min ? fragment.text : `(${fragment.text})`)

export const braces = (lines: readonly string[]): string =>
  lines.length === 0 ? "{}" : `{\n${lines.flatMap((line) => line.split("\n")).map((line) => (line === "" ? line : `  ${line}`)).join("\n")}\n}`
