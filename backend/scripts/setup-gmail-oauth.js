/**
 * Gmail OAuth2 Setup Script
 * 
 * This script helps you generate a Refresh Token for Gmail API.
 * 
 * Usage: node scripts/setup-gmail-oauth.js
 */

require('dotenv').config();
const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

// Configuration
const PORT = 3000;
const REDIRECT_URI = `http://localhost:${PORT}/auth/google/callback`;

const clientId = process.env.GMAIL_CLIENT_ID;
const clientSecret = process.env.GMAIL_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('❌ Missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET in .env file');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  clientId,
  clientSecret,
  REDIRECT_URI
);

// Generate Auth URL
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/userinfo.email'
  ],
  prompt: 'consent' // Force consent to ensure we get a refresh token
});

console.log('\n📧 Gmail OAuth2 Setup\n');
console.log('1. Ensure your Google Cloud Project has Gmail API enabled.');
console.log(`2. Ensure your OAuth Consent Screen is configured.`);
console.log(`3. Ensure "${REDIRECT_URI}" is added to Authorized Redirect URIs in Google Cloud Console.\n`);

console.log('Opening browser to authorize...');
console.log(`If browser doesn't open, visit this URL manually:\n${authUrl}\n`);

// Start local server to handle callback
const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/auth/google/callback')) {
      const queryObject = url.parse(req.url, true).query;
      const { code } = queryObject;

      if (code) {
        console.log('✅ Authorization code received');
        
        // Get tokens
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        // Get user email
        const oauth2 = google.oauth2({ auth: oauth2Client, version: 'v2' });
        const { data: userInfo } = await oauth2.userinfo.get();
        
        console.log('\n🎉 Success! Here are your tokens:\n');
        console.log('----------------------------------------');
        console.log(`Authenticated as: ${userInfo.email}`);
        console.log(`Refresh Token: ${tokens.refresh_token}`);
        console.log('----------------------------------------\n');
        
        if (tokens.refresh_token) {
          console.log('✅ Copy the Refresh Token above and update your .env file:');
          console.log(`GMAIL_REFRESH_TOKEN=REDACTED
          
          if (userInfo.email !== process.env.GMAIL_ACCOUNT) {
             console.log('\n⚠️ WARNING: The authenticated email does not match GMAIL_ACCOUNT in .env!');
             console.log(`Expected: ${process.env.GMAIL_ACCOUNT}`);
             console.log(`Actual:   ${userInfo.email}`);
             console.log('Please update GMAIL_ACCOUNT in .env to match, or re-run this script with the correct account.');
          }

        } else {
          console.log('⚠️ No refresh token received. Did you already authorize?');
          console.log('Try revoking access for this app in your Google Account permissions and try again.');
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authentication Successful!</h1><p>You can close this window and check your terminal.</p>');
        
        server.close();
        process.exit(0);
      }
    }
  } catch (error) {
    console.error('❌ Error during authentication:', error.message);
    res.writeHead(500);
    res.end('Authentication failed');
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`Listening on port ${PORT}...`);
  // Try to open browser
  import('open').then(openModule => {
    openModule.default(authUrl);
  }).catch(() => {
    console.log('Please open the URL above manually.');
  });
});
