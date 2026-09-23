/** Kullanıcıya olduğu gibi gösterilecek, stack trace gerektirmeyen hata. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
