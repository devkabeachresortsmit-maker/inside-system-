const firebaseConfig = {
  apiKey: "AIzaSyCfzLWoN-OjY091uhtgsJDdykSTxGUjqAs",
  authDomain: "dbr-inside-system.firebaseapp.com",
  projectId: "dbr-inside-system",
  storageBucket: "dbr-inside-system.firebasestorage.app",
  messagingSenderId: "968780488853",
  appId: "1:968780488853:web:c1252c5b14dd5603fefb9c"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
