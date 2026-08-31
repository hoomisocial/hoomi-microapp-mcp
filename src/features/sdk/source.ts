import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

export const MAX_SOURCE_FILE_BYTES = 500_000;
export const MAX_RESULT_CHARS = 28_000;
export const MAX_SEARCH_RESULTS = 60;

const MAX_SEARCH_FILES = 2_000;
const MAX_SEARCH_SOURCE_BYTES = 20_000_000;
const SEARCH_DEADLINE_MS = 5_000;
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "dist", "coverage"]);
const ALLOWED_EXTENSIONS = new Set([".json", ".md", ".mjs", ".ts", ".tsx"]);
const ALLOWED_ROOT_FILES = new Set(["CLAUDE.md", "README.md", "package.json"]);
const SDK_NAMESPACES = [
  "lifecycle",
  "ui",
  "storage",
  "system",
  "user",
  "location",
  "camera",
  "audio",
  "wallet",
  "jobs",
  "pages",
  "ble",
  "iot"
] as const;

export interface SdkSourceOptions {
  rootDirectory: string;
  revision?: string;
  digest?: string;
}

export interface SdkSourceFile {
  path: string;
  content: string;
}

export interface SdkSearchMatch {
  path: string;
  line: number;
  snippet: string;
}

export interface SdkSourceStatus {
  revision: string | null;
  sourceMode: "configured-directory";
  sourceDirectoryConfigured: true;
  package: {
    name: string | null;
    version: string | null;
    entrypoints: string[];
  };
  fileCount: number;
  namespaces: readonly string[];
}

export class SdkSourceError extends Error {
  constructor(
    readonly code:
      | "sdk_source_unavailable"
      | "sdk_source_path_invalid"
      | "sdk_source_file_unavailable"
      | "sdk_search_limit_exceeded"
      | "sdk_source_integrity_mismatch",
    message: string
  ) {
    super(message);
    this.name = "SdkSourceError";
  }
}

interface SearchState {
  deadline: number;
  files: SdkSourceEntry[];
  totalBytes: number;
}

interface SdkSourceEntry {
  path: string;
  absolutePath: string;
}

function isAllowedFile(filePath: string): boolean {
  const basename = path.posix.basename(filePath);
  const extension = path.posix.extname(filePath).toLowerCase();
  return ALLOWED_ROOT_FILES.has(basename) || ALLOWED_EXTENSIONS.has(extension);
}

function normalizeRelativePath(value: string, allowTrailingSlash = false): string {
  const normalizedInput = value.trim().replaceAll("\\", "/");
  const withoutTrailingSlash = allowTrailingSlash ? normalizedInput.replace(/\/+$/, "") : normalizedInput;
  const parts = withoutTrailingSlash.split("/");
  if (
    !withoutTrailingSlash ||
    normalizedInput.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalizedInput) ||
    normalizedInput.includes("\0") ||
    parts.includes("..") ||
    parts.includes("")
  ) {
    throw new SdkSourceError("sdk_source_path_invalid", "Source path must stay inside the SDK repository");
  }

  const normalized = path.posix.normalize(withoutTrailingSlash);
  if (normalized === ".") {
    throw new SdkSourceError("sdk_source_path_invalid", "Source path must stay inside the SDK repository");
  }
  return normalized;
}

function clip(text: string, limit = MAX_RESULT_CHARS): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return {
    text: `${text.slice(0, limit)}\n\n[truncated at ${limit} characters]`,
    truncated: true
  };
}

export function clipSdkText(text: string, limit = MAX_RESULT_CHARS): { text: string; truncated: boolean } {
  return clip(text, limit);
}

export class SdkSource {
  private readonly rootDirectory: string;
  private readonly revision?: string;
  private readonly digest?: string;
  private root?: string;
  private verifiedDigest?: string;
  private manifest?: readonly SdkSourceEntry[];
  private manifestPromise?: Promise<readonly SdkSourceEntry[]>;

  constructor(options: SdkSourceOptions) {
    this.rootDirectory = path.resolve(options.rootDirectory);
    this.revision = options.revision;
    this.digest = options.digest?.toLowerCase();
  }

  async prepare(): Promise<void> {
    await this.ensureRoot();
    await this.verifyDigest();
  }

  async isReady(): Promise<boolean> {
    try {
      await this.prepare();
      return true;
    } catch {
      return false;
    }
  }

