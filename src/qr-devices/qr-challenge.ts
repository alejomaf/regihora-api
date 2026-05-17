import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export type QrChallengePayload = {
  devicePublicId: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
};

export type QrChallengeUnsignedPayload = Omit<QrChallengePayload, 'signature'>;

export function createQrDevicePublicId(): string {
  return `qrd_${randomBytes(16).toString('base64url')}`;
}

export function createQrChallengeNonce(): string {
  return randomBytes(18).toString('base64url');
}

export function signQrChallenge(
  challenge: QrChallengeUnsignedPayload,
  deviceTokenHash: string,
): string {
  return createHmac('sha256', deviceTokenHash)
    .update(getCanonicalQrChallengeMessage(challenge))
    .digest('hex');
}

export function isQrChallengeSignatureValid(
  challenge: QrChallengePayload,
  deviceTokenHash: string,
): boolean {
  const expectedSignature = signQrChallenge(
    {
      devicePublicId: challenge.devicePublicId,
      expiresAt: challenge.expiresAt,
      issuedAt: challenge.issuedAt,
      nonce: challenge.nonce,
    },
    deviceTokenHash,
  );
  const actual = Buffer.from(challenge.signature, 'hex');
  const expected = Buffer.from(expectedSignature, 'hex');

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function getQrChallengeId(challenge: QrChallengePayload): string {
  return createHash('sha256')
    .update(`${challenge.devicePublicId}.${challenge.nonce}`)
    .digest('hex');
}

function getCanonicalQrChallengeMessage(
  challenge: QrChallengeUnsignedPayload,
): string {
  return [
    challenge.devicePublicId,
    challenge.nonce,
    challenge.issuedAt,
    challenge.expiresAt,
  ].join('\n');
}
