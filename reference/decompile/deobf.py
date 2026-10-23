#!/usr/bin/env python3
"""AST-based deobfuscation/printer for the LuckySheepFarm client bundle.

Replaces the earlier regex newline-insertion hack. Parses with esprima
(ESTree, same grammar as esprima/esprima-next), then prints from the AST so
structure comes from the parser, not from string heuristics.

Additionally annotates string literals used as Firebase paths and records
every call site, so the output can be audited against the original.
"""
import json
import sys

import esprima

# ---------------------------------------------------------------- AST walk

def _get(node, key, default=None):
    """esprima returns attribute-accessible objects; be tolerant of both."""
    if isinstance(node, dict):
        return node.get(key, default)
    return getattr(node, key, default)


def walk(node, depth=0):
    """Yield (node, depth) for every AST node, handling esprima's object form."""
    if node is None:
        return
    if isinstance(node, list):
        for item in node:
            yield from walk(item, depth)
        return
    ntype = _get(node, "type")
    if ntype is None:
        return
    yield node, depth
    depth += 1
    for key in node.keys() if not isinstance(node, dict) else node.keys():
        if key in ("loc", "range", "type"):
            continue
        value = _get(node, key)
        if isinstance(value, list):
            for item in value:
                if _get(item, "type"):
                    yield from walk(item, depth)
        elif _get(value, "type"):
            yield from walk(value, depth)


def is_node(value):
    return _get(value, "type") is not None


# ---------------------------------------------------------------- helpers

def node_text(node, src):
    """Exact source slice for a node using its recorded range."""
    start, end = node["range"]
    return src[start:end]


def unwrap_loc(rng_starts, node):
    start, end = node["range"]
    return node["loc"]["start"]["line"], node["loc"]["start"]["column"], end - start


def pretty(value):
    """Short printable representation of a literal value."""
    if isinstance(value, str):
        return json.dumps(value)
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


# ---------------------------------------------------------------- report

def collect_strings(tree, src):
    strings = []
    for node, _ in walk(tree):
        if _get(node, "type") == "Literal" and isinstance(_get(node, "value"), str):
            strings.append(_get(node, "value"))
    return strings


def collect_calls(tree):
    calls = []
    for node, depth in walk(tree):
        if _get(node, "type") != "CallExpression":
            continue
        callee = _get(node, "callee") or {}
        ctype = _get(callee, "type")
        if ctype == "Identifier":
            name = _get(callee, "name")
        elif ctype == "MemberExpression":
            obj = _get(callee, "object") or {}
            prop = _get(callee, "property") or {}
            name = f"{_get(obj, 'name', '?')}.{_get(prop, 'name', '?')}"
        else:
            name = f"<{ctype}>"
        args = []
        for arg in _get(node, "arguments") or []:
            atype = _get(arg, "type")
            if atype == "Literal":
                args.append(pretty(_get(arg, "value")))
            elif atype == "Identifier":
                args.append(_get(arg, "name"))
            elif atype == "TemplateLiteral":
                parts = []
                for q in _get(arg, "quasis") or []:
                    cooked = _get(_get(q, "value"), "cooked")
                    parts.append(cooked or "")
                args.append('`' + "".join(parts) + '`')
            else:
                args.append(f"<{atype}>")
        loc = _get(node, "loc")
        line = loc.start.line if loc else 0
        calls.append((name, args, line))
    return calls


def collect_firebase_paths(tree):
    """find `users/${...}`, 'system_config', '.info/connected' style paths."""
    paths = set()
    for node, _ in walk(tree):
        ntype = _get(node, "type")
        if ntype == "Literal" and isinstance(_get(node, "value"), str):
            v = _get(node, "value")
            if "/" in v or v in ("system_config", ".info/connected"):
                paths.add(v)
        elif ntype == "TemplateLiteral":
            text = "".join(
                _get(_get(q, "value"), "cooked") or ""
                for q in _get(node, "quasis") or []
            )
            if "/" in text:
                paths.add(text)
    return sorted(paths)


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/app.js"
    src = open(path, encoding="utf-8").read()
    tree = esprima.parseModule(src, {"loc": True, "range": True, "tolerant": False})

    calls = collect_calls(tree)
    print(f"=== parsed {path} ({len(src)} bytes) ===")
    print(f"top-level nodes: {len(tree.body)}")
    from collections import Counter
    print("node kinds:", dict(Counter(_get(n, 'type') for n in tree.body)))

    total = sum(1 for _ in walk(tree))
    print(f"total AST nodes: {total}")

    print(f"\n=== call sites ({len(calls)}) ===")
    for name, args, line in calls:
        print(f"L{line:<4} {name}({', '.join(args)})")

    print(f"\n=== firebase / path literals ===")
    for p in collect_firebase_paths(tree):
        print(" ", json.dumps(p))


if __name__ == "__main__":
    main()
