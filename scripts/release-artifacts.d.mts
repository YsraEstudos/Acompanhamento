export declare function validateReleaseArtifacts(input: {
  projectDir: string;
  location?: 'dist' | 'published' | 'both';
  distribution?: 'dist' | 'published' | 'both';
  target?: 'dist' | 'published' | 'both';
  published?: boolean;
}): Promise<{
  version: string;
  sha256: string;
}>;
