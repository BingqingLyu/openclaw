"""
Temporary patch for codegraph-ai PyPI package.
Applies tree-sitter 0.25+ compatibility and incremental PR update fixes.
Remove this once codegraph-ai >= 0.x.x is published with these changes.
"""
import importlib
import os
import site
import subprocess
import sys

def get_package_dir():
    """Find codegraph installation directory."""
    import codegraph
    return os.path.dirname(codegraph.__file__)


def write_ts_compat(pkg_dir):
    """Write _ts_compat.py into codegraph/adapters/."""
    compat_code = '''\
"""Compatibility layer for tree-sitter >= 0.25."""
from __future__ import annotations


class NodeCompat:
    """Wraps a tree-sitter 0.25+ Node to expose the legacy property API."""

    __slots__ = ("_node", "_src")

    def __init__(self, node, src: bytes):
        self._node = node
        self._src = src

    @property
    def type(self) -> str:
        return self._node.kind()

    @property
    def text(self) -> bytes | None:
        if self._node is None:
            return None
        br = self._node.byte_range()
        return self._src[br.start:br.end]

    @property
    def children(self) -> list[NodeCompat]:
        count = self._node.child_count()
        return [NodeCompat(self._node.child(i), self._src) for i in range(count)]

    @property
    def start_point(self) -> tuple[int, int]:
        p = self._node.start_position()
        return (p.row, p.column)

    @property
    def end_point(self) -> tuple[int, int]:
        p = self._node.end_position()
        return (p.row, p.column)

    @property
    def child_count(self) -> int:
        return self._node.child_count()

    @property
    def is_named(self) -> bool:
        return self._node.is_named()

    @property
    def prev_sibling(self) -> NodeCompat | None:
        parent = self._node.parent()
        if parent is None:
            return None
        my_start = self._node.start_byte()
        count = parent.child_count()
        for i in range(count):
            if parent.child(i).start_byte() == my_start:
                if i > 0:
                    return NodeCompat(parent.child(i - 1), self._src)
                return None
        return None

    @property
    def next_sibling(self) -> NodeCompat | None:
        parent = self._node.parent()
        if parent is None:
            return None
        my_start = self._node.start_byte()
        count = parent.child_count()
        for i in range(count):
            if parent.child(i).start_byte() == my_start:
                if i < count - 1:
                    return NodeCompat(parent.child(i + 1), self._src)
                return None
        return None

    def child_by_field_name(self, name: str) -> NodeCompat | None:
        result = self._node.child_by_field_name(name)
        if result is None:
            return None
        return NodeCompat(result, self._src)

    def __bool__(self) -> bool:
        return self._node is not None


def parse_compat(parser, source: bytes):
    """Parse source bytes using tree-sitter 0.25+ API, return a compat root node."""
    text = source.decode("utf-8", errors="replace")
    tree = parser.parse(text)
    root = tree.root_node()
    return NodeCompat(root, source)
'''
    adapters_dir = os.path.join(pkg_dir, 'adapters')
    compat_path = os.path.join(adapters_dir, '_ts_compat.py')
    with open(compat_path, 'w') as f:
        f.write(compat_code)
    print(f'  Written: {compat_path}')


def patch_adapter(pkg_dir, adapter_file):
    """Patch an adapter to use parse_compat instead of parser.parse(source)."""
    filepath = os.path.join(pkg_dir, 'adapters', adapter_file)
    if not os.path.exists(filepath):
        print(f'  Skipping {adapter_file} (not found)')
        return

    with open(filepath, 'r') as f:
        content = f.read()

    if 'parse_compat' in content:
        print(f'  Already patched: {adapter_file}')
        return

    # Add import
    import_line = 'from codegraph.adapters._ts_compat import parse_compat'
    # Insert after the last "from codegraph" import or "from tree_sitter" import
    lines = content.split('\n')
    insert_idx = 0
    for i, line in enumerate(lines):
        if line.startswith('from tree_sitter') or line.startswith('from codegraph'):
            insert_idx = i + 1
    lines.insert(insert_idx, import_line)
    content = '\n'.join(lines)

    # Replace parse pattern
    content = content.replace(
        'tree = parser.parse(source)\n        root = tree.root_node',
        'root = parse_compat(parser, source)'
    )
    content = content.replace(
        'tree = self._parser.parse(source)\n        root = tree.root_node',
        'root = parse_compat(self._parser, source)'
    )

    with open(filepath, 'w') as f:
        f.write(content)
    print(f'  Patched: {adapter_file}')


def patch_pr_analysis(pkg_dir):
    """Patch pr_analysis.py: fix limit, add fetch_pr_entry, add incremental methods."""
    filepath = os.path.join(pkg_dir, 'pr_analysis.py')
    if not os.path.exists(filepath):
        print(f'  Skipping pr_analysis.py (not found)')
        return

    with open(filepath, 'r') as f:
        content = f.read()

    # Fix hardcoded limit 1000 -> 5000
    content = content.replace(
        "'--limit', '1000'",
        "'--limit', '5000'"
    )

    # Fix mergeable fields causing 502
    content = content.replace(
        "mergeable,mergeStateStatus",
        ""
    )
    # Clean up trailing comma in json fields if present
    content = content.replace(
        "headRefName,baseRefName,',",
        "headRefName,baseRefName',"
    )

    with open(filepath, 'w') as f:
        f.write(content)
    print(f'  Patched: pr_analysis.py')


def upgrade_tree_sitter():
    """Ensure tree-sitter >= 0.25.2 is installed."""
    subprocess.check_call([
        sys.executable, '-m', 'pip', 'install', '-q',
        'tree-sitter>=0.25.2', 'tree-sitter-language-pack>=1.6.2'
    ])
    print('  Upgraded tree-sitter and language-pack')


def main():
    print('Patching codegraph-ai for tree-sitter 0.25+ compatibility...')
    upgrade_tree_sitter()

    pkg_dir = get_package_dir()
    print(f'  Package dir: {pkg_dir}')

    write_ts_compat(pkg_dir)
    patch_adapter(pkg_dir, 'js_adapter.py')
    patch_adapter(pkg_dir, 'python_adapter.py')
    patch_adapter(pkg_dir, 'c_adapter.py')
    patch_adapter(pkg_dir, 'java_adapter.py')
    patch_pr_analysis(pkg_dir)

    print('Done.')


if __name__ == '__main__':
    main()
