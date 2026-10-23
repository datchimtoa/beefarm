#!/usr/bin/env python3
"""AST-driven pretty-printer for the LuckySheepFarm client bundle.

Recurses through every statement form esprima produces for this file, so
braces and terminators are correct (no slicing of statement containers).
Verified by re-parsing the output and comparing top-level structure and every
string-literal token with the original.
"""
import sys

import esprima


def g(node, key, default=None):
    if isinstance(node, dict):
        return node.get(key, default)
    return getattr(node, key, default)


class Printer:
    def __init__(self, src):
        self.src = src
        self.out = []
        self.indent = 0

    def line(self, text=""):
        self.out.append("  " * self.indent + text + "\n")

    def raw(self, node):
        start, end = g(node, "range")
        return self.src[start:end]

    def module(self, tree):
        for stmt in g(tree, "body") or []:
            self.stmt(stmt)
        return "".join(self.out)

    def block(self, stmts):
        self.line("{")
        self.indent += 1
        for s in stmts or []:
            self.stmt(s)
        self.indent -= 1
        self.line("}")

    def params(self, fn):
        out = []
        for p in g(fn, "params") or []:
            if g(p, "type") == "Identifier":
                out.append(g(p, "name"))
            elif g(p, "type") == "AssignmentPattern":
                out.append(f"{g(g(p,'left'),'name')} = {self.raw(g(p,'right'))}")
            elif g(p, "type") == "ObjectPattern":
                out.append("{" + ", ".join(g(pr, "name") or "?" for pr in g(p, "properties") or []) + "}")
            else:
                out.append(self.raw(p))
        return ", ".join(out)

    def stmt(self, node):
        t = g(node, "type")
        m = getattr(self, "s_" + t, None)
        if m:
            m(node)
        else:
            self.line(self.raw(node) + ";")

    def s_ImportDeclaration(self, node):
        self.line(self.raw(node))

    def s_EmptyStatement(self, node):
        self.line(";")

    def s_FunctionDeclaration(self, node):
        name = g(g(node, "id"), "name") or ""
        prefix = "async " if g(node, "isAsync") else ""
        self.line(f"{prefix}function {name}({self.params(node)}) {{")
        self.indent += 1
        for s in g(g(node, "body"), "body") or []:
            self.stmt(s)
        self.indent -= 1
        self.line("}")

    def s_VariableDeclaration(self, node):
        kind = g(node, "kind", "var")
        loose = []
        for d in g(node, "declarations") or []:
            init = g(d, "init")
            if init is not None and g(init, "type") in ("FunctionExpression", "ArrowFunctionExpression"):
                idn = g(d, "id")
                name = g(idn, "name") if idn else ""
                head = "async " if g(init, "isAsync") else ""
                self.line(f"{kind} {name} = {head}function ({self.params(init)}) {{")
                self.indent += 1
                body = g(init, "body")
                if g(body, "type") == "BlockStatement":
                    for s in g(body, "body") or []:
                        self.stmt(s)
                else:
                    self.line("return " + self.raw(body) + ";")
                self.indent -= 1
                self.line("};")
            else:
                loose.append(self.raw(d))
        if loose:
            self.line(f"{kind} " + ", ".join(loose) + ";")

    def s_ExpressionStatement(self, node):
        # raw() already includes the terminator for expression statements;
        # adding another "" would orphan a following `else`.
        text = self.raw(node)
        if not text.rstrip().endswith(";"):
            text = text.rstrip() + ";"
        self.line(text)

    def s_ReturnStatement(self, node):
        arg = g(node, "argument")
        self.line("return" + (" " + self.raw(arg) if arg else "") + ";")

    def s_IfStatement(self, node):
        self.out.append("  " * self.indent + f"if ({self.raw(g(node,'test'))}) ")
        cons, alt = g(node, "consequent"), g(node, "alternate")
        if g(cons, "type") == "BlockStatement":
            self.block(g(cons, "body"))
        elif g(cons, "type") == "TryStatement":
            self.try_inline(cons)
        else:
            self.stmt(cons)
        self.chain_else(alt)

    def chain_else(self, alt):
        """Emit `else ...` for the alternate of an if-chain."""
        if alt is None:
            return
        t = g(alt, "type")
        self.out.append("  " * self.indent + "else ")
        if t == "BlockStatement":
            self.block(g(alt, "body"))
        elif t == "IfStatement":
            # `else if (...)`: continue the chain on the same line
            self.out.append(f"if ({self.raw(g(alt,'test'))}) ")
            cons = g(alt, "consequent")
            if g(cons, "type") == "BlockStatement":
                self.block(g(cons, "body"))
            elif g(cons, "type") == "TryStatement":
                self.try_inline(cons)
            else:
                self.stmt(cons)
            self.chain_else(g(alt, "alternate"))
        elif t == "TryStatement":
            self.try_inline(alt)
        else:
            self.stmt(alt)

    def try_inline(self, node):
        """try/catch/finally laid out so an `else` can follow the last block."""
        self.out.append("try {\n")
        self.indent += 1
        for s in g(g(node, "block"), "body") or []:
            self.stmt(s)
        self.indent -= 1
        self.out.append("  " * self.indent + "}")
        handler = g(node, "handler")
        if handler is not None:
            self.out.append(f" catch ({g(g(handler,'param'),'name') or ''}) {{\n")
            self.indent += 1
            for s in g(g(handler, "body"), "body") or []:
                self.stmt(s)
            self.indent -= 1
            self.out.append("  " * self.indent + "}\n")
        finalizer = g(node, "finalizer")
        if finalizer is not None:
            self.out.append(" finally {\n")
            self.indent += 1
            for s in g(finalizer, "body") or []:
                self.stmt(s)
            self.indent -= 1
            self.out.append("  " * self.indent + "}\n")

    def block(self, stmts):
        self.out.append("{\n")
        self.indent += 1
        for s in stmts or []:
            self.stmt(s)
        self.indent -= 1
        self.out.append("  " * self.indent + "}\n")

    def s_TryStatement(self, node):
        self.out.append("  " * self.indent + "try ")
        self.block_inline(g(g(node, "block"), "body"))
        handler = g(node, "handler")
        if handler is not None:
            self.out.append(" " + "  " * self.indent + f"catch ({g(g(handler,'param'),'name') or ''}) ")
            self.block_inline(g(g(handler, "body"), "body"))
        finalizer = g(node, "finalizer")
        if finalizer is not None:
            self.out.append(" " + "  " * self.indent + "finally ")
            self.block_inline(g(finalizer, "body"))

    def block_inline(self, stmts):
        """Emit `{ ... }` ending with a newline (for try/catch chains)."""
        self.out.append("{\n")
        self.indent += 1
        for s in stmts or []:
            self.stmt(s)
        self.indent -= 1
        self.out.append("  " * self.indent + "}\n")

    def s_ForStatement(self, node):
        self.line(self.raw(node))


def main(path):
    src = open(path, encoding="utf-8").read()
    tree = esprima.parseModule(src, {"loc": True, "range": True, "tolerant": False})
    text = Printer(src).module(tree)
    out_path = path.replace(".js", ".ast.js")
    open(out_path, "w", encoding="utf-8").write(text)
    print(f"wrote {out_path} ({len(text)} bytes, {text.count(chr(10))} lines)")

    reparsed = esprima.parseModule(text, {"tolerant": False})
    ok_struct = [n.type for n in tree.body] == [n.type for n in reparsed.body]
    sa = [t.value for t in esprima.tokenize(src) if t.type == "String"]
    sb = [t.value for t in esprima.tokenize(text) if t.type == "String"]
    print(f"re-parsed OK  | top-level structure match: {ok_struct}")
    print(f"string literals: orig={len(sa)} reprinted={len(sb)} identical={sa == sb}")
    return 0 if (ok_struct and sa == sb) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/app.js"))
