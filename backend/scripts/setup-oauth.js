/**
 * One-time OAuth2 Setup Script
 * Run this to get your refresh token
 * 
 * Usage: node scripts/setup-oauth.js
 */

const { google } = require('googleapis');
const readline = require('readline');
require('dotenv').config();

// OAuth2 credentials from .env
const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  process.env.GMAIL_REDIRECT_URI
);

// Generate auth URL
const scopes = [
  'https://www.googleapis.com/auth/gmail.send'
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: scopes,
  prompt: 'consent' // Force consent screen to get refresh token
});

console.log('\n🔐 Gmail OAuth 2.0 Setup');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('Step 1: Open this URL in your browser:\n');
console.log(authUrl);
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('Step 2: Sign in with 876nurses@gmail.com');
console.log('Step 3: Grant permissions');
console.log('Step 4: Copy the authorization code from the URL\n');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Paste the authorization code here: ', async (code) => {
  try {
    const { tokens } = await oauth2Client.getToken(code);
    
    console.log('\n✅ Success! Your refresh token:\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(tokens.refresh_token);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('Add this to your .env file as:\n');
    console.log(`GMAIL_REFRESH_TOKEN=REDACTED
    console.log('⚠️  Keep this token secure! It gives access to send emails.\n');
  } catch (error) {
    console.error('❌ Error getting tokens:', error.message);
  }
  
  rl.close();
});
