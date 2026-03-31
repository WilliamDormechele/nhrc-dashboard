// js/firebase-config.js

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyA0adImDqEu_5XvmclE6UrhkHeX9ZyKEiQ",
  authDomain: "nhrc-dashboard.firebaseapp.com",
  projectId: "nhrc-dashboard",
  storageBucket: "nhrc-dashboard.firebasestorage.app",
  messagingSenderId: "944110895256",
  appId: "1:944110895256:web:6d74dbaeccbca38b4d90ed",
  measurementId: "G-J6B0NKQ5WB"
};

// Main app for the signed-in user
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();

const db = firebase.firestore();

// Important fix for browsers/networks/extensions that break Firestore WebChannel
db.settings({
  experimentalAutoDetectLongPolling: true,
  useFetchStreams: false
});

// Optional harder fallback:
// db.settings({
//   experimentalForceLongPolling: true,
//   useFetchStreams: false
// });

const functions = firebase.app().functions("us-central1");

// Secondary app/auth instance for creating new users from the admin panel
// This avoids replacing the currently logged-in administrator session.
let secondaryApp;
try {
  secondaryApp = firebase.app("secondary-admin-app");
} catch (error) {
  secondaryApp = firebase.initializeApp(firebaseConfig, "secondary-admin-app");
}
const secondaryAuth = secondaryApp.auth();