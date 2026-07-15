#!/usr/bin/env python3
"""Cross-check helper: run the REAL resolver's deep_merge over base/team/user
fixtures and dump merged JSON to stdout. Imports deep_merge from the shipped
_bmad/scripts/resolve_customization.py so the test compares against the source
of truth, not a copy."""
import importlib.util
import json
import sys
import tomllib
from pathlib import Path

here = Path(__file__).resolve().parent
project_root = here.parents[2]  # tests/fixtures/toml -> repo root
resolver_path = project_root / "_bmad" / "scripts" / "resolve_customization.py"

spec = importlib.util.spec_from_file_location("resolve_customization", resolver_path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def load(name):
    with (here / name).open("rb") as f:
        return tomllib.load(f)


merged = mod.deep_merge(load("base.toml"), load("team.toml"))
merged = mod.deep_merge(merged, load("user.toml"))
sys.stdout.write(json.dumps(merged, indent=2, ensure_ascii=False, default=str) + "\n")
