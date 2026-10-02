type ReleaseFileSystem = {
  readFile: (path: string) => Promise<Buffer>;
  writeFile: (path: string, data: Uint8Array | string) => Promise<void>;
  mkdir: (path: string, options?: { recursive?: boolean }) => Promise<string | undefined>;
  rmdir: (path: string) => Promise<void>;
  rename: (oldPath: string, newPath: string) => Promise<void>;
  rm: (path: string, options?: { force?: boolean; recursive?: boolean }) => Promise<void>;
  lstat: (path: string) => Promise<{ isFile(): boolean; isDirectory(): boolean }>;
  readdir: (path: string) => Promise<Array<string | { name: string }>>;
};

export declare function prepareRelease(input: {
  projectDir: string;
  fileSystem?: ReleaseFileSystem;
  fs?: ReleaseFileSystem;
}): Promise<{
  version: string;
  sha256: string;
  changed: boolean;
}>;
