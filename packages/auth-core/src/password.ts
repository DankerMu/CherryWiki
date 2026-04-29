import argon2 from 'argon2';
import bcrypt from 'bcrypt';

const BCRYPT_PREFIXES = ['$2a$', '$2b$', '$2y$'] as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    if (hash.startsWith('$argon2')) {
      return await argon2.verify(hash, password);
    }

    if (BCRYPT_PREFIXES.some((prefix) => hash.startsWith(prefix))) {
      return await bcrypt.compare(password, hash);
    }

    return false;
  } catch {
    return false;
  }
}
