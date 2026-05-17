import { PasswordHasher } from './password-hasher.service';

describe(PasswordHasher.name, () => {
  const passwordHasher = new PasswordHasher();

  it('hashes and verifies with Argon2id', async () => {
    const password = 'correct horse battery staple';
    const hashedPassword = await passwordHasher.hash(password);

    expect(hashedPassword).toContain('$argon2id$');
    await expect(passwordHasher.verify(hashedPassword, password)).resolves.toBe(true);
    await expect(passwordHasher.verify(hashedPassword, 'wrong password')).resolves.toBe(false);
  });
});

