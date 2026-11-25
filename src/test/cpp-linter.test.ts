import { describe, it, expect } from "vitest";
import { lintCppCode } from "@/lib/cpp-linter";

// The Code Lab's client-side C++ linter: every check is asserted against
// the exact message/line the student would see.

const CLEAN = `#include <iostream>
using namespace std;
int main() {
    cout << "Hello";
    return 0;
}`;

describe("lintCppCode", () => {
  it("reports no errors for a clean program", () => {
    expect(lintCppCode(CLEAN)).toEqual([]);
  });

  it("flags a missing #include <iostream> when cout is used", () => {
    const errs = lintCppCode(`using namespace std;
int main() {
    cout << "Hi";
    return 0;
}`);
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain("missing");
    expect(errs[0].message).toContain("iostream");
  });

  it("distinguishes a misspelled include from a missing one", () => {
    const errs = lintCppCode(`#include <iostrem>
int main() {
    cout << "Hi";
    return 0;
}`);
    expect(errs[0].message).toContain("misspelled");
  });

  it("does not demand iostream when the program does no I/O", () => {
    const errs = lintCppCode(`int add(int a, int b) {
    return a + b;
}
int main() {
    int x = add(1, 2);
    return 0;
}`);
    expect(errs.map((e) => e.message).join(" ")).not.toContain("iostream");
  });

  it("flags a missing main in a multi-line program", () => {
    const errs = lintCppCode(`#include <iostream>
using namespace std;
int helper() {
    return 1;
}`);
    expect(errs.some((e) => e.message.includes("`int main()` function is missing"))).toBe(true);
  });

  it("flags a misspelled main (void main)", () => {
    const errs = lintCppCode(`#include <iostream>
using namespace std;
void main() {
    cout << "Hi";
}`);
    expect(errs.some((e) => e.message.includes("misspelled"))).toBe(true);
  });

  it("counts a missing closing brace", () => {
    const errs = lintCppCode(`#include <iostream>
int main() {
    cout << "Hi";
    return 0;`);
    expect(errs.some((e) => e.message === "1 closing brace(s) `}` are missing")).toBe(true);
  });

  it("counts an extra closing brace", () => {
    const errs = lintCppCode(`#include <iostream>
int main() {
    return 0;
}
}`);
    expect(errs.some((e) => e.message.includes("extra closing brace"))).toBe(true);
  });

  it("ignores braces and parens inside string literals and comments", () => {
    const errs = lintCppCode(`#include <iostream>
int main() {
    cout << "{ not a brace (";
    // } also not a brace
    return 0;
}`);
    expect(errs).toEqual([]);
  });

  it("counts an unclosed parenthesis", () => {
    const errs = lintCppCode(`#include <iostream>
int main() {
    cout << (1 + 2;
    return 0;
}`);
    expect(errs.some((e) => e.message.includes("closing parenthesis"))).toBe(true);
  });

  it("flags cout >> with the correct line number", () => {
    const errs = lintCppCode(`#include <iostream>
int main() {
    cout >> "Hi";
    return 0;
}`);
    const dir = errs.find((e) => e.message.includes("cout >>"));
    expect(dir).toBeDefined();
    expect(dir!.line).toBe(3);
  });

  it("flags cin << with the correct line number", () => {
    const errs = lintCppCode(`#include <iostream>
int main() {
    int x;
    cin << x;
    return 0;
}`);
    const dir = errs.find((e) => e.message.includes("cin <<"));
    expect(dir).toBeDefined();
    expect(dir!.line).toBe(4);
  });

  it("flags a statement missing its semicolon, with line number", () => {
    const errs = lintCppCode(`#include <iostream>
int main() {
    int x = 5
    return 0;
}`);
    const semi = errs.find((e) => e.message.includes("semicolon"));
    expect(semi).toBeDefined();
    expect(semi!.line).toBe(3);
  });

  it("does not flag function signatures or lines ending in ) as missing semicolons", () => {
    const errs = lintCppCode(CLEAN);
    expect(errs.filter((e) => e.message.includes("semicolon"))).toEqual([]);
  });
});
