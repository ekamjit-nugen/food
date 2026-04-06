/**
 * Shared password validation — mirrors the server's PasswordSchema in
 * auth.schemas.ts so the client rejects invalid passwords before they
 * hit the wire.
 *
 * Rules (NIST 800-63B length-over-complexity):
 *   - Minimum 10 characters
 *   - At least one letter (a-z or A-Z)
 *   - At least one digit (0-9)
 *   - Maximum 128 characters
 */
export function validatePassword(password: string): { valid: boolean; error?: string } {
  if (password.length < 10) {
    return { valid: false, error: 'Password must be at least 10 characters' };
  }
  if (password.length > 128) {
    return { valid: false, error: 'Password is too long' };
  }
  if (!/[a-zA-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one letter' };
  }
  if (!/\d/.test(password)) {
    return { valid: false, error: 'Password must contain at least one number' };
  }
  return { valid: true };
}

export const PASSWORD_HINT = 'At least 10 characters with a letter and a number.';
