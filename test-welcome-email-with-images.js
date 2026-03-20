/**
 * Test script to send a welcome email with healthcare images
 * This tests the complete HTML email template with all visual elements
 */

const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-key.json');

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'nurses-afb7e',
  storageBucket: 'nurses-afb7e.firebasestorage.app'
});

const db = admin.firestore();

async function sendTestWelcomeEmail() {
  console.log('🧪 Testing Welcome Email with Healthcare Images...\n');

  const recipientEmail =
    process.argv[2] ||
    process.env.TEST_EMAIL_TO ||
    'morris17kadian@gmail.com';

  // Test user data
  const testUser = {
    email: recipientEmail,
    displayName: 'Kadian Thompson',
    uid: 'test-uid-' + Date.now()
  };

  console.log('📧 Sending welcome email to:', testUser.email);
  console.log('👤 User name:', testUser.displayName);
  
  // Image URLs that will be tested
  const logoUrl = 'https://storage.googleapis.com/nurses-afb7e.firebasestorage.app/email-assets/876nurses-logo.png';
  const nurseElderlyImage = 'https://storage.googleapis.com/nurses-afb7e.firebasestorage.app/email-assets/nurse-elderly-care.jpg';
  const handsCompassionImage = 'https://storage.googleapis.com/nurses-afb7e.firebasestorage.app/email-assets/hands-compassion.jpg';
  const homeCareTeamImage = 'https://storage.googleapis.com/nurses-afb7e.firebasestorage.app/email-assets/home-care-team.jpg';
  const headerConfettiImage = 'https://storage.googleapis.com/nurses-afb7e.firebasestorage.app/email-assets/header-confetti-v2.png';
  // Middle image in the 3-photo strip (separate from the full-width featured image)
  const middleStripImage = 'https://storage.googleapis.com/nurses-afb7e.firebasestorage.app/email-assets/middle-strip-v1.jpg';

  console.log('\n🖼️  Images to be displayed:');
  console.log('   - Logo (80px):', logoUrl);
  console.log('   - Nurse & Elderly:', nurseElderlyImage);
  console.log('   - Hands Compassion:', handsCompassionImage);
  console.log('   - Home Care Team:', homeCareTeamImage);
  console.log('   - Header Background:', headerConfettiImage);
  console.log('   - Middle Strip Image:', middleStripImage);

  const firstName = testUser.displayName?.split(' ')[0] || 'Friend';
  const logoBlock = `<img src="${logoUrl}" alt="876 Nurses" width="80" align="center" style="display:block;width:80px;height:auto;border:none;outline:none;margin:0 auto;" />`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Welcome to 876 Nurses</title>
    </head>
    <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f5f5f5;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f5f5;padding:40px 0;">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">

              <!-- Combined Logo + Header (Background Image) -->
              <tr>
                <td align="center" valign="middle" background="${headerConfettiImage}" style="padding:0;text-align:center;background-color:#ffffff;background-image:url('${headerConfettiImage}');background-repeat:no-repeat;background-position:center;background-size:cover;">
                  <!--[if gte mso 9]>
                  <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;height:210px;">
                    <v:fill type="frame" src="${headerConfettiImage}" color="#ffffff" />
                    <v:textbox inset="0,0,0,0">
                  <![endif]-->
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
                    <tr>
                      <td align="center" style="padding:28px 24px 12px 24px;">
                        ${logoBlock}
                      </td>
                    </tr>
                    <tr>
                      <td align="center" style="padding:0 24px 28px 24px;">
                        <h1 style="margin:0;font-size:32px;font-weight:700;color:#000000;line-height:1.2;">Welcome to 876 Nurses</h1>
                      </td>
                    </tr>
                  </table>
                  <!--[if gte mso 9]>
                    </v:textbox>
                  </v:rect>
                  <![endif]-->
                </td>
              </tr>

              <!-- Main Content -->
              <tr>
                <td style="padding:32px 24px 0 24px;">
                  
                  <p style="margin:0 0 8px 0;font-size:16px;line-height:1.6;color:#4a4a4a;font-weight:600;">
                    Hi ${firstName}, 👋
                  </p>
                  
                  <p style="margin:0 0 24px 0;font-size:16px;line-height:1.6;color:#4a4a4a;">
                    We're honoured you've chosen to join our community of compassionate healthcare professionals dedicated to providing exceptional home care across Jamaica.
                  </p>

                  <!-- What You Can Do Section -->
                  <h2 style="margin:32px 0 16px 0;font-size:20px;font-weight:600;color:#1a1a1a;">
                    ✨ What You Can Do
                  </h2>
                  
                  <ul style="margin:0 0 24px 0;padding-left:20px;color:#4a4a4a;font-size:15px;line-height:1.8;">
                    <li style="margin-bottom:8px;"><strong>Browse Care Services</strong> – Find skilled nurses ready to provide quality home care</li>
                    <li style="margin-bottom:8px;"><strong>Book Appointments</strong> – Schedule nursing visits with just a few taps</li>
                    <li style="margin-bottom:8px;"><strong>Manage Your Schedule</strong> – View and track all your appointments in one place</li>
                    <li style="margin-bottom:8px;"><strong>Secure Payments</strong> – Safe and convenient payment processing</li>
                    <li style="margin-bottom:8px;"><strong>24/7 Support</strong> – We're here whenever you need assistance</li>
                  </ul>

                  <!-- Getting Started Section -->
                  <h2 style="margin:32px 0 16px 0;font-size:20px;font-weight:600;color:#1a1a1a;">
                    🚀 Getting Started
                  </h2>
                  
                  <ol style="margin:0 0 24px 0;padding-left:20px;color:#4a4a4a;font-size:15px;line-height:1.8;">
                    <li style="margin-bottom:8px;">Complete your profile with your healthcare needs</li>
                    <li style="margin-bottom:8px;">Browse available nursing services</li>
                    <li style="margin-bottom:8px;">Book your first appointment</li>
                    <li style="margin-bottom:8px;">Experience professional home care</li>
                  </ol>

                </td>
              </tr>

                <!-- Three Images Horizontal Layout (Edge-to-Edge Blue Bar) -->
                <tr>
                  <td bgcolor="#2f62d7" style="padding:18px 0 12px 0;background:#2f62d7;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                      <tr>
                        <td align="center" style="padding:0 24px 12px 24px;">
                          <div style="font-size:20px;font-weight:800;line-height:1.2;color:#ffffff;text-align:center;">Our Promise to You</div>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:0;">
                          <table width="600" align="center" cellpadding="0" cellspacing="8" border="0" bgcolor="#2f62d7" style="border-collapse:separate;background:#2f62d7;">
                            <tr>
                              <td width="188" valign="top" style="padding:0;">
                                <img src="${nurseElderlyImage}" alt="Compassionate Care" width="188" height="188" style="width:188px;height:188px;object-fit:cover;display:block;border:0;outline:none;text-decoration:none;border-radius:0 !important;" />
                              </td>
                              <td width="188" valign="top" style="padding:0;">
                                <img src="${middleStripImage}" alt="Featured" width="188" height="188" style="width:188px;height:188px;object-fit:cover;display:block;border:0;outline:none;text-decoration:none;border-radius:0 !important;" />
                              </td>
                              <td width="188" valign="top" style="padding:0;">
                                <img src="${homeCareTeamImage}" alt="Professional Home Care" width="188" height="188" style="width:188px;height:188px;object-fit:cover;display:block;border:0;outline:none;text-decoration:none;border-radius:0 !important;" />
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

              <!-- Our Promise Section -->
                <tr>
                  <td style="padding:20px 24px 20px 24px;">
                    <p style="margin:0 0 16px 0;font-size:16px;line-height:1.65;">
                      At 876NURSES, we are committed to providing compassionate, professional, and personalized home health care that uplifts your comfort and wellbeing. Our team strives to make every experience safe, supportive, and respectful.
                    </p>
                  </td>
                </tr>

              <!-- Large Featured Image Full Width -->
              <tr>
                <td style="padding:0;">
                  <img src="${handsCompassionImage}" alt="Welcome to 876 Nurses" style="width:100%;height:auto;display:block;" />
                </td>
              </tr>

              <!-- Welcome Aboard Section -->
              <tr>
                <td style="padding:32px 24px;">
                  <h2 style="margin:0 0 12px 0;font-size:24px;line-height:1.4;color:#2f62d7;text-align:center;font-weight:700;">
                    Welcome aboard!
                  </h2>
                  
                  <p style="margin:0 0 24px 0;font-size:16px;line-height:1.6;color:#4a4a4a;text-align:center;">
                    We're excited to be part of your healthcare journey. 🌟
                  </p>

                  <!-- Call to Action Button (Pill-shaped) -->
                  <div style="text-align:center;margin:32px 0;">
                    <a href="nurses876://" style="display:inline-block;padding:14px 40px;background:#2f62d7;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;border-radius:30px;box-shadow:0 4px 12px rgba(47,98,215,0.3);">
                      Open App
                    </a>
                  </div>

                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="padding:24px;background:#2f62d7;border-top:1px solid #e9ecef;">
                  <p style="margin:0 0 8px 0;font-size:14px;color:#ffffff;text-align:center;line-height:1.5;">
                    Need help? Contact us at <a href="mailto:876nurses@gmail.com" style="color:#ffffff;text-decoration:underline;">876nurses@gmail.com</a>
                  </p>
                  <p style="margin:0;font-size:12px;color:#ffffff;opacity:0.9;text-align:center;">
                    © ${new Date().getFullYear()} 876 Nurses. Professional Home Care Services across Jamaica.
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  try {
    // Queue the email in Firestore using Admin SDK
    const docRef = await db.collection('mail').add({
      to: testUser.email,
      from: '876 Nurses <876nurses@gmail.com>',
      replyTo: '876nurses@gmail.com',
      subject: 'Welcome to 876 Nurses! 🌟',
      html: htmlContent,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log('\n✅ Email queued successfully!');
    console.log('📋 Document ID:', docRef.id);
    console.log('\n📬 The email should arrive shortly at:', testUser.email);
    console.log('\n🔍 What to check:');
    console.log('   1. Logo displays at 80px width');
    console.log('   2. Three images display horizontally above "Our Promise"');
    console.log('   3. Large featured image displays above "Welcome aboard"');
    console.log('   4. Pill-shaped button is rounded (30px radius)');
    console.log('   5. All images load from Firebase Storage');
    console.log('   6. Layout is mobile-responsive');
    
    console.log('\n💡 Check your inbox and verify the layout!');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error queuing email:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run the test
sendTestWelcomeEmail();
