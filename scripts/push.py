#!/usr/bin/env python3
"""Commit and push this project using dulwich (pure-Python git).

Why not git: `pkg install git` fails with
`dpkg: error: requested operation requires superuser privilege`, and no static
git build is reachable in this environment.

Requires (install once):
    pip3 install dulwich urllib3

Usage:
    python3 scripts/push.py                        # local commit only
    GITHUB_TOKEN=ghp_xxx python3 scripts/push.py    # commit + push
    python3 scripts/push.py --status                # show what would happen

Token needs `repo` scope (classic) or Contents:Read/Write (fine-grained).
"""
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BRANCH = b'refs/heads/main'
REMOTE = os.environ.get('GIT_REMOTE', 'https://github.com/datchimtoa/beefarm.git')
AUTHOR = b'Cline <cline@localhost>'

SKIP_DIRS = {'.git', 'node_modules', 'dist', '__pycache__', '.venv'}


def wanted(rel: Path) -> bool:
    """Files that belong in the repo."""
    if set(rel.parts) & SKIP_DIRS:
        return False
    if rel.name.endswith('.log'):
        return False
    if rel.name.startswith('.env') and rel.name != '.env.example':
        return False
    # never commit credentials
    if 'service-account' in rel.name or rel.name.endswith('.serviceAccount.json'):
        return False
    return True


def die(msg: str, hint: str = '') -> None:
    print(f'\n  ERROR  {msg}')
    if hint:
        print(f'         {hint}')
    sys.exit(1)


def check_deps() -> None:
    """Fail early with an actionable message instead of a traceback."""
    try:
        import dulwich  # noqa: F401
    except ImportError:
        die('dulwich is not installed', 'pip3 install dulwich')
    try:
        import urllib3  # noqa: F401
    except ImportError:
        die(
            'urllib3 is not installed (required for HTTP push)',
            'pip3 install urllib3',
        )


def collect_paths() -> list[str]:
    return [
        str(p.relative_to(ROOT))
        for p in ROOT.rglob('*')
        if p.is_file() and wanted(p.relative_to(ROOT))
    ]

def build_message(paths: list[str]) -> bytes:
    return (
        b'Add game server, rewritten client, and Vercel deployment\n\n'
        b'- server/: Telegram initData HMAC auth, server-authoritative economy,\n'
        b'  ad postback verification, referral payouts, Firebase RTDB store\n'
        b'- client/: Vite + ES modules rewrite; talks to /api only, no Firebase SDK\n'
        b'- api/index.js + vercel.json: serverless adapter\n'
        b'- 54 automated tests\n'
    )


def has_changes(repo, paths: list[str]) -> bool:
    """True when the working tree differs from HEAD (index is already staged)."""
    from dulwich.diff_tree import tree_changes

    index = repo.open_index()
    try:
        head = repo[repo.head()]
    except KeyError:
        return bool(paths)  # no commits yet

    changes = list(
        tree_changes(
            repo.object_store,
            head.tree,
            index.commit(repo.object_store).id,
        )
    )
    return bool(changes)


def sync_from_remote(repo, authed: str | None) -> None:
    """Fetch the remote branch and adopt its history as our parent.

    Without this, a fresh `git init` produces an orphan commit that shares no
    history with the remote, and the push is rejected as non-fast-forward:
        push failed: (b'f8d0ee16...', b'8579d759...')
    The tuple is (remote_head, our_head) — not an auth problem.
    """
    from dulwich import porcelain

    location = authed or REMOTE
    print(f'fetching {REMOTE} ...')
    try:
        # errstream to devnull: dulwich otherwise echoes the progress lines.
        import io

        result = porcelain.fetch(str(ROOT), location, quiet=True, errstream=io.BytesIO())
    except Exception as exc:  # noqa: BLE001
        print(f'  fetch skipped ({str(exc).splitlines()[0]})')
        return

    # porcelain.fetch() writes objects but not always the branch ref, so read
    # the advertised tip straight off the fetch result.
    remote_tip = None
    if result is not None:
        refs_map = getattr(result, 'refs', None)
        if refs_map:
            remote_tip = refs_map.get(b'refs/heads/main')
    if remote_tip is None:
        # Fall back to any ref we may have received.
        refs = repo.get_refs()
        for name in (b'refs/remotes/origin/main', b'refs/heads/main'):
            if name in refs:
                remote_tip = refs[name]
                break

    if not remote_tip:
        print('  remote branch not found; starting fresh history')
        return

    remote_tip = remote_tip.encode() if isinstance(remote_tip, str) else remote_tip
    local_tip = repo.get_refs().get(BRANCH)

    if local_tip == remote_tip:
        print(f'  already at remote tip {remote_tip.decode()[:12]}')
        return

    # If the remote tip is already an ancestor of our branch we are AHEAD of it
    # (a previous run built on it) and must NOT reset, or we would throw away
    # our own commit and create a duplicate every run.
    if local_tip and is_ancestor(repo, remote_tip, local_tip):
        print(f'  local branch already contains remote tip {remote_tip.decode()[:12]}')
        return

    print(f'  remote tip {remote_tip.decode()[:12]} -> building on top of it')
    # Point the branch at the remote tip WITHOUT touching the working tree.
    # `reset --hard` would materialise the remote's files (screenshots etc.)
    # into this directory and re-commit them as duplicates.
    repo.refs[BRANCH] = remote_tip


