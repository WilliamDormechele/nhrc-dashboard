const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

admin.auth().setCustomUserClaims("YOUR_UID_HERE", {
  role: "administrator"
}).then(() => {
  console.log("Done");
});