  async read(relativePath: string): Promise<SdkSourceFile> {
    await this.prepare();
    const resolved = await this.safePath(relativePath);
    try {
      const content = await fs.readFile(resolved.realTarget, "utf8");
      if (Buffer.byteLength(content, "utf8") > MAX_SOURCE_FILE_BYTES) {
        throw new SdkSourceError("sdk_source_file_unavailable", "SDK source file exceeds the size limit");
      }
      return { path: resolved.normalized, content };
    } catch (error) {
      if (error instanceof SdkSourceError) throw error;
      throw new SdkSourceError("sdk_source_file_unavailable", "SDK source file is unavailable");
    }
  }

  async search(query: string, pathPrefix: string | undefined, maxResults = 30): Promise<SdkSearchMatch[]> {
    await this.prepare();
    const needle = query.trim().toLowerCase();
    if (!needle) {
      throw new SdkSourceError("sdk_source_path_invalid", "Search query must not be empty");
    }

    const prefix = pathPrefix ? normalizeRelativePath(pathPrefix, true) : undefined;
    const manifest = await this.getManifest();

    const matches: SdkSearchMatch[] = [];
    const state: SearchState = { deadline: Date.now() + SEARCH_DEADLINE_MS, files: [], totalBytes: 0 };
    for (const entry of manifest) {
      this.checkDeadline(state);
      if (prefix && entry.path !== prefix && !entry.path.startsWith(`${prefix}/`)) continue;

      const realTarget = await this.resolveManifestTarget(entry);
      if (!realTarget) continue;

      let content: string;
      try {
        content = await fs.readFile(realTarget, "utf8");
        if (Buffer.byteLength(content, "utf8") > MAX_SOURCE_FILE_BYTES) continue;
      } catch {
        continue;
      }

      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        this.checkDeadline(state);
        if (!lines[index].toLowerCase().includes(needle)) continue;
        const start = Math.max(0, index - 1);
        const end = Math.min(lines.length, index + 2);
        matches.push({
          path: entry.path,
          line: index + 1,
          snippet: clip(lines.slice(start, end).join("\n"), 4_000).text
        });
        if (matches.length >= Math.min(maxResults, MAX_SEARCH_RESULTS)) return matches;
      }
    }

