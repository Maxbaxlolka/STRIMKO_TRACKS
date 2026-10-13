// Run locally after `npm install firebase-admin` and setting GOOGLE_APPLICATION_CREDENTIALS
// to a service-account JSON downloaded from Firebase Console > Project settings > Service accounts.
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.applicationDefault() });
const email = process.argv[2];
if (!email) { console.error('Usage: node scripts/set-admin.js you@example.com'); process.exit(1); }
(async()=>{const user=await admin.auth().getUserByEmail(email);await admin.auth().setCustomUserClaims(user.uid,{...(user.customClaims||{}),admin:true});console.log(`Admin role granted to ${email}. Sign out and sign in again.`);process.exit(0);})().catch(e=>{console.error(e);process.exit(1)});
