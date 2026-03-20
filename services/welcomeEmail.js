import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore';

/**
 * Queue a welcome email for a new user by writing to Firestore /mail collection.
 * The deployed sendQueuedEmailOnCreate Cloud Function will automatically send it.
 * 
 * Call this after the user has verified their email and successfully signed in
 * (typically on the first verified login).
 * 
 * @param {Object} user - The Firebase Auth user object
 * @param {string} user.email - User's email address
 * @param {string} user.displayName - User's display name (optional)
 */
export async function queueWelcomeEmail(user) {
  if (!user || !user.email) {
    console.warn('Cannot queue welcome email: missing user or email');
    return;
  }

  const db = getFirestore();
  const displayName = user.displayName || 'there';
  const firstName = String(displayName).trim().split(' ')[0] || 'there';

  const subject = 'Welcome to 876 Nurses';
  const text = `Hi ${firstName},\n\nWe're honoured you've chosen to join our community focused on bringing quality healthcare, compassionate nursing support, and personalized care right to the comfort of your home.\n\nThank you for trusting us with your care. Let's make your health journey easier — starting now!\n\nRegards,\n876 Nurses`;

  // Use the publicly hosted logo from Firebase Storage
  const logoUrl = 'https://storage.googleapis.com/nurses-afb7e.firebasestorage.app/email-assets/876nurses-logo.png';
  const logoBlock = `<img src="${logoUrl}" alt="876 Nurses" width="80" align="center" style="display:block;width:80px;height:auto;border:none;outline:none;margin:0 auto;" />`;
  
  // Healthcare images from Firebase Storage
  const nurseElderlyImage = 'https://storage.googleapis.com/nurses-afb7e.firebasestorage.app/email-assets/nurse-elderly-care.jpg';
  const handsCompassionImage = 'https://storage.googleapis.com/nurses-afb7e.firebasestorage.app/email-assets/hands-compassion.jpg';
  const homeCareTeamImage = 'https://storage.googleapis.com/nurses-afb7e.firebasestorage.app/email-assets/home-care-team.jpg';
  const headerConfettiImage = 'https://storage.googleapis.com/nurses-afb7e.firebasestorage.app/email-assets/header-confetti-v2.png';

  // Footer links
  const companyLegalName = '876 Nurses Home Care Services Limited';
  const companyAddress = '60 Knutsford Blvd, Panjam Building, 9th Floor - Regus, Kingston 5, Jamaica, West Indies';
  const companyWebsite = 'https://www.876nurses.com';
  const instagramUrl = 'https://instagram.com/876_nurses';
  const facebookUrl = 'https://facebook.com/876nurses';
  const whatsAppUrl = 'https://wa.me/8766189876';

  // Public icon URLs (uploaded to Storage under email-assets/)
  const instagramIconUrl = 'https://storage.googleapis.com/nurses-afb7e.firebasestorage.app/email-assets/icon-instagram.png';
  const facebookIconUrl = 'https://storage.googleapis.com/nurses-afb7e.firebasestorage.app/email-assets/icon-facebook.png';
  const whatsAppIconUrl = 'https://storage.googleapis.com/nurses-afb7e.firebasestorage.app/email-assets/icon-whatsapp.png';

  // Middle image in the 3-photo strip (separate from the full-width featured image)
  const middleStripImage = 'https://storage.googleapis.com/nurses-afb7e.firebasestorage.app/email-assets/middle-strip-v2.jpg';

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Welcome to 876 Nurses</title>
      </head>
      <body style="margin:0;padding:0;background-color:#f5f7ff;font-family:Arial, sans-serif; color:#1f2a44;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f7ff; padding:40px 0;">
          <tr>
            <td align="center" style="padding:0 16px;">
              <table width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;">
                <!-- Combined Logo + Header (Background Image) -->
                <tr>
                  <td align="center" valign="middle" background="${headerConfettiImage}" style="padding:0;background-color:#ffffff;background-image:url('${headerConfettiImage}');background-repeat:no-repeat;background-position:center;background-size:cover;">
                    <!--[if gte mso 9]>
                    <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;height:220px;">
                      <v:fill type="frame" src="${headerConfettiImage}" color="#ffffff" />
                      <v:textbox inset="0,0,0,0">
                    <![endif]-->
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
                      <tr>
                        <td align="center" style="padding:40px 24px 16px 24px;">
                          ${logoBlock}
                        </td>
                      </tr>
                      <tr>
                        <td align="center" style="padding:0 24px 40px 24px;">
                          <h1 style="margin:0;font-size:34px;line-height:1.15;font-weight:800;color:#000000;">Welcome to 876 Nurses</h1>
                        </td>
                      </tr>
                    </table>
                    <!--[if gte mso 9]>
                      </v:textbox>
                    </v:rect>
                    <![endif]-->
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px 24px 0 24px;">
                    <p style="margin:0 0 8px 0;font-size:15px;line-height:1.65;font-weight:600;">Hi ${firstName}, 👋</p>
                    
                    <p style="margin:0 0 16px 0;font-size:16px;line-height:1.65;">
                      We're honoured you've chosen to join our community focused on bringing quality healthcare, compassionate nursing support, and personalized care right to the comfort of your home.
                    </p>
                    <p style="margin:0 0 16px 0;font-size:16px;line-height:1.65;">
                      Whether you're here as a client seeking care, a family member supporting a loved one, or a healthcare professional, this app is designed to make your journey easier and more connected.
                    </p>
                    
                    <h2 style="margin:28px 0 14px 0;font-size:24px;line-height:1.25;font-weight:800;color:#14213d;">✨ What You Can Do in the App</h2>
                    
                    <p style="margin:0 0 8px 0;font-size:15px;line-height:1.6;"><strong>📋 Book & Manage Care Services</strong><br/>
                    Schedule in-home nursing support — from daily care to post-op recovery, chronic illness assistance, physiotherapy, wound care, and more — all with just a few taps.</p>
                    
                    <p style="margin:0 0 8px 0;font-size:15px;line-height:1.6;"><strong>📍 Track Appointments & Care Plans</strong><br/>
                    View upcoming visits, manage reminders, and stay on top of your care plans with our intuitive dashboard.</p>
                    
                    <p style="margin:0 0 8px 0;font-size:15px;line-height:1.6;"><strong>💬 Get Support & Updates</strong><br/>
                    Receive direct updates, care tips, and important health notifications from our team of trained nurses.</p>
                    
                    <p style="margin:0 0 8px 0;font-size:15px;line-height:1.6;"><strong>📖 Learn & Empower Yourself</strong><br/>
                    Explore helpful resources and guides inspired by real nursing practices to support your health and wellbeing.</p>
                    
                    <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;"><strong>👥 Connect with Care Providers</strong><br/>
                    View profiles of the nursing professionals ready to serve you, and feel confident knowing your care is delivered by skilled, compassionate staff.</p>
                    
                    <h2 style="margin:28px 0 14px 0;font-size:24px;line-height:1.25;font-weight:800;color:#14213d;">🚀 Getting Started</h2>
                    
                    <p style="margin:0 0 10px 0;font-size:15px;line-height:1.6;"><strong>1. Complete Your Profile</strong><br/>
                    Add your preferences and health profile so we can tailor care to your needs.</p>
                    
                    <p style="margin:0 0 10px 0;font-size:15px;line-height:1.6;"><strong>2. Explore Services</strong><br/>
                    Browse available home nursing services — from companion care to acute condition support.</p>
                    
                    <p style="margin:0 0 10px 0;font-size:15px;line-height:1.6;"><strong>3. Set Reminders & Alerts</strong><br/>
                    Never miss a visit or medication schedule.</p>
                    
                    <p style="margin:0 0 18px 0;font-size:15px;line-height:1.6;"><strong>4. Turn On Notifications</strong><br/>
                    Stay informed with real-time updates.</p>
                    
                  </td>
                </tr>

                <!-- Three Images Horizontal Layout (Edge-to-Edge Blue Bar) -->
                <tr>
                  <td bgcolor="#2196F3" style="padding:18px 0 12px 0;background:#2196F3;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                      <tr>
                        <td align="center" style="padding:0 24px 12px 24px;">
                          <div style="font-size:20px;font-weight:800;line-height:1.2;color:#ffffff;text-align:center;">Our Promise to You</div>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:0;">
                          <table width="600" align="center" cellpadding="0" cellspacing="8" border="0" bgcolor="#2196F3" style="border-collapse:separate;background:#2196F3;">
                            <tr>
                              <td width="188" valign="top" style="padding:0;border-radius:14px;overflow:hidden;">
                                <img src="${nurseElderlyImage}" alt="Compassionate Care" width="188" height="188" style="width:188px;height:188px;object-fit:cover;display:block;border:0;outline:none;text-decoration:none;border-radius:14px;" />
                              </td>
                              <td width="188" valign="top" style="padding:0;border-radius:14px;overflow:hidden;">
                                <img src="${middleStripImage}" alt="Featured" width="188" height="188" style="width:188px;height:188px;object-fit:cover;display:block;border:0;outline:none;text-decoration:none;border-radius:14px;" />
                              </td>
                              <td width="188" valign="top" style="padding:0;border-radius:14px;overflow:hidden;">
                                <img src="${homeCareTeamImage}" alt="Professional Home Care" width="188" height="188" style="width:188px;height:188px;object-fit:cover;display:block;border:0;outline:none;text-decoration:none;border-radius:14px;" />
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:20px 24px 20px 24px;">
                    <p style="margin:0 0 16px 0;font-size:16px;line-height:1.65;">
                      At 876NURSES, we are committed to providing compassionate, professional, and personalized home health care that uplifts your comfort and wellbeing. Our team strives to make every experience safe, supportive, and respectful.
                    </p>
                  </td>
                </tr>
                
                <!-- Full Width Compassion Image -->
                <tr>
                  <td style="padding:0;">
                    <img src="${handsCompassionImage}" alt="Welcome to 876 Nurses" style="width:100%;height:auto;display:block;border-radius:14px;" />
                  </td>
                </tr>
                
                <!-- Welcome Aboard Section -->
                <tr>
                  <td style="padding:32px 24px;">
                    <h2 style="margin:0 0 12px 0;font-size:30px;line-height:1.25;color:#2196F3;text-align:center;font-weight:800;">
                      Welcome aboard!
                    </h2>
                    
                    <p style="margin:0 0 16px 0;font-size:16px;line-height:1.65;text-align:center;">
                      We're excited to be part of your healthcare journey. 🌟
                    </p>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:0 24px 40px 24px;">
                    <a href="nurses876://" style="display:inline-block;background:#2196F3;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:30px;font-weight:800;font-size:15px;box-shadow:0 4px 12px rgba(33,150,243,0.3);">Open App</a>
                  </td>
                </tr>
              </table>
              <table width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#2196F3;border-radius:0 0 18px 18px;overflow:hidden;">
                <tr>
                  <td align="center" style="padding:18px 8px 18px 8px;">
                    <div style="text-align:center;color:#d7e3ff;font-size:11px;line-height:1.6;">
                      <span style="white-space:nowrap;">This email was sent by: ${companyLegalName}</span><br />
                      ${companyAddress}<br />
                      <a href="${companyWebsite}" style="color:#d7e3ff;text-decoration:underline;font-weight:600;">${companyWebsite
                        .replace(/^https?:\/\//, '')
                        .replace(/\/$/, '')}</a>
                    </div>

                    <div style="border-top:1px solid rgba(255,255,255,0.25);margin:16px 0 14px 0;"></div>

                    <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                      <tr>
                        <td align="center" style="padding:0 10px;">
                          <a href="${instagramUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;width:28px;height:28px;text-decoration:none;">
                            <img src="${instagramIconUrl}" width="28" height="28" alt="Instagram" style="display:block;width:28px;height:28px;border:0;outline:none;text-decoration:none;border-radius:14px;" />
                          </a>
                        </td>
                        <td align="center" style="padding:0 10px;">
                          <a href="${facebookUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;width:28px;height:28px;text-decoration:none;">
                            <img src="${facebookIconUrl}" width="28" height="28" alt="Facebook" style="display:block;width:28px;height:28px;border:0;outline:none;text-decoration:none;border-radius:14px;" />
                          </a>
                        </td>
                        <td align="center" style="padding:0 10px;">
                          <a href="${whatsAppUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;width:28px;height:28px;text-decoration:none;">
                            <img src="${whatsAppIconUrl}" width="28" height="28" alt="WhatsApp" style="display:block;width:28px;height:28px;border:0;outline:none;text-decoration:none;border-radius:14px;" />
                          </a>
                        </td>
                      </tr>
                    </table>
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
    const docRef = await addDoc(collection(db, 'mail'), {
      to: user.email,
      from: '876 Nurses <876nurses@gmail.com>',
      replyTo: '876nurses@gmail.com',
      subject,
      html,
      createdAt: serverTimestamp(),
    });

    console.log('✅ Welcome email queued:', docRef.id);
    return docRef.id;
  } catch (error) {
    console.error('❌ Failed to queue welcome email:', error);
    throw error;
  }
}
