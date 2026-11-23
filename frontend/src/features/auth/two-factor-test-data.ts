/** Shared fixtures for the G1a two-factor tests (vitest). */
export const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
export const OTPAUTH_URI = `otpauth://totp/Corner%20Shop:rahim%40corner.test?secret=${SECRET}&issuer=Corner%20Shop&algorithm=SHA1&digits=6&period=30`
export const RECOVERY_CODES = [
  'abcde-23456', 'fghjk-34567', 'mnpqr-45678', 'stuvw-56789', 'xyz23-67892',
  'abcde-78923', 'fghjk-89234', 'mnpqr-92345', 'stuvw-23457', 'xyz23-34568',
]
