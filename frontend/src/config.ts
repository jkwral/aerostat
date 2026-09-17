import { Amplify } from 'aws-amplify';

const userPoolId = import.meta.env.VITE_USER_POOL_ID;
const userPoolClientId = import.meta.env.VITE_USER_POOL_CLIENT_ID;
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

if (!userPoolId || !userPoolClientId || !API_BASE_URL) {
  throw new Error(
    'Missing VITE_USER_POOL_ID / VITE_USER_POOL_CLIENT_ID / VITE_API_BASE_URL. ' +
      'Copy .env.example to .env.local and fill in the values from the CDK deploy outputs.',
  );
}

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId,
      userPoolClientId,
    },
  },
});
