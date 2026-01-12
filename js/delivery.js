// delivery.js - Rider GPS tracking + Firestore save

// Anonymous login
auth.signInAnonymously()
  .then(res => {
    const uid = res.user.uid;
    const name = localStorage.getItem("name") || "Rider";
    const statusEl = document.getElementById("status");

    statusEl.innerText = "Logged in as UID: " + uid;

    if (navigator.geolocation) {
      navigator.geolocation.watchPosition(
        pos => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;

          // Save/update location in Firestore
          db.collection("locations").doc(uid).set({
            lat: lat,
            lng: lng,
            name: name,
            role: "rider",
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });

          statusEl.innerText = GPS OK: Lat ${lat.toFixed(5)}, Lng ${lng.toFixed(5)};
        },
        err => {
          statusEl.innerText = "GPS Error: " + err.message;
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 5000
        }
      );
    } else {
      statusEl.innerText = "Geolocation not supported.";
    }

  })
  .catch(err => {
    document.getElementById("status").innerText = "Auth Error: " + err.message;
  });
