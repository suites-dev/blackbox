export type Diagnostic = Readonly<{ code: string; path: string; message: string }>;

/** Acceptance concerns submitted records only. It is not an assurance verdict. */
export type ValidationResult =
  | Readonly<{ kind: 'rejected'; diagnostics: ReadonlyArray<Diagnostic> }>
  | Readonly<{
      kind: 'accepted'; qualification: 'structure-and-receipt-links-only';
      provenance: 'example' | 'runner';
    }>;

export function problem(code: string, path: string, message: string): Diagnostic {
  return { code, path, message };
}
