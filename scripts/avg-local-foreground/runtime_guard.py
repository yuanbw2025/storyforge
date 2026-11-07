"""Bind SAM imports in the dedicated foreground process to reviewed Git bytes."""
import hashlib
from importlib.abc import MetaPathFinder
from importlib.machinery import ModuleSpec, SourceFileLoader
from importlib.util import find_spec, spec_from_file_location
import os
from pathlib import Path
import subprocess
import sys


def _verify_blob(path, expected):
    if not path.is_file() or path.resolve(strict=True) != path:
        raise RuntimeError(f"SAM 2 源码缺失或路径不安全：{path.name}")
    with path.open("rb") as source:
        raw = source.read(20 * 1024**2 + 1)
    blob = b"blob " + str(len(raw)).encode() + b"\0" + raw
    if len(raw) > 20 * 1024**2 or hashlib.sha1(blob).hexdigest() != expected:
        raise RuntimeError(f"SAM 2 源码字节与登记 commit 不一致：{path.name}")
    return raw


class _VerifiedSourceLoader(SourceFileLoader):
    def __init__(self, name, path, expected):
        super().__init__(name, str(path))
        self.expected = expected

    def get_code(self, fullname):
        # Never consult or produce .pyc. Compile the same bytes that were checked.
        path = Path(self.path)
        return self.source_to_code(_verify_blob(path, self.expected), str(path))


class _VerifiedSamFinder(MetaPathFinder):
    def __init__(self, package, files):
        self.package = package
        self.files = files
        self.directories = {parent for file in files for parent in file.parents if parent.is_relative_to(package)}

    def find_spec(self, fullname, path=None, target=None):
        if fullname != "sam2" and not fullname.startswith("sam2."):
            return None
        location = self.package.joinpath(*fullname.split(".")[1:])
        for candidate in (location / "__init__.py", location.with_suffix(".py")):
            if candidate in self.files:
                loader = _VerifiedSourceLoader(fullname, candidate, self.files[candidate])
                return spec_from_file_location(fullname, candidate, loader=loader)
        if location in self.directories:
            spec = ModuleSpec(fullname, loader=None, is_package=True)
            spec.submodule_search_locations = [str(location)]
            return spec
        raise ModuleNotFoundError(f"No reviewed SAM 2 module named {fullname!r}", name=fullname)


def bind_sam_source(directory, expected_revision):
    root = Path(directory).resolve(strict=True)
    package = root / "sam2"
    # Bind Git to the supplied checkout even if the launching shell is in a
    # different repository. Disable replacement objects and lazy fetching.
    env = {key: value for key, value in os.environ.items()
           if key not in {"GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE",
                          "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE"}}
    env.update(GIT_NO_REPLACE_OBJECTS="1", GIT_NO_LAZY_FETCH="1", GIT_TERMINAL_PROMPT="0")

    def git(*args):
        try:
            return subprocess.check_output(["git", "-C", str(root), *args], env=env,
                                           stderr=subprocess.PIPE, timeout=10)
        except (subprocess.SubprocessError, OSError) as error:
            raise RuntimeError("无法离线核验 SAM 2 源码 commit") from error

    revision = git("rev-parse", "HEAD").decode().strip()
    if revision != expected_revision or Path(os.fsdecode(git("rev-parse", "--show-toplevel").strip())).resolve() != root:
        raise RuntimeError("SAM 2 源码不在登记的固定 commit")
    entries = git("ls-tree", "-rz", revision, "--", "sam2").rstrip(b"\0").split(b"\0")
    if not 1 <= len(entries) <= 1000:
        raise RuntimeError("SAM 2 源码清单不完整")
    files = {}
    for entry in entries:
        metadata, _, name = entry.partition(b"\t")
        parts = metadata.split()
        if len(parts) != 3 or parts[0] not in (b"100644", b"100755") or parts[1] != b"blob":
            raise RuntimeError("SAM 2 源码必须是登记的普通文件")
        path = root / os.fsdecode(name)
        files[path] = parts[2].decode()
        _verify_blob(path, files[path])

    finder = _VerifiedSamFinder(package, files)
    for path in package.rglob("*"):
        if path.is_symlink() or (path not in files and path not in finder.directories):
            raise RuntimeError(f"SAM 2 源码目录含未登记文件或字节码：{path.name}")

    entrypoint = package / "__init__.py"
    if entrypoint not in files:
        raise RuntimeError("SAM 2 源码缺少登记的 Python 包入口")
    loaded = any(name == "sam2" or name.startswith("sam2.") for name in sys.modules)
    if loaded:
        raise RuntimeError("SAM 2 已由其他导入入口加载；请从干净的前景服务进程启动")
    spec = find_spec("sam2")
    if spec is not None and (not spec.origin or Path(spec.origin).resolve() != entrypoint):
        raise RuntimeError("SAM 2 导入路径不属于已核验源码目录")

    # Keep the scoped finder for SAM's lazy imports. Other dependencies still
    # use the configured Python environment and the normal resolver.
    sys.meta_path.insert(0, finder)
    return revision
