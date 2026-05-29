require('dotenv').config();
const gmailService = require('../services/gmailService');

(async () => {
  try {
    console.log('Sending test welcome email to morris.kadian@yahoo.com...\n');
    const result = await gmailService.sendWelcomeEmail({
      email: 'morris.kadian@yahoo.com',
      name: 'Kadian Morris'
    });
    
    if (result.success) {
      console.log('✅ Welcome email sent successfully!');
      console.log('Check your inbox at morris.kadian@yahoo.com\n');
    } else {
      console.log('❌ Failed to send email:', result.error);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
})();
