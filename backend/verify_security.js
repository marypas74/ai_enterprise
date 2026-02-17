const axios = require('axios');
const { authenticator } = require('otplib');

const API_URL = 'http://localhost:3000/api'; // Adjust port if needed, assuming backend port-forward or similar access
// Since running from outside K8s, might need port-forward. For now assume running INSIDE container or network access.
// Verification script intended to run FROM LOCAL MACHINE assuming port-forward to backend service.

async function runTests() {
    try {
        console.log('--- 1. Register/Login Test User ---');
        // ...
    } catch (error) {
        console.error('Test failed:', error.response ? error.response.data : error.message);
    }
}

// Since I cannot trust local connectivity to k8s service IP directly without port-forward,
// I will run this script INSIDE the backend container using `kubectl exec`.
// The script needs to use `localhost:3000` (internal to pod).
// Also need `axios` and `otplib` installed in the container?
// They are in `node_modules` of `/app`.
// So I can write this file to the container and run it.

// Let's create a simpler script that uses standard `http` or `fetch` if available (Node 18+ has fetch).
// Backend is Node 20 so `fetch` is available.
// `otplib` is installed in `/app/node_modules`.

const script = `
const { authenticator } = require('otplib');

const BASE_URL = 'http://localhost:3000/api';
let adminToken = '';
let userToken = '';
let mfaSecret = '';

async function request(method, path, body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = \`Bearer \${token}\`;
  
  const opts = {
    method,
    headers,
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(\`\${BASE_URL}\${path}\`, opts);
  const data = await res.json();
  return { status: res.status, data, headers: res.headers };
}

async function run() {
  console.log('>>> STARTING SECURITY VERIFICATION <<<');

  // 1. Login as Admin (to get token for later)
  console.log('\\n1. Login Admin...');
  const loginRes = await request('POST', '/auth/login', {
    email: 'admin@enterprise.local',
    password: 'admin123'
  });
  console.log('Status:', loginRes.status);
  if (loginRes.status !== 200) throw new Error('Admin login failed');
  adminToken = loginRes.data.accessToken;
  console.log('Admin Token acquired.');

  // 2. Register a Test User
  const testEmail = \`test\${Date.now()}@example.com\`;
  console.log(\`\\n2. Register Test User (\${testEmail})...\`);
  const regRes = await request('POST', '/auth/register', {
    email: testEmail,
    password: 'password123',
    name: 'Test User'
  });
  console.log('Status:', regRes.status, regRes.data);

  // 3. Login Test User (Session 1) - Checks Geo-Tracking
  console.log('\\n3. Login Test User (Session 1) - Geo Check...');
  const login1 = await request('POST', '/auth/login', {
    email: testEmail,
    password: 'password123'
  });
  console.log('Status:', login1.status);
  userToken = login1.data.accessToken;
  
  if (!userToken) throw new Error('Login failed');

  // 4. Verify Session in Admin List
  console.log('\\n4. Check Admin Sessions List...');
  const sessionsRes = await request('GET', '/auth/sessions', null, adminToken); // Note: path changed to /auth/sessions in routes
  console.log('Sessions count:', sessionsRes.data.sessions?.length);
  const mySession = sessionsRes.data.sessions.find(s => s.email === testEmail);
  if (mySession) {
    console.log('Session found:', { ip: mySession.ip_address, ua: mySession.user_agent });
  } else {
    console.error('Session NOT found in list!');
  }

  // 5. MFA Setup
  console.log('\\n5. MFA Setup...');
  const mfaSetupCalls = await request('POST', '/auth/mfa/setup', null, userToken);
  console.log('Status:', mfaSetupCalls.status);
  if (mfaSetupCalls.status !== 200) throw new Error('MFA setup failed');
  mfaSecret = mfaSetupCalls.data.secret;
  console.log('MFA Secret:', mfaSecret);

  // 6. MFA Verify Setup
  console.log('\\n6. MFA Verify Setup...');
  const token1 = authenticator.generate(mfaSecret);
  const mfaVerifyRes = await request('POST', '/auth/mfa/verify-setup', { totp_code: token1 }, userToken);
  console.log('Status:', mfaVerifyRes.status, mfaVerifyRes.data);
  if (!mfaVerifyRes.data.success) throw new Error('MFA verification failed');

  // 7. Login with MFA
  console.log('\\n7. Login with MFA...');
  // First try without code
  const loginMfaFail = await request('POST', '/auth/login', {
    email: testEmail,
    password: 'password123'
  });
  console.log('Login without code status:', loginMfaFail.status, loginMfaFail.data); // Expect 200 with mfa_required=true
  
  if (!loginMfaFail.data.mfa_required) console.error('Expected mfa_required=true');

  // Now with code
  const token2 = authenticator.generate(mfaSecret);
  const loginMfaSuccess = await request('POST', '/auth/login', {
    email: testEmail,
    password: 'password123',
    totp_code: token2
  });
  console.log('Login with code status:', loginMfaSuccess.status);
  if (loginMfaSuccess.status !== 200 || !loginMfaSuccess.data.accessToken) {
    console.error('MFA Login failed');
  } else {
    console.log('MFA Login success');
    userToken = loginMfaSuccess.data.accessToken; // New session
  }

  // 8. Single Session Enforcement
  console.log('\\n8. Single Session Check...');
  // Current userToken is from Session 2 (MFA login).
  // Let's create Session 3.
  const token3 = authenticator.generate(mfaSecret);
  const login3 = await request('POST', '/auth/login', {
      email: testEmail,
      password: 'password123',
      totp_code: token3
  });
  console.log('Session 3 created status:', login3.status);
  
  // Now verify Session 2 token is invalid (or at least the refresh token is revoked in DB).
  // Since JWTs are stateless, the *access token* might still work until expiry, 
  // but let's check the *admin sessions list* to see if only 1 session exists for this user.
  
  const sessionsRes2 = await request('GET', '/auth/sessions', null, adminToken);
  const userSessions = sessionsRes2.data.sessions.filter(s => s.email === testEmail);
  console.log('Active sessions for user:', userSessions.length);
  if (userSessions.length === 1) {
    console.log('SUCCESS: Only 1 active session found.');
  } else {
    console.error('FAILURE: Found multiple sessions:', userSessions.length);
  }

  // 9. Admin Terminate Session
  console.log('\\n9. Admin Terminate Session...');
  const sessionId = userSessions[0]?.id;
  if (sessionId) {
    const delRes = await request('DELETE', \`/auth/sessions/\${sessionId}\`, null, adminToken);
    console.log('Terminate status:', delRes.status);
  }

  console.log('\\n>>> VERIFICATION COMPLETE <<<');
}

run().catch(console.error);
`;

console.log(script);
