auth.onAuthStateChanged((user) => {
  if (!user) return;

  const status = document.getElementById("locationStatus");

  if (!navigator.geolocation) {
    status.innerText = "GPS not supported";
    return;
  }

  navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      status.innerText = `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;

      db.collection("locations").doc(user.uid).set({
        lat,
        lng,
        role: "customer",
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    },
    () => {
      status.innerText = "GPS permission denied or error";
    },
    { enableHighAccuracy: true }
  );
});

// Optional: Place Order button functionality
document.getElementById("placeOrderBtn").addEventListener("click", () => {
  alert("Order plac:ement logic will be here (STEP 5)");
});
