/**
 * Test Email Script
 * Quick test to verify email service is working
 * 
 * Usage: node scripts/test-email.js your-email@example.com
 */

require('dotenv').config();
const gmailService = require('../services/gmailService');

const testEmail = process.argv[2];

if (!testEmail) {
  console.error('❌ Please provide a test email address');
  console.log('Usage: node scripts/test-email.js your-email@example.com');
  process.exit(1);
}

async function runTest() {
  console.log('\n📧 Testing Email Service...\n');
  console.log(`Sending test email to: ${testEmail}`);

  try {
    const result = await gmailService.testConfiguration(testEmail);
    
    console.log('\n✅ Test email sent successfully!\n');
    console.log('Details:');
    console.log(`  Message ID: ${result.messageId}`);
    console.log(`  Timestamp: ${result.timestamp}`);
    console.log('\nCheck your inbox to confirm receipt.\n');
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('\nPossible issues:');
    console.error('  1. Check your .env file has correct credentials');
    console.error('  2. Verify GMAIL_REFRESH_TOKEN is valid');
    console.error('  3. Ensure Gmail API is enabled in Google Cloud Console');
    console.error('  4. Check OAuth2 consent screen is configured\n');
    process.exit(1);
  }
}

runTest();
