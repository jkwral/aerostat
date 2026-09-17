import type { PreSignUpTriggerHandler } from 'aws-lambda';

const ALLOWED_DOMAIN = '@wral.com';

export const handler: PreSignUpTriggerHandler = async (event) => {
  const email = event.request.userAttributes.email ?? '';

  if (!email.toLowerCase().endsWith(ALLOWED_DOMAIN)) {
    throw new Error(`Sign-up is restricted to ${ALLOWED_DOMAIN} email addresses.`);
  }

  return event;
};