    return matches;
  }

  async packageMetadata(): Promise<Record<string, unknown>> {
    const packageFile = await this.read("package.json");
    try {
      const parsed = JSON.parse(packageFile.content) as unknown;
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      return { parseError: "package.json is not valid JSON" };
    }
  }

  async status(): Promise<SdkSourceStatus> {
    await this.prepare();
    const metadata = await this.packageMetadata();
    const exportsValue = metadata.exports;
    const entrypoints =
      typeof exportsValue === "object" && exportsValue !== null ? Object.keys(exportsValue) : [];
    const manifest = await this.getManifest();

    return {
      revision: this.revision ?? null,
      sourceMode: "configured-directory",
      sourceDirectoryConfigured: true,
      package: {
        name: typeof metadata.name === "string" ? metadata.name : null,
        version: typeof metadata.version === "string" ? metadata.version : null,
        entrypoints
      },
      fileCount: manifest.length,
      namespaces: SDK_NAMESPACES
    };
  }

  private async ensureRoot(): Promise<string> {
    if (this.root) return this.root;

    try {
      const realRoot = await fs.realpath(this.rootDirectory);
      if (!(await fs.stat(realRoot)).isDirectory()) throw new Error("not a directory");
      this.root = realRoot;
      return realRoot;
    } catch {
      throw new SdkSourceError("sdk_source_unavailable", "SDK documentation source is unavailable");
    }
  }

  private async verifyDigest(): Promise<void> {
    if (!this.digest || this.verifiedDigest === this.digest) {
      return;
    }

    const manifest = await this.getManifest();
    const hash = createHash("sha256");

    try {
      for (const entry of manifest) {
        const realTarget = await this.resolveManifestTarget(entry);
        if (!realTarget) {
          throw new Error("SDK source entry is unavailable");
        }
        hash.update(entry.path, "utf8");
        hash.update("\0", "utf8");
        hash.update(await fs.readFile(realTarget));
        hash.update("\0", "utf8");
      }
    } catch {
      throw new SdkSourceError("sdk_source_unavailable", "SDK documentation source is unavailable");
    }

    if (hash.digest("hex") !== this.digest) {
      throw new SdkSourceError("sdk_source_integrity_mismatch", "SDK documentation source failed integrity verification");
    }

    this.verifiedDigest = this.digest;
  }

  private async getManifest(): Promise<readonly SdkSourceEntry[]> {
    const root = await this.ensureRoot();
    if (!this.digest) {
      return this.buildManifest(root);
    }

    if (this.manifest) return this.manifest;
    if (!this.manifestPromise) {
      this.manifestPromise = this.buildManifest(root).then((manifest) => {
        this.manifest = manifest;
        return manifest;
      });
    }

    try {
      return await this.manifestPromise;
    } catch (error) {
      this.manifestPromise = undefined;
      throw error;
    }
  }

  private async buildManifest(root: string): Promise<readonly SdkSourceEntry[]> {
    const state: SearchState = { deadline: Date.now() + SEARCH_DEADLINE_MS, files: [], totalBytes: 0 };
    await this.collectFiles(root, "", state);
    return state.files.sort((first, second) => (first.path < second.path ? -1 : first.path > second.path ? 1 : 0));
  }

  private async resolveManifestTarget(entry: SdkSourceEntry): Promise<string | null> {
    const root = await this.ensureRoot();
    try {
      const realTarget = await fs.realpath(entry.absolutePath);
      const relativeTarget = path.relative(root, realTarget);
      if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
        return null;
      }
      return realTarget;
    } catch {
      return null;
    }
  }

  private async safePath(relativePath: string): Promise<{ normalized: string; realTarget: string }> {
    const root = await this.ensureRoot();
    const normalized = normalizeRelativePath(relativePath);
    if (!isAllowedFile(normalized)) {
      throw new SdkSourceError(
        "sdk_source_path_invalid",
        "Only SDK text source, example, protocol, and metadata files are readable"
      );
    }

    try {
      const target = path.resolve(root, ...normalized.split("/"));
      const realTarget = await fs.realpath(target);
      const relativeTarget = path.relative(root, realTarget);
      if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
        throw new SdkSourceError("sdk_source_path_invalid", "Symlinked source paths are not readable");
      }
      const targetStats = await fs.stat(realTarget);
      if (!targetStats.isFile()) {
        throw new SdkSourceError("sdk_source_file_unavailable", "SDK source path is not a file");
      }
      if (targetStats.size > MAX_SOURCE_FILE_BYTES) {
        throw new SdkSourceError("sdk_source_file_unavailable", "SDK source file exceeds the size limit");
      }
      return { normalized, realTarget };
    } catch (error) {
      if (error instanceof SdkSourceError) throw error;
      throw new SdkSourceError("sdk_source_file_unavailable", "SDK source file is unavailable");
    }
  }

  private async collectFiles(directory: string, prefix: string, state: SearchState): Promise<void> {
    this.checkDeadline(state);
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      throw new SdkSourceError("sdk_source_unavailable", "SDK documentation source is unavailable");
    }

    for (const entry of entries) {
      this.checkDeadline(state);
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      if (state.files.length >= MAX_SEARCH_FILES) {
        throw new SdkSourceError("sdk_search_limit_exceeded", "SDK search source limits were exceeded");
      }

      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await this.collectFiles(target, relative, state);
        continue;
      }
      if (!entry.isFile() || !isAllowedFile(relative)) continue;

      try {
        const size = (await fs.stat(target)).size;
        if (size > MAX_SOURCE_FILE_BYTES) continue;
        if (state.totalBytes + size > MAX_SEARCH_SOURCE_BYTES) {
          throw new SdkSourceError("sdk_search_limit_exceeded", "SDK search source limits were exceeded");
        }
        state.totalBytes += size;
        state.files.push({
          path: relative.replaceAll("\\", "/"),
          absolutePath: target
        });
      } catch (error) {
        if (error instanceof SdkSourceError) throw error;
      }
    }
  }

  private checkDeadline(state: SearchState): void {
    if (Date.now() > state.deadline) {
      throw new SdkSourceError("sdk_search_limit_exceeded", "SDK search time limit was exceeded");
    }
  }
}

export function interfaceBlock(sourceText: string, interfaceName: string): string {
  const marker = `export interface ${interfaceName}`;
  const start = sourceText.indexOf(marker);
  if (start < 0) return "";
  const next = sourceText.indexOf("\nexport interface ", start + marker.length);
  return sourceText.slice(start, next < 0 ? sourceText.length : next).trim();
}

export function markdownSection(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/);
  const wanted = heading.toLowerCase();
  const headingAt = (line: string): { level: number; title: string } | null => {
    const match = line.trim().match(/^(#{2,6})\s+(.+?)\s*#*\s*$/);
    return match ? { level: match[1].length, title: match[2].trim().toLowerCase() } : null;
  };
  const start = lines.findIndex((line) => headingAt(line)?.title === wanted);
  if (start < 0) return "";
  const startHeading = headingAt(lines[start]);
  if (!startHeading) return "";
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const currentHeading = headingAt(lines[index]);
    if (currentHeading && currentHeading.level <= startHeading.level) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}
