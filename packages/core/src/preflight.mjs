import { applyMapping } from './mapping.mjs';
import { validateInvoiceIntent } from './validation.mjs';

export function preflightRows(rows, profile) {
  const results = rows.map((row, index) => {
    try {
      const intent = applyMapping(row, profile);
      const validation = validateInvoiceIntent(intent);
      return {
        row: index + 2,
        status: validation.ok ? 'valid' : 'invalid',
        errors: validation.errors,
        warnings: validation.warnings,
        preview: intent,
      };
    } catch (error) {
      return {
        row: index + 2,
        status: 'invalid',
        errors: [{
          code: 'VF_MAPPING_ERROR',
          path: '',
          severity: 'error',
          message: { es: error.message, en: error.message },
        }],
        warnings: [],
      };
    }
  });

  const valid = results.filter((result) => result.status === 'valid').length;
  const invalid = results.length - valid;
  return {
    mode: 'dry-run',
    ok: invalid === 0,
    summary: { rows: results.length, valid, invalid },
    rows: results,
  };
}
