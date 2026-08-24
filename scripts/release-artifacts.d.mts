export declare function validateReleaseArtifacts(input: {
  projectDir: string;
}): Promise<{
  version: string;
  sha256: string;
}>;
