import { Amplify } from 'aws-amplify';

const userPoolId = import.meta.env.VITE_USER_POOL_ID;
const userPoolClientId = import.meta.env.VITE_USER_POOL_CLIENT_ID;
export const UPLOAD_API_BASE_URL = import.meta.env.VITE_UPLOAD_API_BASE_URL;
export const REVIEW_API_BASE_URL = import.meta.env.VITE_REVIEW_API_BASE_URL;

if (!userPoolId || !userPoolClientId || !UPLOAD_API_BASE_URL || !REVIEW_API_BASE_URL) {
  throw new Error(
    'Missing VITE_USER_POOL_ID / VITE_USER_POOL_CLIENT_ID / VITE_UPLOAD_API_BASE_URL / ' +
      'VITE_REVIEW_API_BASE_URL. Copy .env.example to .env.local and fill in the values from ' +
      'the CDK deploy outputs.',
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
