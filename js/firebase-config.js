// js/firebase-config.js

const firebaseConfig = {
  apiKey: "AIzaSyC3NOeIU5SWlFAsYjaLbfjBMOd8rQ_nc3k",
  authDomain: "hemab-9ffc7.firebaseapp.com",
  projectId: "hemab-9ffc7",
  storageBucket: "hemab-9ffc7.firebasestorage.app",
  messagingSenderId: "519945610994",
  appId: "1:519945610994:web:d9cbcb4b4004fce072126b",
  measurementId: "G-V1NJNSJKQZ"
};

// Main app for the signed-in user
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.firestore();
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