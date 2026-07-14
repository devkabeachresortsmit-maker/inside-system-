importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// Initialize Firebase App in service worker
const firebaseConfig = {
  apiKey: "AIzaSyCfzLWoN-OjY091uhtgsJDdykSTxGUjqAs",
  authDomain: "dbr-inside-system.firebaseapp.com",
  projectId: "dbr-inside-system",
  storageBucket: "dbr-inside-system.firebasestorage.app",
  messagingSenderId: "968780488853",
  appId: "1:968780488853:web:c1252c5b14dd5603fefb9c"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  const notificationTitle = payload.notification ? payload.notification.title : 'Devka Beach Resort — Ops Hub';
  const notificationOptions = {
    body: payload.notification ? payload.notification.body : 'New operational update received.',
    icon: 'logo.svg',
    badge: 'logo.svg',
    data: payload.data
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
