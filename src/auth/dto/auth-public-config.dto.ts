export class AuthGoogleSsoConfigDto {
  clientId!: string | null;
  enabled!: boolean;
}

export class AuthPublicConfigDto {
  googleSso!: AuthGoogleSsoConfigDto;
}
