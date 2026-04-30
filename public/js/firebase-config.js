// js/firebase-config.js

const firebaseConfig = {
  apiKey: "AIzaSyA0adImDqEu_5XvmclE6UrhkHeX9ZyKEiQ",
  authDomain: "nhrc-dashboard.firebaseapp.com",
  projectId: "nhrc-dashboard",
  storageBucket: "nhrc-dashboard.firebasestorage.app",
  messagingSenderId: "944110895256",
  appId: "1:944110895256:web:6d74dbaeccbca38b4d90ed",
  measurementId: "G-J6B0NKQ5WB"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

db.settings({
  experimentalAutoDetectLongPolling: true,
  useFetchStreams: false
});

const functions = firebase.app().functions("us-central1");

let secondaryApp;
try {
  secondaryApp = firebase.app("secondary-admin-app");
} catch (error) {
  secondaryApp = firebase.initializeApp(firebaseConfig, "secondary-admin-app");
}
const secondaryAuth = secondaryApp.auth();