import { generate, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';

const BASE_URL = 'http://localhost:3000/api';
let adminToken = '';
let userToken = '';
let mfaSecret = '';

// Helper for Google Auth compatible token generation
async function generateToken(secret) {
    const token = await generate({
        secret,
        createDigest: NobleCryptoPlugin,
        keyDecoder: ScureBase32Plugin
    });
    console.log('Generated token for secret:', secret.substring(0, 5) + '...', '->', token);
    return String(token);
}

async function request(method, path, body = null, token = null) {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const opts = {
        method,
        headers,
    };
    if (body) {
        opts.body = JSON.stringify(body);
        headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${BASE_URL}${path}`, opts);
    const data = await res.json();
    return { status: res.status, data, headers: res.headers };
}

async function run() {
    console.log('>>> STARTING SECURITY VERIFICATION (ESM) <<<');

    // 1. Login as Admin
    console.log('\n1. Login Admin...');
    const loginRes = await request('POST', '/auth/login', {
        email: 'admin@enterprise.local',
        password: 'admin123'
    });
    console.log('Status:', loginRes.status);
    if (loginRes.status !== 200) throw new Error('Admin login failed');
    adminToken = loginRes.data.accessToken;
    console.log('Admin Token acquired.');

    // 2. Register a Test User
    const testEmail = `test${Date.now()}@example.com`;
    console.log(`\n2. Register Test User (${testEmail})...`);
    const regRes = await request('POST', '/auth/register', {
        email: testEmail,
        password: 'password123',
        name: 'Test User'
    });
    console.log('Status:', regRes.status);

    // 3. Login Test User (Session 1)
    console.log('\n3. Login Test User (Session 1) - Geo Check...');
    const login1 = await request('POST', '/auth/login', {
        email: testEmail,
        password: 'password123'
    });
    console.log('Status:', login1.status);
    userToken = login1.data.accessToken;

    // 4. Verify Session in Admin List
    console.log('\n4. Check Admin Sessions List...');
    const sessionsRes = await request('GET', '/auth/sessions', null, adminToken);
    console.log('Sessions count:', sessionsRes.data.sessions?.length);
    const mySession = sessionsRes.data.sessions.find(s => s.email === testEmail);
    if (mySession) {
        console.log('Session found:', { ip: mySession.ip_address, ua: mySession.user_agent, country: mySession.country });
    } else {
        console.error('Session NOT found in list!');
    }

    // 5. MFA Setup
    console.log('\n5. MFA Setup...');
    const mfaSetupCalls = await request('POST', '/auth/mfa/setup', {}, userToken);
    console.log('Status:', mfaSetupCalls.status);
    if (mfaSetupCalls.status !== 200) throw new Error('MFA setup failed');
    mfaSecret = mfaSetupCalls.data.secret;
    console.log('MFA Secret:', mfaSecret);

    // 6. MFA Verify Setup
    console.log('\n6. MFA Verify Setup...');
    // Use generate(secret) from otplib
    const token1 = await generateToken(mfaSecret);
    const mfaVerifyRes = await request('POST', '/auth/mfa/verify-setup', { totp_code: token1 }, userToken);
    console.log('Status:', mfaVerifyRes.status);
    if (!mfaVerifyRes.data.success) throw new Error('MFA verification failed');

    // 7. Login with MFA
    console.log('\n7. Login with MFA...');
    // First try without code
    const loginMfaFail = await request('POST', '/auth/login', {
        email: testEmail,
        password: 'password123'
    });
    console.log('Login without code status:', loginMfaFail.status, loginMfaFail.data);

    // Now with code
    const token2 = await generateToken(mfaSecret);
    const loginMfaSuccess = await request('POST', '/auth/login', {
        email: testEmail,
        password: 'password123',
        totp_code: token2
    });
    console.log('Login with code status:', loginMfaSuccess.status);
    if (loginMfaSuccess.status === 200) {
        console.log('MFA Login success');
        userToken = loginMfaSuccess.data.accessToken;
    } else {
        console.error('MFA Login failed');
    }

    // 8. Single Session Check
    console.log('\n8. Single Session Check...');
    const token3 = await generateToken(mfaSecret);
    const login3 = await request('POST', '/auth/login', {
        email: testEmail,
        password: 'password123',
        totp_code: token3
    });
    console.log('Session 3 created status:', login3.status);

    const sessionsRes2 = await request('GET', '/auth/sessions', null, adminToken);
    const userSessions = sessionsRes2.data.sessions.filter(s => s.email === testEmail);
    console.log('Active sessions for user:', userSessions.length);
    if (userSessions.length === 1) {
        console.log('SUCCESS: Only 1 active session found.');
    } else {
        console.error('FAILURE: Found multiple sessions:', userSessions.length);
    }

    // 9. Terminate
    console.log('\n9. Admin Terminate Session...');
    const sessionId = userSessions[0]?.id;
    if (sessionId) {
        const delRes = await request('DELETE', `/auth/sessions/${sessionId}`, null, adminToken);
        console.log('Terminate status:', delRes.status);
    }

    console.log('\n>>> VERIFICATION COMPLETE <<<');
}

run().catch(console.error);
