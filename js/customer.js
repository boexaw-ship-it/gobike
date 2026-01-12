// customer.js - Customer live map with smooth Rider markers + route paths

// ---------------- Leaflet Map Setup ----------------
let map = L.map('map').setView([16.82, 96.15], 12); // Myanmar center

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// Custom Rider / Bike icon
const riderIcon = L.icon({
  iconUrl: '../assets/bike.png', // Rider avatar
  iconSize: [40, 40],
  iconAnchor: [20, 40],
  popupAnchor: [0, -40]
});

// Store markers & polylines by UID
let markers = {};
let routes = {};
let colors = {}; // UID-specific color

// Helper: random color generator for routes
function getRandomColor(uid) {
  if (colors[uid]) return colors[uid];
  const color = '#' + Math.floor(Math.random()*16777215).toString(16);
  colors[uid] = color;
  return color;
}

// ---------------- Firestore Real-Time Listener ----------------
db.collection("locations").onSnapshot(snapshot => {
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    const uid = doc.id;

    if (!data.lat || !data.lng) return;
    const position = [data.lat, data.lng];

    // ---------------- Marker popup ----------------
    const updatedTime = data.updatedAt ? data.updatedAt.toDate().toLocaleTimeString() : '';
    const popupContent = 
      <b>${data.name || uid}</b><br>
      Role: ${data.role}<br>
      Updated: ${updatedTime}
    ;

    // Smooth marker move
    if (markers[uid]) {
      markers[uid].setLatLng(position);
      markers[uid].setPopupContent(popupContent);
    } else {
      markers[uid] = L.marker(position, { icon: riderIcon })
        .addTo(map)
        .bindPopup(popupContent);
    }

    // ---------------- Polyline Route ----------------
    if (!routes[uid]) {
      routes[uid] = L.polyline([position], { color: getRandomColor(uid), weight: 4 }).addTo(map);
    } else {
      const latlngs = routes[uid].getLatLngs();
      latlngs.push(position);
      routes[uid].setLatLngs(latlngs);
    }
  });

  // ---------------- Auto map follow: center on first rider ----------------
  const uids = snapshot.docs.map(d => d.id);
  if (uids.length && markers[uids[0]]) {
    map.setView(markers[uids[0]].getLatLng(), map.getZoom());
  }
});