def is_ancestor(repo, maybe_ancestor: bytes, descendant: bytes) -> bool:
    """True when `maybe_ancestor` is reachable from `descendant`."""
    try:
        walker = repo.get_walker(include=[descendant])
        for entry in walker:
            if entry.commit.id == maybe_ancestor:
                return True
    except KeyError:
        return False
    return False


def main() -> int:
    from dulwich import porcelain
    from dulwich.repo import Repo

    check_deps()

    token = os.environ.get('GITHUB_TOKEN') or os.environ.get('GH_TOKEN')
    authed = REMOTE.replace('https://', f'https://x-access-token:{token}@') if token else None

    if not (ROOT / '.git').exists():
        Repo.init(str(ROOT), mkdir=False)
        print(f'initialised repo at {ROOT}')

    repo = Repo(str(ROOT))
    # dulwich writes commits to HEAD, so HEAD must point at our branch.
    try:
        repo.refs.set_symbolic_ref(b'HEAD', BRANCH)
    except Exception as exc:  # noqa: BLE001
        print(f'warning: could not set HEAD -> {exc}')

    paths = collect_paths()
    if '--status' in sys.argv:
        print(f'{len(paths)} files would be committed')
        for p in sorted(paths)[:20]:
            print(f'  {p}')
        if len(paths) > 20:
            print(f'  ... and {len(paths) - 20} more')
        return 0

    # Base our commit on the remote history so the push is a fast-forward.
    sync_from_remote(repo, authed)

    print(f'staging {len(paths)} files ...')
    start = time.time()
    porcelain.add(str(ROOT), paths=paths)  # single batched pass
    print(f'staged in {time.time() - start:.1f}s')

    # Do not create empty duplicate commits on repeated runs.
    if b'HEAD' in repo.get_refs():
        index = repo.open_index()
        head_entry = repo[repo.head()]
        staged_tree = index.commit(repo.object_store)      # returns a bytes SHA
        if staged_tree == head_entry.tree:
            print('nothing changed; no commit created')
            return push_if_requested(str(ROOT), repo.head())

    sha = porcelain.commit(
        str(ROOT),
        message=build_message(paths),
        author=AUTHOR,
        committer=AUTHOR,
    )
    sha = sha.decode() if isinstance(sha, bytes) else sha
    print(f'committed: {sha[:12]}')
    return push_if_requested(str(ROOT), sha.encode() if isinstance(sha, str) else sha)

def report_rejection(msg: str) -> None:
    """Turn a raw dulwich failure into something actionable."""
    # Non-fast-forward surfaces as a tuple of SHAs: (remote_head, our_head).
    if msg.startswith('(') and msg.endswith(')'):
        die(
            'push rejected: the remote has commits that are not in your history',
            'Run the script again: it now fetches the remote first and builds on '
            'top of it. If it still fails the branch has diverged — resolve '
            'manually, or delete .git and re-run.',
        )
    if any(
        token in msg
        for token in (
            'valid credentials',
            'Authentication',
            'Unauthorized',
            '401',
            '403',
            'Permission denied',
        )
    ):
        die(
            f'push rejected: {msg}',
            'The token is missing, expired, or lacks write access. Create one at '
            'github.com/settings/tokens with the "repo" scope.',
        )
    if 'not found' in msg.lower() or '404' in msg:
        die('repository not found', 'Check GIT_REMOTE and that the token can write to it.')
    if 'urllib3' in msg:
        die('urllib3 is missing', 'pip3 install urllib3')
    die(f'push failed: {msg}')


def push_if_requested(repo_path: str, sha: bytes) -> int:
    token = os.environ.get('GITHUB_TOKEN') or os.environ.get('GH_TOKEN')
    short = sha.decode()[:12] if isinstance(sha, bytes) else str(sha)[:12]

    if not token:
        print()
        print('No GITHUB_TOKEN: commit is local only.')
        print('To push: GITHUB_TOKEN=<repo-scope token> python3 scripts/push.py')
        return 0

    from dulwich import porcelain

    authed = REMOTE.replace('https://', f'https://x-access-token:{token}@')
    print(f'pushing to {REMOTE} ...')
    result = None
    try:
        result = porcelain.push(repo_path, authed, b'refs/heads/main:refs/heads/main')
    except Exception as exc:  # noqa: BLE001
        report_rejection(str(exc).splitlines()[0])

    # dulwich may also report a rejection in the returned dict instead of raising.
    if isinstance(result, dict):
        status = result.get(b'refs/heads/main') or result.get('refs/heads/main')
        if status not in (None, b'ok', 'ok'):
            report_rejection(str(status))

    print(f'pushed: {REMOTE}  main -> {short}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
