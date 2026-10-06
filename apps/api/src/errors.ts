export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function translateError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/PAGE_TOO_LARGE/.test(message))
    return new AppError(
      413,
      'VALUE_TOO_LARGE',
      'This collection page exceeds 1 MiB. Use redis-cli to inspect it safely.',
    );
  if (/WRONGPASS|NOAUTH/i.test(message))
    return new AppError(
      401,
      'REDIS_AUTH',
      'Redis rejected the credentials. Check the username and password.',
    );
  if (/NOPERM/i.test(message))
    return new AppError(
      403,
      'REDIS_PERMISSION',
      'The Redis ACL user does not have permission for this operation.',
    );
  if (/WRONGTYPE/i.test(message))
    return new AppError(409, 'TYPE_CHANGED', 'The key type changed. Refresh before editing.');
  if (/CONFLICT/.test(message))
    return new AppError(
      409,
      'CONFLICT',
      'This data changed since you opened it. Refresh to see the latest value.',
    );
  if (/MISSING|no such key/.test(message))
    return new AppError(404, 'KEY_NOT_FOUND', 'This key was deleted or expired.');
  if (/EXISTS/.test(message))
    return new AppError(409, 'KEY_EXISTS', 'A key with this name already exists.');
  if (/certificate|TLS|SSL|self.signed/i.test(message))
    return new AppError(
      502,
      'TLS_ERROR',
      'TLS verification failed. Check the hostname and CA certificate.',
    );
  return new AppError(
    502,
    'REDIS_UNAVAILABLE',
    'Could not complete the Redis operation. Check the connection and try again.',
  );
}
