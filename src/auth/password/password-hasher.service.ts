import { Injectable } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';

@Injectable()
export class PasswordHasher {
  async hash(value: string): Promise<string> {
    return hash(value, {
      memoryCost: 19_456,
      parallelism: 1,
      timeCost: 2,
      type: argon2id,
    });
  }

  async verify(hashValue: string, plainValue: string): Promise<boolean> {
    return verify(hashValue, plainValue);
  }
}

