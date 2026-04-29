import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from '../password.js';

describe('password hashing', () => {
  it('hashes passwords with argon2id', async () => {
    const hash = await hashPassword('CorrectHorseBatteryStaple1!');

    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('verifies the correct password', async () => {
    const hash = await hashPassword('CorrectHorseBatteryStaple1!');

    await expect(verifyPassword('CorrectHorseBatteryStaple1!', hash)).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('CorrectHorseBatteryStaple1!');

    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false);
  });

  it('does not return plaintext as the hash', async () => {
    const password = 'CorrectHorseBatteryStaple1!';
    const hash = await hashPassword(password);

    expect(hash).not.toBe(password);
  });
});
